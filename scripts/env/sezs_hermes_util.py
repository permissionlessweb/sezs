#!/usr/bin/env python3
"""Small helpers for sezs_hermes_local.sh. Never print secrets."""
import json
import re
import sys
from pathlib import Path


def extract_key(src, mnemonic_path, addr_path):
    j = json.load(open(src))
    Path(mnemonic_path).write_text(j["mnemonic"] + "\n")
    Path(addr_path).write_text(j["address"] + "\n")


def funded_uterp(bal_json, min_amount=10_000_000):
    b = json.loads(bal_json).get("balances") or []
    ok = any(int(x.get("amount") or 0) >= min_amount and x.get("denom") == "uterp" for x in b)
    print("True" if ok else "False")


def txhash_from_logs(*paths):
    t = "\n".join(Path(p).read_text(errors="replace") for p in paths)
    m = re.search(r"txhash:\s*([0-9A-Fa-f]+)", t) or re.search(r"([0-9A-Fa-f]{64})", t)
    print(m.group(1) if m else "")


def print_health(*paths):
    t = "\n".join(Path(p).read_text(errors="replace") for p in paths)
    for ln in t.splitlines():
        if re.search(r"healthy|unhealthy|warn|chain|penumbra|sezs-local|error", ln, re.I) and not re.search(
            r"spend|mnemonic|seed|priv", ln, re.I
        ):
            print(ln[:200])


def record_channel(out_path, err_path, dest):
    t = Path(out_path).read_text(errors="replace") + "\n" + Path(err_path).read_text(errors="replace")
    lines = []
    for ln in t.splitlines():
        if re.search(r"channel-|connection-|client|SUCCESS|created|error|Error|FAIL", ln, re.I) and not re.search(
            r"spend|mnemonic|seed|priv", ln, re.I
        ):
            lines.append(ln[:240])
    Path(dest).write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:40]))
    if not re.search(r"channel-\d+", t):
        sys.exit(1)


def main():
    cmd = sys.argv[1]
    args = sys.argv[2:]
    if cmd == "extract_key":
        extract_key(*args)
    elif cmd == "funded_uterp":
        funded_uterp(args[0])
    elif cmd == "txhash":
        txhash_from_logs(*args)
    elif cmd == "print_health":
        print_health(*args)
    elif cmd == "record_channel":
        record_channel(*args)
    else:
        sys.exit(2)


if __name__ == "__main__":
    main()
