#!/usr/bin/env bash
# Start a loopback-only terpd (latest terp-core + wasmvm), store cw420 +
# cw-event-manifold, and write a front-end boot file.
#
# Binds 127.0.0.1 only. No public testnet, no mainnet, no key printing.
# Lab keyring lives under SEZS_LOCALTERP_HOME (mode 0700). Key-add output is
# redirected to 0600 files that this script never cats or echoes.
set -euo pipefail

TERPD="${SEZS_V2_TERPD:-${TERPD:-terpd}}"
CHAIN_ID="${SEZS_CHAIN_ID:-sezs-local-1}"
MONIKER="${SEZS_MONIKER:-sezs-lab}"
HOME_DIR="${SEZS_LOCALTERP_HOME:-${SEZS_SESSION_ROOT:+$SEZS_SESSION_ROOT/terp}}"
HOME_DIR="${SEZS_LOCALTERP_HOME:-$PWD/.localterp}"
LAB="${HOME_DIR}"
RPC_ADDR="${SEZS_RPC_ADDR:-tcp://127.0.0.1:26657}"
P2P_ADDR="${SEZS_P2P_ADDR:-tcp://127.0.0.1:26656}"
API_ADDR="${SEZS_API_ADDR:-tcp://127.0.0.1:1317}"
GRPC_ADDR="${SEZS_GRPC_ADDR:-127.0.0.1:9090}"
DENOM="${SEZS_DENOM:-uterp}"
# A lab balance large enough to store wasm. Not a secret.
GENESIS_AMT="100000000000${DENOM}"
CW_AVE="${SEZS_CONTRACTS_CW_AVE:?set SEZS_CONTRACTS_CW_AVE}"
MANIFOLD="${CW_AVE}/contracts/cw-event-manifold"
CW420="${CW_AVE}/contracts/cw420"
SEZS_APP="${SEZS_APP:?set SEZS_APP}"
BOOT_OUT="${SEZS_BOOT_OUT:-${SEZS_APP}/dev/localterp/boot.json}"

log() { printf '[localterp] %s\n' "$*"; }

if [[ ! -x "$TERPD" ]]; then
  log "terpd not executable at $TERPD"
  exit 1
fi

umask 077
mkdir -p "$LAB/key-secrets" "$LAB/artifacts" "$LAB/logs" "$(dirname "$BOOT_OUT")"
chmod 700 "$LAB" "$LAB/key-secrets"

if [[ -f "$LAB/terpd.pid" ]] && kill -0 "$(cat "$LAB/terpd.pid")" 2>/dev/null; then
  log "terpd already running pid=$(cat "$LAB/terpd.pid")"
else
  if [[ ! -f "$LAB/config/genesis.json" ]]; then
    log "initializing $CHAIN_ID at $LAB"
    "$TERPD" init "$MONIKER" --chain-id "$CHAIN_ID" --home "$LAB" >/dev/null
    # Bond denom must be uterp (terpd init defaults to stake). Do this before gentx.
    python3 - "$LAB" "$DENOM" << 'PY'
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
    # Key material: redirect all output; never print.
    for name in curator coord service usher; do
      "$TERPD" keys add "$name" --keyring-backend test --home "$LAB" --output json \
        >"$LAB/key-secrets/${name}.json" 2>&1 || true
      chmod 600 "$LAB/key-secrets/${name}.json" 2>/dev/null || true
    done
    # Addresses only (safe to print). Bech32, no secrets.
    curator="$("$TERPD" keys show curator -a --keyring-backend test --home "$LAB")"
    "$TERPD" genesis add-genesis-account "$curator" "$GENESIS_AMT" --home "$LAB"
    "$TERPD" genesis gentx curator "5000000000${DENOM}" --keyring-backend test --home "$LAB" --chain-id "$CHAIN_ID" >/dev/null
    "$TERPD" genesis collect-gentxs --home "$LAB" >/dev/null
    # Restrict listeners to loopback if the config exists.
    python3 - "$LAB" "$RPC_ADDR" "$P2P_ADDR" "$API_ADDR" "$GRPC_ADDR" << 'PY'
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
    t = t.replace("enable = false", "enable = true", 1)  # api enable — first occurrence is usually [api]
    # more precise:
    t2 = []
    section = None
    for line in t.splitlines(True):
        if line.startswith("["):
            section = line.strip()
        if section == "[api]" and line.startswith("enable ="):
            line = "enable = true\n"
        if section == "[api]" and "address" in line and line.strip().startswith("address"):
            line = f'address = "{api}"\n'
        if section == "[grpc]" and "address" in line and line.strip().startswith("address"):
            line = f'address = "{grpc}"\n'
        t2.append(line)
    app.write_text("".join(t2))
PY
  fi
  log "starting terpd on 127.0.0.1"
  nohup "$TERPD" start --home "$LAB" \
    --rpc.laddr "$RPC_ADDR" \
    --p2p.laddr "$P2P_ADDR" \
    >"$LAB/logs/terpd.log" 2>&1 &
  echo $! >"$LAB/terpd.pid"
  log "terpd pid=$(cat "$LAB/terpd.pid")"
  # wait for RPC
  for i in $(seq 1 60); do
    if python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:26657/status', timeout=1)" 2>/dev/null; then
      break
    fi
    sleep 1
  done
fi

# Build wasm if needed (optimizer not required for local).
build_wasm() {
  local crate="$1" outname="$2"
  local wasm
  wasm="$(find "$crate/target/wasm32-unknown-unknown/release" -maxdepth 1 -name '*.wasm' 2>/dev/null | head -1 || true)"
  if [[ -n "${wasm}" && -f "$wasm" ]]; then
    echo "$wasm"
    return
  fi
  log "building $outname (wasm32)"
  export RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=-s -C link-arg=--allow-undefined"
  (cd "$crate" && cargo build --release --target wasm32-unknown-unknown --lib)
  find "$crate/target/wasm32-unknown-unknown/release" -maxdepth 1 -name '*.wasm' | head -1
}

# Store + instantiate when artifacts exist. This section is best-effort so a
# chain that is up can still be used while wasm compiles in a later run.
store_and_instantiate() {
  if [[ "${SEZS_SKIP_START_INSTANTIATE:-1}" == "1" ]]; then
    log "skip store_and_instantiate (session instantiate_event / upgrade-v2 owns this)"
    return 0
  fi
  command -v jq >/dev/null || { log "jq not found; skip instantiate"; return 0; }
  local man_wasm cw_wasm
  man_wasm="$(build_wasm "$MANIFOLD" cw-event-manifold || true)"
  cw_wasm="$(build_wasm "$CW420" cw420 || true)"
  if [[ -z "${cw_wasm:-}" || -z "${man_wasm:-}" ]]; then
    log "wasm artifacts not ready; chain is up, instantiate later"
    return 0
  fi
  cp -f "$cw_wasm" "$LAB/artifacts/cw420.wasm"
  cp -f "$man_wasm" "$LAB/artifacts/cw-event-manifold.wasm"
  local node="--node tcp://127.0.0.1:26657 --chain-id $CHAIN_ID --keyring-backend test --home $LAB --from curator --gas auto --gas-adjustment 1.4 --yes"
  # Addresses only.
  local curator coord_group
  curator="$("$TERPD" keys show curator -a --keyring-backend test --home "$LAB")"
  log "storing wasm (addresses only will be printed)"
  # tx output is parsed for code_id / address; do not dump raw key material.
  local tx
  tx="$("$TERPD" tx wasm store "$LAB/artifacts/cw420.wasm" $node --output json 2>/dev/null || true)"
  # Further instantiate steps are in seed.sh once code ids are known.
  printf '%s\n' "$tx" >"$LAB/logs/store-cw420.json" || true
  chmod 600 "$LAB/logs/store-cw420.json" 2>/dev/null || true
  log "store txs written under $LAB/logs (not printed)"
}

# Always write a boot skeleton; seed.sh fills the contract address.
python3 - "$BOOT_OUT" "$CHAIN_ID" << 'PY'
import json, pathlib, sys
out, chain = pathlib.Path(sys.argv[1]), sys.argv[2]
prev = {}
if out.exists():
    try:
        prev = json.loads(out.read_text())
    except Exception:
        prev = {}
boot = {
    "contract": prev.get("contract", ""),
    "lcd": "http://127.0.0.1:1317",
    "chainId": chain,
    "rpc": "http://127.0.0.1:26657",
}
out.write_text(json.dumps(boot, indent=2) + "\n")
print("boot written", out)
PY

log "lcd=http://127.0.0.1:1317 chain_id=$CHAIN_ID"
log "point the front end at ?contract=<addr>&lcd=http://127.0.0.1:1317&chainId=$CHAIN_ID"
