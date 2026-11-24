#!/usr/bin/env python3
"""Drive pcli 2-of-3 threshold send (two FROST rounds) via PTY. Never prints keys or payloads."""
from __future__ import annotations

import os
import pty
import re
import select
import sys
import time
from pathlib import Path

ROOT = Path(os.environ.get("SEZS_SESSION_ROOT", "/tmp/sezs-session-real"))
PCLI = os.environ.get("PCLI_BIN", str(Path.home() / ".ict-rs/bins/pcli"))
SEAT0 = str(ROOT / "pcli/seat0")
SEAT1 = str(ROOT / "pcli/seat1")
_dest_file = Path(os.environ.get("SEZS_UM_DEST_FILE", str(ROOT / "pcli/dest1.addr")))
DEST = os.environ.get("SEZS_UM_DEST", _dest_file.read_text().strip() if _dest_file.exists() else "")
AMOUNT = os.environ.get("SEZS_UM_AMOUNT", "1penumbra")
MEMO = os.environ.get("SEZS_UM_MEMO", "")
LOG = ROOT / "logs/pcli-threshold-send.summary"

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
TXID = re.compile(r"\b([0-9a-f]{64})\b", re.I)
SAFE = re.compile(
    r"including transaction fee|building transaction|Scanning blocks|"
    r"Paste the coordinator|Send this message|gather at least|same\* signers|"
    r"Do you approve|Press enter|transaction id|broadcast|submitted|committed|"
    r"Error:|error:|txid|Received ",
    re.I,
)


def strip(s: str) -> str:
    return ANSI.sub("", s)


def spawn(args):
    pid, fd = pty.fork()
    if pid == 0:
        os.execv(args[0], args)
    return pid, fd


class Proc:
    def __init__(self, args, name):
        self.name = name
        self.pid, self.fd = spawn(args)
        self.buf = ""

    def recv(self, timeout):
        if getattr(self, "eof", False):
            time.sleep(min(0.05, timeout or 0.05))
            return ""
        ready, _, _ = select.select([self.fd], [], [], timeout)
        if not ready:
            return ""
        try:
            chunk = os.read(self.fd, 16384)
        except OSError:
            self.eof = True
            return ""
        if not chunk:
            self.eof = True
            return ""
        text = chunk.decode("utf-8", "replace")
        self.buf += text
        return text

    def wait_for(self, needle, timeout=60):
        end = time.time() + timeout
        while time.time() < end:
            if needle.lower() in strip(self.buf).lower():
                return True
            if getattr(self, "eof", False):
                return False
            self.recv(min(0.2, max(0.05, end - time.time())))
        return needle.lower() in strip(self.buf).lower()

    def write(self, data: str):
        payload = data.encode() + b"\r"
        # Raw mode echoes each byte; interleave reads to avoid PTY deadlock.
        view = memoryview(payload)
        sent = 0
        while sent < len(payload):
            self.recv(0.01)
            try:
                n = os.write(self.fd, view[sent:sent + 64])
            except OSError:
                break
            sent += n
        self.recv(0.05)

    def consume(self):
        out = self.buf
        self.buf = ""
        return out

    def last_payload(self):
        lines = [ln.strip() for ln in strip(self.buf).splitlines() if ln.strip()]
        cands = [
            ln
            for ln in lines
            if len(ln) >= 40
            and "approve" not in ln.lower()
            and "press enter" not in ln.lower()
            and "send this" not in ln.lower()
            and "paste" not in ln.lower()
            and "gather" not in ln.lower()
            and "scanning" not in ln.lower()
            and "including transaction" not in ln.lower()
            and "building transaction" not in ln.lower()
        ]
        return max(cands, key=len) if cands else ""

    def status(self):
        for ln in strip(self.buf).splitlines():
            if SAFE.search(ln) and not re.search(r"seed|mnemonic|spendkey|secret key|rseed|full viewing", ln, re.I):
                if len(ln) > 200 and not TXID.search(ln):
                    continue
                print(f"{self.name}: {ln[:200]}", flush=True)

    def close(self):
        try:
            os.close(self.fd)
        except OSError:
            pass
        try:
            os.waitpid(self.pid, os.WNOHANG)
        except ChildProcessError:
            pass


def main() -> int:
    if not DEST.startswith("penumbra1"):
        print("bad dest", file=sys.stderr)
        return 2

    send_cmd = [PCLI, "--home", SEAT0, "tx", "send", "--to", DEST, AMOUNT]
    if MEMO:
        send_cmd.extend(["--memo", MEMO])
    coord = Proc(send_cmd, "coord")
    if not coord.wait_for("paste them below", 60):
        coord.status()
        print("coordinator did not start round 1")
        coord.close()
        return 1
    coord.status()
    msg1 = coord.last_payload()
    print(f"round1_coord_len={len(msg1)}", flush=True)
    if len(msg1) < 20:
        print("empty coordinator round 1")
        coord.close()
        return 1
    # Coordinator is now waiting for a paste; keep its buffer but we've captured msg1.

    follower = Proc([PCLI, "--home", SEAT1, "threshold", "sign"], "follow")
    if not follower.wait_for("Paste the coordinator's first message:", 60):
        follower.status()
        print("follower did not ask for round 1")
        coord.close(); follower.close()
        return 1
    follower.status()
    follower.consume()
    follower.write(msg1)
    if not follower.wait_for("Press enter to continue", 60):
        follower.status()
        print("follower did not ask to confirm")
        coord.close(); follower.close()
        return 1
    follower.status()
    follower.consume()
    follower.write("")
    if not follower.wait_for("Send this message to the coordinator:", 60):
        follower.status()
        print("follower did not emit round 1 reply")
        coord.close(); follower.close()
        return 1
    # Give the yellow JSON a moment to flush
    time.sleep(0.2)
    follower.recv(0.5)
    reply1 = follower.last_payload()
    print(f"round1_reply_len={len(reply1)}", flush=True)
    if len(reply1) < 20:
        print("empty follower round 1 reply")
        coord.close(); follower.close()
        return 1
    already_r2 = "Paste the coordinator's second message:" in strip(follower.buf)

    coord.consume()
    coord.write(reply1)
    if not coord.wait_for("same", 60) and not coord.wait_for("Round 1", 5):
        # the exact second gather prompt:
        if not coord.wait_for("paste them below", 30):
            # wait for second "Send this message" then gather
            if not coord.wait_for("Send this message to the other signers:", 30):
                coord.status()
                print("coordinator did not start round 2")
                coord.close(); follower.close()
                return 1
            coord.wait_for("paste them below", 30)
    coord.status()
    msg2 = coord.last_payload()
    print(f"round2_coord_len={len(msg2)}", flush=True)
    if len(msg2) < 20:
        print("empty coordinator round 2")
        coord.close(); follower.close()
        return 1

    if already_r2:
        print("follower_round2_prompt=preloaded", flush=True)
    elif not follower.wait_for("Paste the coordinator's second message:", 60):
        follower.status()
        print("follower did not ask for round 2")
        coord.close(); follower.close()
        return 1
    follower.status()
    follower.consume()
    follower.write(msg2)
    # Drain the raw-mode echo of msg2 so it cannot be mistaken for the reply.
    end = time.time() + 10
    while time.time() < end:
        follower.recv(0.1)
        if "Send this message to the coordinator:" in strip(follower.buf):
            break
    if "Send this message to the coordinator:" not in strip(follower.buf):
        follower.status()
        print("follower did not emit round 2 reply")
        coord.close(); follower.close()
        return 1
    time.sleep(0.3)
    follower.recv(0.5)
    cands = []
    for ln in strip(follower.buf).splitlines():
        s = ln.strip()
        if len(s) >= 40 and s != msg2 and "paste" not in s.lower() and "send this" not in s.lower():
            cands.append(s)
    reply2 = max(cands, key=len) if cands else ""
    print(f"round2_reply_len={len(reply2)} same_as_msg2={reply2==msg2}", flush=True)
    if len(reply2) < 20 or reply2 == msg2:
        print("empty or echoed follower round 2 reply")
        coord.close(); follower.close()
        return 1

    coord.consume()
    coord.write(reply2)
    if not coord.wait_for("Error:") and not any(TXID.search(strip(coord.buf)) for _ in [0]):
        # wait for txid or error
        end = time.time() + 60
        while time.time() < end and not TXID.search(strip(coord.buf)) and "Error:" not in strip(coord.buf):
            coord.recv(0.3)
    coord.status()
    m = TXID.search(strip(coord.buf))
    coord.close(); follower.close()
    LOG.parent.mkdir(parents=True, exist_ok=True)
    if m:
        LOG.write_text(f"ok=1 txid={m.group(1)} amount={AMOUNT}\n")
        print(f"UM_TXID={m.group(1)}", flush=True)
        return 0
    LOG.write_text("ok=0 no-txid\n")
    print("no txid found", flush=True)
    print(f"coord_buf_len={len(strip(coord.buf))}", flush=True)
    coord.status()
    return 1


if __name__ == "__main__":
    sys.exit(main())
