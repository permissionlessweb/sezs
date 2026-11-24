#!/usr/bin/env bash
# Local-only cw-orch-kms granter/grantee walkthrough for sezs-orch deploy + curate.
# Starts a throwaway loopback terpd, never talks to morocco-1, never prints keys.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TERPD="${SEZS_V2_TERPD:-${TERPD:-terpd}}"
if [[ ! -x "$TERPD" ]]; then
  if command -v terpd >/dev/null 2>&1; then
    TERPD="$(command -v terpd)"
  else
    echo "kms-local-test: terpd not executable at $TERPD" >&2
    exit 2
  fi
fi

CHAIN_ID="${SEZS_CHAIN_ID:-sezs-local-1}"
DENOM="${SEZS_DENOM:-uterp}"
GENESIS_AMT="100000000000${DENOM}"
SESSION="${SEZS_KMS_TEST_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/sezs-kms-XXXX")}"
LAB="$SESSION/terp"
mkdir -p "$LAB/key-secrets" "$LAB/logs" "$SESSION"
chmod 700 "$SESSION" "$LAB" "$LAB/key-secrets"

port_busy() {
  local port="$1"
  python3 - "$port" <<'PY'
import socket, sys
p = int(sys.argv[1])
s = socket.socket()
s.settimeout(0.3)
busy = s.connect_ex(("127.0.0.1", p)) == 0
s.close()
sys.exit(0 if busy else 1)
PY
}

# Prefer default localterp ports when free; otherwise pick a free block so we
# do not disturb an already-running lab node or another scratch cometbft.
PPROF_PORT=""
if ! port_busy 26657 && ! port_busy 9090 && ! port_busy 1317 && ! port_busy 26656; then
  RPC_PORT=26657
  P2P_PORT=26656
  LCD_PORT=1317
  GRPC_PORT=9090
else
  chosen=""
  for base in 28000 28200 28400 28600 28800 29000 29200 29400 29600 29800; do
    if ! port_busy "$base" && ! port_busy $((base+1)) && ! port_busy $((base+2)) && ! port_busy $((base+3)) && ! port_busy $((base+4)); then
      RPC_PORT="$base"
      P2P_PORT=$((base+1))
      LCD_PORT=$((base+2))
      GRPC_PORT=$((base+3))
      PPROF_PORT=$((base+4))
      chosen=1
      break
    fi
  done
  if [[ -z "$chosen" ]]; then
    echo "kms-local-test: could not find a free local port block" >&2
    exit 2
  fi
  echo "kms-local-test: default terp ports are busy; using 127.0.0.1:${RPC_PORT}/${GRPC_PORT}/${LCD_PORT}"
fi
if [[ -z "$PPROF_PORT" ]]; then
  for cand in 16060 16061 16062 16063 16064; do
    if ! port_busy "$cand"; then
      PPROF_PORT="$cand"
      break
    fi
  done
fi

RPC_ADDR="tcp://127.0.0.1:${RPC_PORT}"
P2P_ADDR="tcp://127.0.0.1:${P2P_PORT}"
API_ADDR="tcp://127.0.0.1:${LCD_PORT}"
GRPC_ADDR="127.0.0.1:${GRPC_PORT}"
RPC_HTTP="http://127.0.0.1:${RPC_PORT}"
LCD_HTTP="http://127.0.0.1:${LCD_PORT}"
GRPC_HTTP="http://127.0.0.1:${GRPC_PORT}"

STARTED_TERPD=0
cleanup() {
  if [[ "${_unset_secp:-}" == "1" ]]; then
    unset SEZS_DEPLOY_SECP256K1 || true
    unset SEZS_GRANTER_SECP256K1 || true
  fi
  if [[ "$STARTED_TERPD" == "1" && -f "$LAB/terpd.pid" ]]; then
    pid="$(cat "$LAB/terpd.pid" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  case "$SESSION" in
    *sezs-kms-*) rm -rf "$SESSION" ;;
  esac
}
trap cleanup EXIT

echo "kms-local-test: session $SESSION (loopback only)"

"$TERPD" init sezs-kms --chain-id "$CHAIN_ID" --home "$LAB" >"$LAB/logs/init.log" 2>&1
python3 - "$LAB" "$DENOM" <<'PY'
import json, sys
from pathlib import Path
home, denom = Path(sys.argv[1]), sys.argv[2]
gp = home / "config" / "genesis.json"
g = json.loads(gp.read_text())
gp.write_text(json.dumps(g).replace('"stake"', json.dumps(denom)))
app = home / "config" / "app.toml"
if app.exists():
    t = app.read_text()
    for a, b in [
        ('minimum-gas-prices = ""', 'minimum-gas-prices = "0%s"' % denom),
        ('minimum-gas-prices = "0stake"', 'minimum-gas-prices = "0%s"' % denom),
        ('minimum-gas-prices = "stake"', 'minimum-gas-prices = "0%s"' % denom),
    ]:
        t = t.replace(a, b)
    app.write_text(t)
print("genesis denoms set to", denom)
PY

# granter = curator role; operator = KMS grantee. Never print key files.
for name in granter operator coord service usher; do
  "$TERPD" keys add "$name" --keyring-backend test --home "$LAB" --output json \
    >"$LAB/key-secrets/${name}.json" 2>&1
  chmod 600 "$LAB/key-secrets/${name}.json"
done

addr() { "$TERPD" keys show "$1" -a --keyring-backend test --home "$LAB"; }
GRANTER_ADDR="$(addr granter)"
OPERATOR_ADDR="$(addr operator)"
COORD_ADDR="$(addr coord)"
SERVICE_ADDR="$(addr service)"
USHER_ADDR="$(addr usher)"
echo "kms-local-test: granter=$GRANTER_ADDR"
echo "kms-local-test: operator=$OPERATOR_ADDR"

for a in "$GRANTER_ADDR" "$OPERATOR_ADDR" "$COORD_ADDR" "$SERVICE_ADDR" "$USHER_ADDR"; do
  "$TERPD" genesis add-genesis-account "$a" "$GENESIS_AMT" --home "$LAB" >/dev/null
done
"$TERPD" genesis gentx granter "5000000000${DENOM}" --keyring-backend test --home "$LAB" --chain-id "$CHAIN_ID" >"$LAB/logs/gentx.log" 2>&1
"$TERPD" genesis collect-gentxs --home "$LAB" >"$LAB/logs/collect-gentxs.log" 2>&1

python3 - "$LAB" "$RPC_ADDR" "$P2P_ADDR" "$API_ADDR" "$GRPC_ADDR" <<'PY'
import pathlib, sys
home = pathlib.Path(sys.argv[1])
rpc, p2p, api, grpc = sys.argv[2:]
cfg = home / "config" / "config.toml"
app = home / "config" / "app.toml"
if cfg.exists():
    t = cfg.read_text()
    for a, b in [
        ("laddr = \"tcp://0.0.0.0:26657\"", f"laddr = \"{rpc}\""),
        ("laddr = \"tcp://127.0.0.1:26657\"", f"laddr = \"{rpc}\""),
        ("laddr = \"tcp://0.0.0.0:26656\"", f"laddr = \"{p2p}\""),
    ]:
        t = t.replace(a, b)
    cfg.write_text(t)
if app.exists():
    t = app.read_text()
    t2 = []
    section = None
    for line in t.splitlines(True):
        if line.startswith("["):
            section = line.strip()
        if section == "[api]" and line.startswith("enable ="):
            line = "enable = true\n"
        if section == "[api]" and "address" in line and line.strip().startswith("address"):
            line = f'address = "{api}"\n'
        if section == "[grpc]" and line.startswith("enable ="):
            line = "enable = true\n"
        if section == "[grpc]" and "address" in line and line.strip().startswith("address"):
            line = f'address = "{grpc}"\n'
        t2.append(line)
    app.write_text("".join(t2))
PY

echo "kms-local-test: starting terpd on 127.0.0.1"
nohup "$TERPD" start --home "$LAB" --rpc.laddr "$RPC_ADDR" --p2p.laddr "$P2P_ADDR" \
  --grpc.address "$GRPC_ADDR" --api.address "$API_ADDR" --grpc.enable \
  --rpc.pprof_laddr "127.0.0.1:${PPROF_PORT}" \
  >"$LAB/logs/terpd.log" 2>&1 &
echo $! >"$LAB/terpd.pid"
STARTED_TERPD=1

ready=0
for _ in $(seq 1 90); do
  if python3 - "$RPC_HTTP" <<'PY' 2>/dev/null
import sys, urllib.request
urllib.request.urlopen(sys.argv[1] + "/status", timeout=1)
PY
  then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  echo "kms-local-test: terpd RPC did not become ready (see $LAB/logs/terpd.log)" >&2
  tail -n 40 "$LAB/logs/terpd.log" >&2 || true
  exit 1
fi
grpc_ready=0
for _ in $(seq 1 30); do
  if port_busy "$GRPC_PORT"; then
    grpc_ready=1
    break
  fi
  sleep 1
done
if [[ "$grpc_ready" != "1" ]]; then
  echo "kms-local-test: terpd gRPC not listening on 127.0.0.1:${GRPC_PORT} (see $LAB/logs/terpd.log)" >&2
  tail -n 40 "$LAB/logs/terpd.log" >&2 || true
  exit 1
fi
echo "kms-local-test: terpd listening rpc=$RPC_HTTP grpc=$GRPC_HTTP"
height=0
for _ in $(seq 1 60); do
  height="$(python3 - "$RPC_HTTP" <<'PY' || true
import json,sys,urllib.request
raw=urllib.request.urlopen(sys.argv[1]+"/status", timeout=2).read()
print(json.loads(raw)["result"]["sync_info"]["latest_block_height"])
PY
)"
  if [[ "${height:-0}" =~ ^[0-9]+$ ]] && [[ "$height" -ge 1 ]]; then
    break
  fi
  sleep 1
done
if [[ "${height:-0}" -lt 1 ]]; then
  echo "kms-local-test: no first block yet (see $LAB/logs/terpd.log)" >&2
  tail -n 40 "$LAB/logs/terpd.log" >&2 || true
  exit 1
fi
echo "kms-local-test: terpd ready height=$height rpc=$RPC_HTTP grpc=$GRPC_HTTP"

# Export operator + granter secp into the environment. Never echo the values.
SEZS_DEPLOY_SECP256K1="$("$TERPD" keys export operator --unarmored-hex --unsafe --yes --keyring-backend test --home "$LAB" 2>/dev/null)"
SEZS_GRANTER_SECP256K1="$("$TERPD" keys export granter --unarmored-hex --unsafe --yes --keyring-backend test --home "$LAB" 2>/dev/null)"
export SEZS_DEPLOY_SECP256K1 SEZS_GRANTER_SECP256K1
_unset_secp=1

export NETWORK=local
export SEZS_NETWORK=local
export SEZS_CHAIN_ID="$CHAIN_ID"
export SEZS_LCD="$LCD_HTTP"
export SEZS_RPC="$RPC_HTTP"
export SEZS_GRPC="$GRPC_HTTP"
export STATE_FILE="$SESSION/cw-orch-state.json"
export SEZS_DEPLOYMENT_ID="sezs-kms-local"
export SEZS_SKIP_CIRCUIT_UPLOAD=1
export SEZS_MINIMAL_STACK=1
export CW_ORCH_GRANTER="$GRANTER_ADDR"
export SEZS_CURATOR="$GRANTER_ADDR"
export SEZS_COORD="$COORD_ADDR"
export SEZS_SERVICE="$SERVICE_ADDR"
export SEZS_USHER="$USHER_ADDR"
export SEZS_KMS_LOCAL_GRANT=1
export SEZS_SESSION_ROOT="$SESSION"
# Avoid the default lantern metadata path writing into the repo unexpectedly.
export SEZS_METADATA_PATH="$SESSION/lantern-night-nip52.json"
mkdir -p "$(dirname "$SEZS_METADATA_PATH")"

echo "kms-local-test: deploy as operator under CW_ORCH_GRANTER (store+instantiate grant)"
cd "$ROOT"
cargo run --manifest-path "$ROOT/packages/Cargo.toml" --bin sezs-orch-deploy --release

EVENT_ADDR=""
if [[ -f "$STATE_FILE" ]]; then
  EVENT_ADDR="$(python3 - "$STATE_FILE" <<'PY'
import json, sys
p = sys.argv[1]
try:
    data = json.loads(open(p).read())
except Exception:
    print("")
    raise SystemExit
# cw-orch state shapes vary; look for a bech32 that is not a code id.
found = ""
def walk(obj):
    global found
    if found:
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("address", "addr", "contract", "cw_event_manifold") and isinstance(v, str) and v.startswith("terp1") and len(v) > 20:
                found = v
                return
            walk(v)
    elif isinstance(obj, list):
        for v in obj:
            walk(v)
walk(data)
print(found)
PY
)"
fi
if [[ -z "$EVENT_ADDR" && -f "$ROOT/apps/sezs/dev/localterp/boot.json" ]]; then
  EVENT_ADDR="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("contract",""))' "$SESSION/boot.json" 2>/dev/null || true)"
fi
# Prefer terp-boot or orch output in the session.
if [[ -z "$EVENT_ADDR" ]]; then
  for cand in "$SESSION/terp-boot.json" "$SESSION/boot.json" "$ROOT/terp-boot.json"; do
    if [[ -f "$cand" ]]; then
      EVENT_ADDR="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("contract") or d.get("event") or "")' "$cand" 2>/dev/null || true)"
      [[ -n "$EVENT_ADDR" ]] && break
    fi
  done
fi
if [[ -z "$EVENT_ADDR" ]]; then
  # Last resort: scan deploy stdout was already printed; try state again more loosely.
  EVENT_ADDR="$(python3 - "$STATE_FILE" <<'PY' || true
import json,sys,re
text=open(sys.argv[1]).read()
ms=re.findall(r"terp1[0-9a-z]{38,}", text)
print(ms[0] if ms else "")
PY
)"
fi
if [[ -z "$EVENT_ADDR" ]]; then
  echo "kms-local-test: deploy finished but event address was not found in $STATE_FILE" >&2
  exit 1
fi
echo "kms-local-test: event=$EVENT_ADDR"

export SEZS_EVENT_CONTRACT="$EVENT_ADDR"
export SEZS_KMS_SCOPE=curate
echo "kms-local-test: curate as operator under a ContractExecutionAuthorization grant"
cargo run --manifest-path "$ROOT/packages/Cargo.toml" --bin sezs-orch-curate --release

echo "kms-local-test: ok (granter=$GRANTER_ADDR operator=$OPERATOR_ADDR event=$EVENT_ADDR)"
