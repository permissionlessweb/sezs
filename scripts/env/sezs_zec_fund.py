#!/usr/bin/env python3
"""One-process Ironwood funding: NU6.3 at 1, FROST miner, generate maturity in-process."""
import json, os, re, signal, subprocess, time, urllib.request
from pathlib import Path

ROOT = Path(os.environ["SEZS_SESSION_ROOT"])
CFG = ROOT / "zakura" / "zakurad.toml"
DEALER = ROOT / "zec-frost" / "dealer.json"
LOG = ROOT / "logs" / "zakura.log"
LWD_LOG = ROOT / "logs" / "lightwalletd.log"
ZAKURAD = Path.home() / ".ict-rs/bins/zakurad"
LWD = Path.home() / ".ict-rs/bins/lightwalletd"
RPC = "http://127.0.0.1:18232"

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
    if port in (47080, 47090, 47658):
        return
    pids = pids_on(port)
    if not pids:
        return
    log("stopping %s pids %s" % (name, sorted(pids)))
    for p in pids:
        try:
            os.kill(p, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for _ in range(80):
        if not port_up(port):
            time.sleep(0.5)
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
    if not ua or not str(ua).startswith("uregtest1"):
        raise SystemExit("no valid uregtest FROST UA")
    return ua

def rewrite_cfg():
    text = CFG.read_text()
    ua = frost_ua()
    text = re.sub(r'"NU6\.1" = \d+', '"NU6.1" = 1', text)
    text = re.sub(r'"NU6\.2" = \d+', '"NU6.2" = 1', text)
    text = re.sub(r'"NU6\.3" = \d+', '"NU6.3" = 1', text)
    text = re.sub(r'NU5 = \d+', 'NU5 = 1', text)
    text = re.sub(r'NU6 = \d+', 'NU6 = 1', text)
    text2, n = re.subn(r'miner_address = "[^"]+"', 'miner_address = "%s"' % ua, text, count=1)
    if n != 1:
        raise SystemExit("miner_address replace failed")
    text2, _ = re.subn(r'internal_miner = \w+', 'internal_miner = false', text2, count=1)
    if 'miner_address = "uregtest1' not in text2:
        raise SystemExit("expected uregtest miner")
    if '"NU6.3" = 1' not in text2:
        raise SystemExit("expected NU6.3 at 1")
    CFG.write_text(text2)
    log("config: NU6.3=1, FROST miner, internal_miner=false")

def start_zakurad():
    for _ in range(40):
        if not port_up(19901) and not port_up(18232) and not port_up(18233):
            break
        time.sleep(0.25)
    with open(LOG, "ab") as lf:
        lf.write(b"\n----- oneshot -----\n")
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
            str(LWD), "--no-tls-very-insecure",
            "--grpc-bind-addr", "127.0.0.1:19067",
            "--http-bind-addr", "127.0.0.1:19068",
            "--rpchost", "127.0.0.1", "--rpcport", "18232",
            "--rpcuser", "sezs", "--rpcpassword", "sezs",
            "--no-backend-check", "--data-dir", str(d),
        ],
        stdout=open(LWD_LOG, "ab"),
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    for _ in range(40):
        if port_up(19067):
            log("lightwalletd listening")
            return proc.pid
        time.sleep(0.25)
    return proc.pid

def pools():
    info = rpc("getblockchaininfo")
    return {p.get("id"): p.get("chainValue") for p in (info.get("valuePools") or [])}, info.get("blocks")

def main():
    # Fresh chain required: state does not survive miner restarts on this host.
    stop_port(19067, "lightwalletd")
    stop_port(18232, "zakurad")
    state = ROOT / "zakura" / "state"
    if state.exists():
        import shutil
        shutil.rmtree(state)
        log("wiped zakura state for a one-shot ironwood genesis")
    rewrite_cfg()
    z = start_zakurad()
    l = start_lwd()
    (ROOT / "run").mkdir(exist_ok=True)
    with (ROOT / "run" / "pidlist").open("a") as f:
        f.write("zakura %s 1\nlightwalletd %s 1\n" % (z, l))
    # list methods (names only)
    try:
        h = rpc("help")
        names = [ln.split()[0] for ln in str(h).splitlines() if ln and ln[0].isalpha()]
        log("rpc methods: " + ",".join(names[:80]))
    except Exception as e:
        log("help failed: %s" % e)
    pls, h = pools()
    log("start height=%s pools=%s" % (h, pls))
    n_fund = 5
    n_mature = 100
    log("generate(%s) ironwood coinbases to FROST treasury" % n_fund)
    t0 = time.time()
    rpc("generate", n_fund, timeout=max(300, n_fund * 200))
    pls, h = pools()
    log("after fund tip=%s in %.1fs ironwood=%s transparent=%s" % (h, time.time()-t0, pls.get("ironwood"), pls.get("transparent")))
    if not pls.get("ironwood"):
        raise SystemExit("ironwood pool empty after FROST generate")
    log("generate(%s) for coinbase maturity" % n_mature)
    t0 = time.time()
    rpc("generate", n_mature, timeout=max(180, n_mature * 5))
    pls, h = pools()
    log("final tip=%s in %.1fs ironwood=%s transparent=%s orchard=%s" % (
        h, time.time()-t0, pls.get("ironwood"), pls.get("transparent"), pls.get("orchard")))
    if h < (n_fund + n_mature) or not pls.get("ironwood"):
        raise SystemExit("funding incomplete")

if __name__ == "__main__":
    main()
