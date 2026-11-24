#!/usr/bin/env python3
"""Two-phase miner: early transparent heights, then NU6.3+ ironwood to FROST UA, then maturity."""
import json, os, re, signal, subprocess, time, urllib.request
from pathlib import Path

ROOT = Path(os.environ.get("SEZS_SESSION_ROOT") or "/tmp/sezs-session/current").resolve()
# If ROOT is the pointer dir, prefer session.json
ptr = Path("/tmp/sezs-session/current/session.json")
if not (ROOT / "zakura").exists() and ptr.exists():
    try:
        root = json.loads(ptr.read_text()).get("root")
        if root:
            ROOT = Path(root)
    except Exception:
        pass

CFG = ROOT / "zakura" / "zakurad.toml"
DEALER = ROOT / "zec-frost" / "dealer.json"
LOG = ROOT / "logs" / "zakura.log"
LWD_LOG = ROOT / "logs" / "lightwalletd.log"
ZAKURAD = Path.home() / ".ict-rs/bins/zakurad"
LWD = Path.home() / ".ict-rs/bins/lightwalletd"
T_ADDR = "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs"
RPC = os.environ.get("SEZS_ZAKURA_RPC") or "http://127.0.0.1:18232"

def log(msg):
    print("[sezs-zec-miner]", msg, flush=True)

def rpc(method, *params, timeout=600):
    req = urllib.request.Request(
        RPC,
        data=json.dumps({"jsonrpc": "1.0", "id": "x", "method": method, "params": list(params)}).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        j = json.load(r)
    if j.get("error"):
        raise RuntimeError("%s: %s" % (method, j["error"]))
    return j["result"]

def port_up(port):
    r = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"], capture_output=True, text=True)
    return len(r.stdout.splitlines()) > 1

def pids_on(port):
    r = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"], capture_output=True, text=True)
    out = set()
    for ln in r.stdout.splitlines()[1:]:
        parts = ln.split()
        if len(parts) > 1 and parts[1].isdigit():
            out.add(int(parts[1]))
    return out

def stop_port(port, name):
    # Refuse hs-preview ports.
    if port in (47080, 47090, 47658):
        log("refusing to stop hs-preview port %s" % port)
        return
    pids = pids_on(port)
    if not pids:
        log("%s already down" % name)
        return
    log("stopping %s pids %s" % (name, sorted(pids)))
    for p in pids:
        try:
            os.kill(p, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for _ in range(60):
        if not port_up(port):
            log("%s stopped" % name)
            return
        time.sleep(0.25)
    for p in pids_on(port):
        try:
            os.kill(p, signal.SIGKILL)
        except ProcessLookupError:
            pass
    time.sleep(0.5)

def frost_ua():
    dealer = json.loads(DEALER.read_text())
    ua = dealer.get("ua_uregtest") or dealer.get("ua")
    if not ua or not str(ua).startswith("uregtest1") or "orchard:" in str(ua):
        raise SystemExit("no valid uregtest FROST UA")
    return ua

def set_miner(addr_kind):
    text = CFG.read_text()
    ua = frost_ua()
    if addr_kind == "transparent":
        dest = T_ADDR
    elif addr_kind == "frost":
        dest = ua
    else:
        raise SystemExit("addr_kind")
    text2, n = re.subn(r'miner_address = "[^"]+"', 'miner_address = "%s"' % dest, text, count=1)
    if n != 1:
        raise SystemExit("miner_address replace failed")
    text2, n2 = re.subn(r'internal_miner = \w+', 'internal_miner = false', text2, count=1)
    if n2 != 1:
        # tolerate already-correct or missing; only fail if we expected to write dest
        pass
    if addr_kind == "frost" and 'miner_address = "uregtest1' not in text2:
        raise SystemExit("expected uregtest miner")
    if addr_kind == "transparent" and T_ADDR not in text2:
        raise SystemExit("expected transparent miner")
    CFG.write_text(text2)
    log("miner set to %s (address not printed for frost)" % addr_kind)

def start_zakurad():
    for _ in range(20):
        if not port_up(19901) and not port_up(18232) and not port_up(18233):
            break
        time.sleep(0.25)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG, "ab") as lf:
        lf.write(b"\n----- restart -----\n")
    proc = subprocess.Popen(
        [str(ZAKURAD), "--config", str(CFG), "start"],
        stdout=open(LOG, "ab"),
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    log("zakurad pid %s" % proc.pid)
    for i in range(120):
        if port_up(18232):
            log("zakurad listening")
            return proc.pid
        if proc.poll() is not None:
            raise SystemExit("zakurad exited %s" % proc.returncode)
        time.sleep(0.5)
    raise SystemExit("zakurad did not listen")

def start_lwd():
    d = ROOT / "lightwalletd"
    d.mkdir(exist_ok=True)
    proc = subprocess.Popen(
        [
            str(LWD),
            "--no-tls-very-insecure",
            "--grpc-bind-addr", "127.0.0.1:19067",
            "--http-bind-addr", "127.0.0.1:19068",
            "--rpchost", "127.0.0.1",
            "--rpcport", "18232",
            "--rpcuser", "sezs",
            "--rpcpassword", "sezs",
            "--no-backend-check",
            "--data-dir", str(d),
        ],
        stdout=open(LWD_LOG, "ab"),
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    log("lightwalletd pid %s" % proc.pid)
    for _ in range(40):
        if port_up(19067):
            log("lightwalletd listening")
            return proc.pid
        time.sleep(0.25)
    log("lightwalletd did not listen (continuing)")
    return proc.pid

def restart_all():
    stop_port(19067, "lightwalletd")
    stop_port(18232, "zakurad")
    time.sleep(0.8)
    z = start_zakurad()
    l = start_lwd()
    (ROOT / "run").mkdir(exist_ok=True)
    (ROOT / "run" / "zakura-restart-pids.txt").write_text("zakura %s 1\nlightwalletd %s 1\n" % (z, l))
    # Append to pidlist if present
    pl = ROOT / "run" / "pidlist"
    if pl.exists():
        with pl.open("a") as f:
            f.write("zakura %s 1\nlightwalletd %s 1\n" % (z, l))
    return z, l

def pools():
    info = rpc("getblockchaininfo")
    return {p.get("id"): p.get("chainValue") for p in (info.get("valuePools") or [])}, info.get("blocks")

def gen(n, timeout=None):
    timeout = timeout or max(120, n * 360)
    before, h0 = pools()
    log("generate(%s) starting tip=%s ironwood=%s transparent=%s" % (n, h0, before.get("ironwood"), before.get("transparent")))
    t0 = time.time()
    hashes = rpc("generate", n, timeout=timeout)
    dt = time.time() - t0
    after, h1 = pools()
    nh = len(hashes) if isinstance(hashes, list) else hashes
    log("generate(%s) done in %.1fs tip=%s n_hashes=%s" % (n, dt, h1, nh))
    log("pools ironwood=%s orchard=%s transparent=%s sapling=%s lockbox=%s" % (
        after.get("ironwood"), after.get("orchard"), after.get("transparent"),
        after.get("sapling"), after.get("lockbox")))
    return hashes

def main():
    cmd = os.environ.get("SEZS_ZEC_CMD") or "help"
    if cmd == "phase1":
        set_miner("transparent")
        restart_all()
        gen(1, timeout=60)
        return
    if cmd == "phase2":
        set_miner("frost")
        restart_all()
        n = int(os.environ.get("SEZS_ZEC_GEN", "3"))
        gen(n, timeout=max(600, n * 200))
        return
    if cmd == "mature":
        set_miner("transparent")
        restart_all()
        n = int(os.environ.get("SEZS_ZEC_GEN", "100"))
        gen(n, timeout=max(180, n * 5))
        return
    if cmd == "gen":
        n = int(os.environ.get("SEZS_ZEC_GEN", "1"))
        gen(n)
        return
    if cmd == "status":
        pls, h = pools()
        log("height=%s pools=%s" % (h, pls))
        return
    raise SystemExit("SEZS_ZEC_CMD=phase1|phase2|mature|gen|status")

if __name__ == "__main__":
    main()
