#!/usr/bin/env bash
# SEZS / Speak-Ez Sessions local session environment for ict-rs.
#
# Spawns (or reuses) a loopback-only ephemeral stack:
#   - single-node Terp (terpd + zk-wasmvm)
#   - single-node Zcash regtest (host zakurad v1.8.9 when ZAKURAD_BIN is set)
#   - compact/light wallet sidecar (lightwalletd on loopback)
#   - single-node Penumbra v2.0.8 (pd + cometbft 0.37.18 + kms)
#   - Penumbra↔Terp IBC relayer (Hermes, when HERMES_BIN is set)
#   - session backends: sezs-server (one bind), sezs-outpost, minirelay
#
# There is no IBC relayer for Zcash↔Penumbra in this tree: Zcash is not a
# Cosmos chain. This script records that gap honestly and does not fake one.
#
# Binds 127.0.0.1 only. Never joins rotko, relay.zafu.pro, penumbra.zone,
# morocco-1, or mainnet. Does not print keys, seeds, or .env values.
#
# Usage:
#   scripts/sezs_session_env.sh up|health|status|seed|instantiate|down|teardown-check
#   cargo run -p ict-rs --example sezs_session_env -- up
set -euo pipefail

cmd="${1:-health}"

refuse_public() {
  local name="$1" val="${2:-}"
  case "$val" in
    *rotko*|*relay.zafu.pro*|*penumbra.zone*|*penumbra-1*|*morocco-1*|*zcash.rotko*)
      echo "refusing public endpoint in $name" >&2
      exit 2
      ;;
  esac
}

for v in PENUMBRA_PD_JOIN_URL JOIN_RPC PENUMBRA_RPC PD_JOIN HERMES_PENUMBRA_RPC \
         SEZS_ZIRC_RELAY SEZS_FROST_BOUNCER ZCASH_DEVTOOL_SERVER ZAKURA_RPC; do
  refuse_public "$v" "${!v:-}"
done

log() { printf '[sezs-session] %s\n' "$*"; }

need_loopback_bind() {
  # Every listen address we write must be loopback.
  local addr="$1"
  case "$addr" in
    127.0.0.1:*|tcp://127.0.0.1:*|http://127.0.0.1:*|http://localhost:*|tcp://localhost:*|127.0.0.1) return 0 ;;
    *) echo "refusing non-loopback bind: $addr" >&2; exit 2 ;;
  esac
}

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${SEZS_SESSION_ROOT:-${SEZS_SESSION_ROOT_DEFAULT:-}}"
if [[ -z "$ROOT" ]]; then
  if [[ -f /tmp/sezs-session/current/session.json ]]; then
    ROOT="$(python3 -c 'import json,sys; print(json.load(open("/tmp/sezs-session/current/session.json")).get("root",""))' 2>/dev/null || true)"
  fi
fi
if [[ -z "$ROOT" ]]; then
  ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sezs-session-XXXX")"
fi
mkdir -p "$ROOT/logs" "$ROOT/run" "$ROOT/data"
chmod 700 "$ROOT" "$ROOT/run" 2>/dev/null || true
SESSION="$ROOT/session.json"
PIDFILE="$ROOT/run/pids"
: > "$PIDFILE.entering" 2>/dev/null || true

HOME_DIR="${HOME:-$HOME}"
SEZS_BINS="${SEZS_BINS:-$HOME_DIR/.ict-rs/bins}"
SEZS_APP="${SEZS_APP:?set SEZS_APP to the apps/sezs directory}"
TERPD="${SEZS_V2_TERPD:-${TERPD:-terpd}}"
LOCALTERP="$SEZS_APP/dev/localterp/start.sh"
# Official / session-local binaries. Never print their contents.
pick_bin() {
  local var="$1" candidate="$2"
  if [[ -n "${!var:-}" && -x "${!var}" ]]; then
    return 0
  fi
  if [[ -x "$candidate" ]]; then
    printf -v "$var" '%s' "$candidate"
  fi
}
pick_bin ZAKURAD_BIN "$SEZS_BINS/zakurad"
pick_bin PD_BIN "$SEZS_BINS/pd"
pick_bin PCLI_BIN "$SEZS_BINS/pcli"
pick_bin COMETBFT_BIN "$SEZS_BINS/cometbft"
pick_bin LIGHTWALLETD_BIN "$SEZS_BINS/lightwalletd"
pick_bin HERMES_BIN "$SEZS_BINS/hermes"
pick_bin KMS_BIN "${KMS_BIN:-kms}"

# Default ports: reuse the established SEZS loopback map when free, else keep them
# if SEZS_SESSION_REUSE=1 (default) and a service is already healthy.
BIND="127.0.0.1"
TERP_CHAIN_ID="${SEZS_CHAIN_ID:-sezs-local-1}"
TERP_RPC_PORT="${SEZS_RPC_PORT:-26657}"
TERP_P2P_PORT="${SEZS_P2P_PORT:-26656}"
TERP_LCD_PORT="${SEZS_LCD_PORT:-1317}"
TERP_GRPC_PORT="${SEZS_GRPC_PORT:-9090}"
ZAKURA_RPC_PORT="${ZAKURA_RPC_PORT:-18232}"
ZAKURA_P2P_PORT="${ZAKURA_P2P_PORT:-18233}"
ZAKURA_METRICS_PORT="${ZAKURA_METRICS_PORT:-19901}"
LIGHTWALLETD_PORT="${LIGHTWALLETD_PORT:-19067}"
PENUMBRA_RPC_PORT="${PENUMBRA_RPC_PORT:-27657}"
PENUMBRA_P2P_PORT="${PENUMBRA_P2P_PORT:-27656}"
PENUMBRA_ABCI_PORT="${PENUMBRA_ABCI_PORT:-27658}"
PENUMBRA_PRIVVAL_PORT="${PENUMBRA_PRIVVAL_PORT:-27659}"
PENUMBRA_GRPC_PORT="${PENUMBRA_GRPC_PORT:-28080}"
PENUMBRA_METRICS_PORT="${PENUMBRA_METRICS_PORT:-19000}"
NEXT_PORT="${SEZS_NEXT_PORT:-3051}"
# One-bind Rust backend (replaces Node splash / session / email / payroll).
SEZS_SERVER_PORT="${SEZS_BIND:-${SEZS_SESSION_PORT:-${SEZS_SPLASH_PORT:-3058}}}"
# Allow SEZS_BIND=127.0.0.1:3058 or a bare port.
if [[ "$SEZS_SERVER_PORT" == *:* ]]; then
  SEZS_SERVER_PORT="${SEZS_SERVER_PORT##*:}"
fi
OUTPOST_PORT="${SEZS_OUTPOST_PORT:-${SEZS_BLE_HELPER_PORT:-3061}}"
RELAY_PORT="${SEZS_RELAY_PORT:-3053}"
# Historical aliases (no Node bouncer / frostd-lite process is started).
SPLASH_PORT="$SEZS_SERVER_PORT"
BOUNCER_PORT="${SEZS_BOUNCER_PORT:-3055}"
FROSTD_PORT="${FROSTD_LITE_PORT:-3056}"

need_loopback_bind "$BIND:$TERP_RPC_PORT"
need_loopback_bind "http://$BIND:$SEZS_SERVER_PORT"
need_loopback_bind "http://$BIND:$OUTPOST_PORT"

export SEZS_SERVER_PORT OUTPOST_PORT SEZS_SESSION_PORT="$SEZS_SERVER_PORT" SEZS_OUTPOST_PORT="$OUTPOST_PORT"


tcp_up() {
  python3 - "$BIND" "$1" << 'PY'
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
s = socket.socket()
s.settimeout(0.4)
try:
    s.connect((host, port))
    sys.exit(0)
except Exception:
    sys.exit(1)
finally:
    s.close()
PY
}

http_up() {
  local url="$1"
  refuse_public url "$url"
  curl -sf --max-time 2 "$url" >/dev/null 2>&1
}

record_pid() {
  local name="$1" pid="$2" owned="${3:-1}"
  mkdir -p "$ROOT/run"
  printf '%s %s %s\n' "$name" "$pid" "$owned" >>"$ROOT/run/pidlist"
}

write_session() {
  python3 - "$SESSION" "$ROOT" << PY
import json, pathlib, sys, os
out, root = pathlib.Path(sys.argv[1]), sys.argv[2]
prev = {}
if out.exists():
    try:
        prev = json.loads(out.read_text())
    except Exception:
        prev = {}
# Ports and health only. Never keys.
import socket
def port_up(port):
    try:
        s = socket.create_connection(("127.0.0.1", int(port)), timeout=0.4)
        s.close()
        return True
    except Exception:
        return False
zakura_ok = port_up(os.environ.get("ZAKURA_RPC_PORT", "18232"))
lwd_ok = port_up(os.environ.get("LIGHTWALLETD_PORT", "19067"))
pd_ok = port_up(os.environ.get("PENUMBRA_RPC_PORT", "27657"))
pd_grpc_ok = port_up(os.environ.get("PENUMBRA_GRPC_PORT", "28080"))
data = {
    "root": root,
    "bind": "127.0.0.1",
    "terp": {"chain_id": os.environ.get("SEZS_CHAIN_ID", "sezs-local-1"),
             "rpc": f"http://127.0.0.1:{os.environ.get('SEZS_RPC_PORT','26657')}",
             "lcd": f"http://127.0.0.1:{os.environ.get('SEZS_LCD_PORT','1317')}",
             "grpc": f"127.0.0.1:{os.environ.get('SEZS_GRPC_PORT','9090')}"},
    "zakura": {"rpc": f"http://127.0.0.1:{os.environ.get('ZAKURA_RPC_PORT','18232')}", "lightwalletd": f"http://127.0.0.1:{os.environ.get('LIGHTWALLETD_PORT','19067')}", "ok": zakura_ok, "lightwalletd_ok": lwd_ok},
    "penumbra": {"rpc": f"http://127.0.0.1:{os.environ.get('PENUMBRA_RPC_PORT','27657')}",
                 "grpc": f"http://127.0.0.1:{os.environ.get('PENUMBRA_GRPC_PORT','28080')}", "pd": f"http://127.0.0.1:{os.environ.get('PENUMBRA_GRPC_PORT','28080')}", "ok": pd_ok and pd_grpc_ok},
    "backends": {
        "next": f"http://127.0.0.1:{os.environ.get('SEZS_NEXT_PORT','3051')}",
        "sezs_server": f"http://127.0.0.1:{os.environ.get('SEZS_SERVER_PORT', os.environ.get('SEZS_SESSION_PORT','3058'))}",
        "sezs_outpost": f"http://127.0.0.1:{os.environ.get('OUTPOST_PORT', os.environ.get('SEZS_OUTPOST_PORT','3061'))}",
        "minirelay": f"http://127.0.0.1:{os.environ.get('SEZS_RELAY_PORT','3053')}",
    },
    "relayers": {
        "penumbra_terp": "hermes when HERMES_BIN is set",
        "zcash_penumbra": "not implemented: Zcash is not an IBC chain; no relayer exists in this tree",
    },
    "notes": prev.get("notes", []),
}
pathlib.Path(out).write_text(json.dumps(data, indent=2) + "\n")
# convenience pointer (no secrets)
ptr = pathlib.Path("/tmp/sezs-session/current")
ptr.mkdir(parents=True, exist_ok=True)
(ptr / "session.json").write_text(json.dumps({"root": root, "session": str(out)}) + "\n")
print("session written", out)
PY
}

status_one() {
  local name="$1" port="$2" kind="${3:-tcp}" url="${4:-}"
  local ok="down"
  if [[ "$kind" == "http" && -n "$url" ]]; then
    if http_up "$url"; then ok="up"; fi
  else
    if tcp_up "$port"; then ok="up"; fi
  fi
  printf '  %-16s %s :%s\n' "$name" "$ok" "$port"
  [[ "$ok" == "up" ]]
}

do_health() {
  log "health @ $ROOT"
  local fails=0
  status_one terp-rpc "$TERP_RPC_PORT" || fails=$((fails+1))
  status_one terp-lcd "$TERP_LCD_PORT" http "http://$BIND:$TERP_LCD_PORT/cosmos/base/tendermint/v1beta1/node_info" || fails=$((fails+1))
  status_one sezs-server "$SEZS_SERVER_PORT" http "http://$BIND:$SEZS_SERVER_PORT/sezs/session/health" || fails=$((fails+1))
  status_one sezs-outpost "$OUTPOST_PORT" http "http://$BIND:$OUTPOST_PORT/health" || fails=$((fails+1))
  status_one minirelay "$RELAY_PORT" http "http://$BIND:$RELAY_PORT/health" || fails=$((fails+1))
  # optional chains
  if tcp_up "$ZAKURA_RPC_PORT"; then
    status_one zakura-rpc "$ZAKURA_RPC_PORT" || true
  else
    printf '  %-16s %s :%s\n' "zakura-rpc" "optional-down" "$ZAKURA_RPC_PORT"
  fi
  if tcp_up "$LIGHTWALLETD_PORT"; then
    status_one lightwalletd "$LIGHTWALLETD_PORT" || true
  else
    printf '  %-16s %s :%s\n' "lightwalletd" "optional-down" "$LIGHTWALLETD_PORT"
  fi
  if tcp_up "$PENUMBRA_RPC_PORT"; then
    status_one penumbra-rpc "$PENUMBRA_RPC_PORT" || true
  else
    printf '  %-16s %s :%s\n' "penumbra-rpc" "optional-down" "$PENUMBRA_RPC_PORT"
  fi
  if tcp_up "$PENUMBRA_GRPC_PORT"; then
    status_one penumbra-grpc "$PENUMBRA_GRPC_PORT" || true
  else
    printf '  %-16s %s :%s\n' "penumbra-grpc" "optional-down" "$PENUMBRA_GRPC_PORT"
  fi
  if pgrep -f "[h]ermes --config $ROOT/hermes/config.toml" >/dev/null 2>&1; then
    printf '  %-16s %s\n' "hermes-penumbra-terp" "up"
  elif [[ -f "$ROOT/hermes/config.toml" ]]; then
    printf '  %-16s %s\n' "hermes-penumbra-terp" "configured-not-running"
  else
    printf '  %-16s %s\n' "hermes-penumbra-terp" "not-started (set HERMES_BIN)"
  fi
  printf '  %-16s %s\n' "zcash-penumbra-relay" "none (not an IBC path; see module docs)"
  write_session >/dev/null
  if [[ "$fails" -gt 0 ]]; then
    log "core services down: $fails"
    return 1
  fi
  log "core backends + terp are up"
  return 0
}

start_terp() {
  if tcp_up "$TERP_RPC_PORT"; then
    log "reusing terpd already listening on $BIND:$TERP_RPC_PORT (not owned by this session)"
    record_pid terpd "reuse" 0
    return 0
  fi
  if [[ ! -x "$TERPD" ]]; then
    log "terpd not executable at \$TERPD — skip terp spawn"
    return 1
  fi
  if [[ ! -f "$LOCALTERP" ]]; then
    log "localterp start.sh missing — skip terp spawn"
    return 1
  fi
  local home="${SEZS_LOCALTERP_HOME:-$ROOT/terp}"
  mkdir -p "$home"
  chmod 700 "$home"
  log "starting terpd via localterp (loopback only, home under session root)"
  SEZS_LOCALTERP_HOME="$home" \
  SEZS_CHAIN_ID="$TERP_CHAIN_ID" \
  SEZS_RPC_ADDR="tcp://$BIND:$TERP_RPC_PORT" \
  SEZS_P2P_ADDR="tcp://$BIND:$TERP_P2P_PORT" \
  SEZS_API_ADDR="tcp://$BIND:$TERP_LCD_PORT" \
  SEZS_GRPC_ADDR="$BIND:$TERP_GRPC_PORT" \
  TERPD="$TERPD" \
  SEZS_BOOT_OUT="$ROOT/terp-boot.json" \
  bash "$LOCALTERP" >"$ROOT/logs/terp-start.log" 2>&1 || {
    log "localterp start failed (see logs/terp-start.log, no secrets printed here)"
    return 1
  }
  if [[ -f "$home/terpd.pid" ]]; then
    record_pid terpd "$(cat "$home/terpd.pid")" 1
  fi
}

start_zakura() {
  if tcp_up "$ZAKURA_RPC_PORT"; then
    log "reusing zakura RPC on :$ZAKURA_RPC_PORT"
    record_pid zakura "reuse" 0
    return 0
  fi
  if [[ -z "${ZAKURAD_BIN:-}" || ! -x "${ZAKURAD_BIN:-}" ]]; then
    log "ZAKURAD_BIN missing — Zcash regtest not started"
    return 0
  fi
  local cfgdir="$ROOT/zakura"
  mkdir -p "$cfgdir"
  chmod 700 "$cfgdir"
  # Host zakurad: loopback only, session-scoped regtest, cookie auth off
  # so lightwalletd can connect. Matches the ict-rs corridor activations.
  mkdir -p "$cfgdir/state"
  chmod 700 "$cfgdir/state"
  if [[ -z "${SEZS_ZEC_MINER_ADDRESS:-}" && -n "${SEZS_ZEC_MINER_ADDRESS_FILE:-}" && -f "${SEZS_ZEC_MINER_ADDRESS_FILE}" ]]; then
    SEZS_ZEC_MINER_ADDRESS="$(tr -d "[:space:]" < "${SEZS_ZEC_MINER_ADDRESS_FILE}")"
  fi
  if [[ -z "${SEZS_ZEC_MINER_ADDRESS:-}" && -f "$ROOT/zec-frost/miner.addr" ]]; then
    SEZS_ZEC_MINER_ADDRESS="$(tr -d "[:space:]" < "$ROOT/zec-frost/miner.addr")"
  fi
  local miner_on=false
  case "${SEZS_ZAKURA_INTERNAL_MINER:-false}" in 1|true|TRUE|yes) miner_on=true ;; esac
  cat >"$cfgdir/zakurad.toml" <<EOF
# Generated by sezs_session_env.sh — session-local regtest, 127.0.0.1 only.
[network]
network = "Regtest"
listen_addr = "127.0.0.1:${ZAKURA_P2P_PORT}"
p2p_stack = "legacy"
cache_dir = false
initial_testnet_peers = []
max_connections_per_ip = 4

[network.testnet_parameters.activation_heights]
NU5 = 1
NU6 = 1
"NU6.1" = 2
"NU6.2" = 2
"NU6.3" = 2

[[network.testnet_parameters.funding_streams]]
height_range = { start = 1, end = 2 }
recipients = [{ receiver = "Deferred", numerator = 1 }]

[[network.testnet_parameters.lockbox_disbursements]]
address = "t2RnBRiqrN1nW4ecZs1Fj3WWjNdnSs4kiX8"
amount = 6250000

[state]
ephemeral = false
cache_dir = "$cfgdir/state"

[rpc]
listen_addr = "127.0.0.1:${ZAKURA_RPC_PORT}"
enable_cookie_auth = false

[metrics]
endpoint_addr = "127.0.0.1:${ZAKURA_METRICS_PORT}"

[mining]
internal_miner = ${miner_on}
miner_address = "${SEZS_ZEC_MINER_ADDRESS:-tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs}"

[tracing]
filter = "info"
EOF
  log "starting zakurad (regtest) on $BIND:$ZAKURA_RPC_PORT"
  nohup "$ZAKURAD_BIN" --config "$cfgdir/zakurad.toml" start >"$ROOT/logs/zakura.log" 2>&1 &
  record_pid zakura "$!" 1
  local i
  for i in $(seq 1 90); do
    if tcp_up "$ZAKURA_RPC_PORT"; then
      log "zakurad is listening"
      return 0
    fi
    sleep 0.5
  done
  log "zakurad did not listen (see logs/zakura.log)"
  return 1
}

start_lightwalletd() {
  if tcp_up "$LIGHTWALLETD_PORT"; then
    log "reusing lightwalletd on :$LIGHTWALLETD_PORT"
    record_pid lightwalletd "reuse" 0
    return 0
  fi
  if [[ -z "${LIGHTWALLETD_BIN:-}" || ! -x "${LIGHTWALLETD_BIN:-}" ]]; then
    log "LIGHTWALLETD_BIN missing — compact wallet sidecar not started"
    return 0
  fi
  if ! tcp_up "$ZAKURA_RPC_PORT"; then
    log "zakura RPC is down — skip lightwalletd"
    return 0
  fi
  mkdir -p "$ROOT/lightwalletd"
  chmod 700 "$ROOT/lightwalletd"
  # Dummy RPC creds: zakura cookie auth is off. Values are not logged.
  log "starting lightwalletd on $BIND:$LIGHTWALLETD_PORT"
  nohup "$LIGHTWALLETD_BIN" \
    --no-tls-very-insecure \
    --grpc-bind-addr "$BIND:$LIGHTWALLETD_PORT" \
    --http-bind-addr "$BIND:19068" \
    --rpchost "$BIND" \
    --rpcport "$ZAKURA_RPC_PORT" \
    --rpcuser sezs \
    --rpcpassword sezs \
    --no-backend-check \
    --data-dir "$ROOT/lightwalletd" \
    --log-file "$ROOT/logs/lightwalletd.log" \
    >"$ROOT/logs/lightwalletd-stdio.log" 2>&1 &
  record_pid lightwalletd "$!" 1
  local i
  for i in $(seq 1 40); do
    if tcp_up "$LIGHTWALLETD_PORT"; then
      log "lightwalletd is listening"
      return 0
    fi
    sleep 0.4
  done
  log "lightwalletd did not listen (see logs/lightwalletd.log)"
  return 1
}


start_penumbra() {
  if tcp_up "$PENUMBRA_RPC_PORT"; then
    log "reusing penumbra RPC on :$PENUMBRA_RPC_PORT"
    record_pid penumbra "reuse" 0
    return 0
  fi
  if [[ -z "${PD_BIN:-}" || -z "${COMETBFT_BIN:-}" || -z "${KMS_BIN:-}" ]]; then
    log "PD_BIN / COMETBFT_BIN / KMS_BIN not all set — Penumbra not started"
    return 0
  fi
  local script="$HERE/penumbra_kms_local.sh"
  if [[ ! -f "$script" ]]; then
    log "penumbra_kms_local.sh missing"
    return 0
  fi
  prepare_penumbra_allocation || true
  log "starting local Penumbra via penumbra_kms_local.sh (KEEP_RUNNING, loopback)"
  local alloc=""
  if [[ -f "$ROOT/penumbra/allocation.addr" ]]; then
    alloc="$(tr -d '[:space:]' < "$ROOT/penumbra/allocation.addr")"
  fi
  KEEP_RUNNING=1 \
  PENUMBRA_ROOT="$ROOT/penumbra" \
  CHAIN_ID="${PENUMBRA_CHAIN_ID:-penumbra-sezs-local}" \
  RPC_PORT="$PENUMBRA_RPC_PORT" \
  P2P_PORT="$PENUMBRA_P2P_PORT" \
  ABCI_PORT="$PENUMBRA_ABCI_PORT" \
  PRIVVAL_PORT="$PENUMBRA_PRIVVAL_PORT" \
  GRPC_PORT="$PENUMBRA_GRPC_PORT" \
  METRICS_PORT="$PENUMBRA_METRICS_PORT" \
  STEWARD_PPROF_LADDR="127.0.0.1:19001" \
  PD_BIN="$PD_BIN" COMETBFT_BIN="$COMETBFT_BIN" KMS_BIN="$KMS_BIN" \
  ALLOCATION_ADDRESS="${ALLOCATION_ADDRESS:-$alloc}" \
    nohup bash "$script" >"$ROOT/logs/penumbra.log" 2>&1 &
  record_pid penumbra-script "$!" 1
  local i
  for i in $(seq 1 90); do
    if tcp_up "$PENUMBRA_RPC_PORT" && tcp_up "$PENUMBRA_GRPC_PORT"; then
      log "penumbra pd/cometbft is listening"
      return 0
    fi
    sleep 0.5
  done
  log "penumbra did not come up (see logs/penumbra.log)"
  return 1
}

# Create a session pcli home and write only an address file for genesis funding.
# Threshold deal output can contain secrets — it is written 0600 and never logged.
prepare_penumbra_allocation() {
  if [[ ! -x "${PCLI_BIN:-}" ]]; then
    return 0
  fi
  mkdir -p "$ROOT/pcli" "$ROOT/penumbra"
  chmod 700 "$ROOT/pcli"
  if [[ -s "$ROOT/penumbra/allocation.addr" ]]; then
    return 0
  fi
  local grpc="http://$BIND:$PENUMBRA_GRPC_PORT"
  if "$PCLI_BIN" init --help 2>/dev/null | grep -q "threshold"; then
    log "initializing pcli 2-of-3 threshold homes under session root (secrets not logged)"
    mkdir -p "$ROOT/pcli/seat0" "$ROOT/pcli/seat1" "$ROOT/pcli/seat2"
    chmod 700 "$ROOT/pcli/seat0" "$ROOT/pcli/seat1" "$ROOT/pcli/seat2"
    if "$PCLI_BIN" --home "$ROOT/pcli/seat0" init --grpc-url "$grpc" threshold deal -t 2 \
         --home "$ROOT/pcli/seat0" --home "$ROOT/pcli/seat1" --home "$ROOT/pcli/seat2" \
         >"$ROOT/pcli/deal.out" 2>"$ROOT/pcli/deal.err"; then
      chmod 600 "$ROOT/pcli/deal.out" "$ROOT/pcli/deal.err" 2>/dev/null || true
    else
      chmod 600 "$ROOT/pcli/deal.out" "$ROOT/pcli/deal.err" 2>/dev/null || true
      log "pcli threshold deal failed (see deal.err, not printed) — falling back to soft-kms"
      "$PCLI_BIN" --home "$ROOT/pcli/treasury" init --grpc-url "$grpc" soft-kms >/dev/null 2>"$ROOT/pcli/init.err" || true
      chmod 600 "$ROOT/pcli/init.err" 2>/dev/null || true
    fi
  else
    log "pcli has no threshold init — using soft-kms treasury (approval gate only)"
    mkdir -p "$ROOT/pcli/treasury"
    chmod 700 "$ROOT/pcli/treasury"
    "$PCLI_BIN" --home "$ROOT/pcli/treasury" init --grpc-url "$grpc" soft-kms >/dev/null 2>"$ROOT/pcli/init.err" || true
    chmod 600 "$ROOT/pcli/init.err" 2>/dev/null || true
  fi
  local home="$ROOT/pcli/seat0"
  if [[ ! -d "$home" ]]; then
    home="$ROOT/pcli/treasury"
  fi
  if [[ -d "$home" ]]; then
    "$PCLI_BIN" --home "$home" view address >"$ROOT/penumbra/allocation.addr" 2>"$ROOT/pcli/addr.err" || true
    chmod 644 "$ROOT/penumbra/allocation.addr" 2>/dev/null || true
    chmod 600 "$ROOT/pcli/addr.err" 2>/dev/null || true
    if [[ -s "$ROOT/penumbra/allocation.addr" ]]; then
      log "wrote genesis allocation address (address only)"
    else
      log "could not obtain a pcli address for genesis allocation"
    fi
  fi
}

start_hermes() {
  if [[ -z "${HERMES_BIN:-}" || ! -x "${HERMES_BIN:-}" ]]; then
    log "HERMES_BIN unset — Penumbra↔Terp relayer not started"
    return 0
  fi
  if ! tcp_up "$PENUMBRA_RPC_PORT" || ! tcp_up "$TERP_RPC_PORT"; then
    log "terp or penumbra RPC down — skip hermes"
    return 0
  fi
  log "Hermes: loopback Penumbra↔Terp ICS-20 only (no Zcash packet relayer)."
  local helper="$HERE/sezs_hermes_local.sh"
  if [[ -x "$helper" ]]; then
    SEZS_SESSION_ROOT="$ROOT" HERMES_BIN="$HERMES_BIN" PCLI_BIN="${PCLI_BIN:-}" \
    TERPD="$TERPD" PENUMBRA_CHAIN_ID="${PENUMBRA_CHAIN_ID:-penumbra-sezs-local}" \
    PENUMBRA_RPC_PORT="$PENUMBRA_RPC_PORT" PENUMBRA_GRPC_PORT="$PENUMBRA_GRPC_PORT" \
      bash "$helper" prepare || log "hermes prepare failed (see $ROOT/hermes, not secrets)"
  fi
  if [[ -f "$ROOT/hermes/config.toml" ]]; then
    if pgrep -f "[h]ermes --config $ROOT/hermes/config.toml" >/dev/null 2>&1; then
      log "reusing session hermes"
      record_pid hermes "reuse" 0
      return 0
    fi
    HOME="$ROOT/hermes/home" nohup "$HERMES_BIN" --config "$ROOT/hermes/config.toml" start >"$ROOT/logs/hermes.log" 2>&1 &
    record_pid hermes "$!" 1
    log "hermes started"
  else
    log "hermes config was not written — relayer not started"
  fi
}

start_backends() {
  if [[ ! -d "$SEZS_APP" ]]; then
    log "SEZS_APP missing at expected path — cannot start backends"
    return 1
  fi
  # Prefer nvm 24 when present; do not print toolchain trivia beyond the version used.
  if [[ -s "$HOME_DIR/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    . "$HOME_DIR/.nvm/nvm.sh"
    nvm use 24.18.0 >/dev/null 2>&1 || nvm use 24 >/dev/null 2>&1 || true
  fi
  export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
  if ! command -v node >/dev/null; then
    log "node not on PATH — cannot start backends"
    return 1
  fi

  export SEZS_ZIRC_RELAY="http://$BIND:$RELAY_PORT"
  export RELAY_URL="http://$BIND:$RELAY_PORT"
  export SEZS_SPLASH_APP="http://$BIND:$NEXT_PORT"
  export SEZS_SESSION_PORT="$SEZS_SERVER_PORT"
  export SEZS_BIND="$SEZS_SERVER_PORT"
  export SEZS_STATE_DIR="${SEZS_STATE_DIR:-$ROOT/sezs-server}"
  export SEZS_OUTPOST_PORT="$OUTPOST_PORT"
  export NODE_ENV="${NODE_ENV:-development}"
  refuse_public SEZS_ZIRC_RELAY "$SEZS_ZIRC_RELAY"
  mkdir -p "$SEZS_STATE_DIR"
  chmod 700 "$SEZS_STATE_DIR" 2>/dev/null || true

  SEZS_REPO="${SEZS_REPO:-$(cd "$SEZS_APP/../.." && pwd)}"
  SERVER_BIN="${SEZS_SERVER_BIN:-$SEZS_REPO/crates/target/release/sezs-server}"
  OUTPOST_BIN="${SEZS_OUTPOST_BIN:-$SEZS_REPO/crates/target/release/sezs-outpost}"

  if ! http_up "http://$BIND:$RELAY_PORT/health"; then
    if [[ -x "$SEZS_APP/dev/minirelay-loopback/target/release/sezs-minirelay-loopback" ]]; then
      log "starting minirelay on $BIND:$RELAY_PORT"
      MINIRELAY_BIND="$BIND" MINIRELAY_PORT="$RELAY_PORT" \
        nohup "$SEZS_APP/dev/minirelay-loopback/target/release/sezs-minirelay-loopback" \
        >"$ROOT/logs/minirelay.log" 2>&1 &
      record_pid minirelay "$!" 1
    else
      log "minirelay binary missing — skip (build sezs-minirelay-loopback)"
    fi
  else
    log "reusing minirelay"
    record_pid minirelay "reuse" 0
  fi

  if ! http_up "http://$BIND:$SEZS_SERVER_PORT/sezs/session/health"; then
    if [[ ! -x "$SERVER_BIN" ]]; then
      log "building sezs-server"
      cargo build --manifest-path "$SEZS_REPO/crates/Cargo.toml" --release -p sezs-server
    fi
    log "starting sezs-server on $BIND:$SEZS_SERVER_PORT"
    nohup env SEZS_BIND="$SEZS_SERVER_PORT" SEZS_SESSION_HOST="$BIND" SEZS_STATE_DIR="$SEZS_STATE_DIR" \
      "$SERVER_BIN" >"$ROOT/logs/sezs-server.log" 2>&1 &
    record_pid sezs-server "$!" 1
  else
    log "reusing sezs-server"
    record_pid sezs-server "reuse" 0
  fi

  if ! http_up "http://$BIND:$OUTPOST_PORT/health"; then
    if [[ ! -x "$OUTPOST_BIN" ]]; then
      log "building sezs-outpost"
      cargo build --manifest-path "$SEZS_REPO/crates/Cargo.toml" --release -p sezs-outpost
    fi
    log "starting sezs-outpost on $BIND:$OUTPOST_PORT"
    nohup env SEZS_OUTPOST_HOST="$BIND" SEZS_OUTPOST_PORT="$OUTPOST_PORT" SEZS_BLE_HELPER_PORT="$OUTPOST_PORT" \
      "$OUTPOST_BIN" >"$ROOT/logs/sezs-outpost.log" 2>&1 &
    record_pid sezs-outpost "$!" 1
  else
    log "reusing sezs-outpost"
    record_pid sezs-outpost "reuse" 0
  fi
}

wait_core() {
  local i
  for i in $(seq 1 40); do
    if http_up "http://$BIND:$SEZS_SERVER_PORT/sezs/session/health" \
       && http_up "http://$BIND:$OUTPOST_PORT/health"; then
      return 0
    fi
    sleep 0.4
  done
  return 1
}


# SEZS loopback ports this session may own. Never include hs-preview
# (47080/47090/47658) or a shared docs server on :3054.
SESSION_PORTS=(
  "$TERP_RPC_PORT" "$TERP_P2P_PORT" "$TERP_LCD_PORT" "$TERP_GRPC_PORT"
  "$ZAKURA_RPC_PORT" "$ZAKURA_P2P_PORT" "$ZAKURA_METRICS_PORT" "$LIGHTWALLETD_PORT"
  "$PENUMBRA_RPC_PORT" "$PENUMBRA_P2P_PORT" "$PENUMBRA_ABCI_PORT" "$PENUMBRA_PRIVVAL_PORT"
  "$PENUMBRA_GRPC_PORT" "$PENUMBRA_METRICS_PORT"
  "$NEXT_PORT" "$SEZS_SERVER_PORT" "$OUTPOST_PORT" "$RELAY_PORT"
)
HS_PREVIEW_PORTS="47080 47090 47658"

is_hs_preview_port() {
  local p="$1"
  case " $HS_PREVIEW_PORTS " in
    *" $p "*) return 0 ;;
    *) return 1 ;;
  esac
}

# Stop a process listening on 127.0.0.1:port. Refuses hs-preview ports.
stop_loopback_port() {
  local port="$1"
  is_hs_preview_port "$port" && { log "refusing to stop hs-preview port $port"; return 0; }
  python3 - "$BIND" "$port" << 'PY' || true
import socket, subprocess, sys, os, time, signal
host, port = sys.argv[1], int(sys.argv[2])
if port in (47080, 47090, 47658):
    sys.exit(0)
pids = set()
try:
    out = subprocess.check_output(["lsof", "-nP", f"-iTCP@{host}:{port}", "-sTCP:LISTEN", "-t"], text=True)
    for line in out.split():
        if line.strip().isdigit():
            pids.add(int(line.strip()))
except Exception:
    pass
for pid in pids:
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
if pids:
    time.sleep(0.4)
    for pid in pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
PY
}

export_event_env() {
  export SEZS_SESSION_ROOT="$ROOT"
  export SEZS_SPLASH_DIR="${SEZS_SPLASH_DIR:-$ROOT/splash}"
  export SEZS_ADMIN_FROST_DIR="${SEZS_ADMIN_FROST_DIR:-$ROOT/admin-frost}"
  export SEZS_V2_KEYRING_HOME="${SEZS_V2_KEYRING_HOME:-${SEZS_LOCALTERP_HOME:-$ROOT/terp}}"
  export SEZS_V2_NODE="tcp://$BIND:$TERP_RPC_PORT"
  export SEZS_V2_CHAIN_ID="$TERP_CHAIN_ID"
  export SEZS_LCD="http://$BIND:$TERP_LCD_PORT"
  if [[ -f "$ROOT/terp-boot.json" ]]; then
    eval "$(python3 - "$ROOT/terp-boot.json" << 'PY'
import json, sys, shlex
d = json.load(open(sys.argv[1]))
def exp(name, val):
    if val:
        print(f"export {name}={shlex.quote(str(val))}")
exp("SEZS_V2_ROOT_CONTRACT", d.get("contract"))
exp("SEZS_EVENT_CONTRACT", d.get("contract"))
exp("SEZS_COORD_GROUP", d.get("coordinators"))
exp("SEZS_USHER_GROUP", d.get("ushers"))
exp("SEZS_GUEST_ROOT_VK", d.get("guestRootVk"))
PY
)"
    export SEZS_V2_ROOT_SIGNER="${SEZS_V2_ROOT_SIGNER:-frost}"
    export SEZS_V2_KEY_NAME="${SEZS_V2_KEY_NAME:-coord}"
  fi
  if [[ -f "$ROOT/ticket-dests.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    . "$ROOT/ticket-dests.env"
    set +a
  fi
}

instantiate_event() {
  local i
  for i in $(seq 1 60); do
    if tcp_up "$TERP_RPC_PORT"; then
      break
    fi
    sleep 1
  done
  if ! tcp_up "$TERP_RPC_PORT"; then
    log "terp RPC is down — skip event instantiate"
    return 1
  fi
  local admin="${SEZS_ADMIN_FROST_DIR:-$ROOT/admin-frost}"
  mkdir -p "$admin"
  chmod 700 "$admin"
  if [[ ! -f "$admin/meta.json" ]]; then
    log "running session admin FROST DKG (2-of-3); verifying key only will be printed"
    if ! node "$SEZS_APP/src/frost/admin-set.mjs" dkg --dir "$admin" >"$ROOT/logs/admin-frost-dkg.json" 2>"$ROOT/logs/admin-frost-dkg.log"; then
      log "admin FROST DKG failed (see logs/admin-frost-dkg.log)"
      return 1
    fi
    chmod 600 "$admin/set.json" "$admin/meta.json" "$ROOT/logs/admin-frost-dkg.json" 2>/dev/null || true
  fi
  local vk
  vk="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("verifyingKey",""))' "$admin/meta.json" 2>/dev/null || true)"
  if [[ ! "$vk" =~ ^[0-9a-fA-F]{64}$ ]]; then
    log "admin FROST verifying key missing — skip event instantiate"
    return 1
  fi
  log "instantiating a fresh event contract for this session"
  SEZS_LOCALTERP_HOME="${SEZS_LOCALTERP_HOME:-$ROOT/terp}" \
  SEZS_BOOT_OUT="$ROOT/terp-boot.json" \
  SEZS_GUEST_ROOT_VK="$vk" \
  SEZS_CHAIN_ID="$TERP_CHAIN_ID" \
  SEZS_V2_TERPD="$TERPD" \
    node "$SEZS_APP/dev/localterp/upgrade-v2.mjs" >"$ROOT/logs/upgrade-v2.out" 2>"$ROOT/logs/upgrade-v2.log" || {
      log "upgrade-v2 failed (see logs/upgrade-v2.log, no secrets printed here)"
      return 1
    }
  log "event contract instantiated (address in terp-boot.json)"
  export_event_env
}

do_up() {
  log "up, root=$ROOT"
  : >"$ROOT/run/pidlist"
  start_terp || true
  instantiate_event || true
  export_event_env
  start_zakura || true
  start_lightwalletd || true
  start_penumbra || true
  start_hermes || true
  start_backends
  write_session
  if wait_core && do_health; then
    log "session is up"
    log "status: $SESSION"
    return 0
  fi
  log "session started with some services down — see health"
  return 1
}

do_seed() {
  log "seed: fund session wallets on the local chains (addresses only in logs)"
  if tcp_up "$ZAKURA_RPC_PORT"; then
    python3 - "$BIND" "$ZAKURA_RPC_PORT" "$ROOT/logs/zakura-seed.txt" << 'PY' || true
import json, sys, urllib.request
host, port, outp = sys.argv[1], sys.argv[2], sys.argv[3]
url = f"http://{host}:{port}"
def rpc(method, params=None):
    body = json.dumps({"jsonrpc": "1.0", "id": "sezs", "method": method, "params": params or []}).encode()
    req = urllib.request.Request(url, data=body, headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except Exception as e:
        return {"error": str(e)}
info = rpc("getblockchaininfo")
result = (info or {}).get("result") or {}
lines = [
    f"zakura_ok={not bool(info.get('error'))}",
    f"chain={result.get('chain')}",
    f"blocks={result.get('blocks', result.get('headers'))}",
]
# Probe mining RPCs without printing secrets.
for method, params in (
    ("getblockcount", []),
    ("getblocksubsidy", []),
    ("generate", [1]),
    ("generatetoaddress", [1, "tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs"]),
    ("help", []),
):
    r = rpc(method, params)
    err = r.get("error")
    lines.append(f"{method}_error={err is not None}:{'obj' if isinstance(err, dict) else err}")
    if method == "help" and r.get("result"):
        text = str(r["result"])
        # method names only
        names = [ln.split()[0] for ln in text.splitlines() if ln and ln[0].isalpha()]
        lines.append("rpc_methods=" + ",".join(names[:80]))
open(outp, "w").write("\n".join(lines) + "\n")
print("zakura seed probe written")
PY
    if [[ -f "$ROOT/logs/zakura-seed.txt" ]]; then
      log "zakura seed probe: $(tr '
' ' ' < "$ROOT/logs/zakura-seed.txt" | cut -c1-240)"
    fi
  else
    log "zakura is down — no ZEC seed"
  fi
  if tcp_up "$PENUMBRA_GRPC_PORT" && [[ -x "${PCLI_BIN:-}" ]]; then
    log "penumbra is up; pcli homes stay under $ROOT/pcli (never print keys)"
    if [[ -s "$ROOT/penumbra/allocation.addr" ]]; then
      log "genesis allocation address is present"
    fi
  fi
  do_health
}

do_down() {
  log "down, root=$ROOT"
  if [[ -f "$ROOT/run/pidlist" ]]; then
    while read -r name pid owned; do
      [[ -z "${name:-}" ]] && continue
      if [[ "${owned:-0}" != "1" || "$pid" == "reuse" ]]; then
        log "leaving $name (not owned by this session) unless FORCE_DOWN"
        continue
      fi
      if kill -0 "$pid" 2>/dev/null; then
        log "stopping $name pid=$pid"
        kill "$pid" 2>/dev/null || true
      fi
    done <"$ROOT/run/pidlist"
    sleep 0.4
    while read -r name pid owned; do
      [[ -z "${name:-}" ]] && continue
      if [[ "${owned:-0}" == "1" && "$pid" != "reuse" ]] && kill -0 "$pid" 2>/dev/null; then
        log "killing $name pid=$pid"
        kill -9 "$pid" 2>/dev/null || true
      fi
    done <"$ROOT/run/pidlist"
  else
    log "no pid list; nothing owned to stop"
  fi
  if [[ "${SEZS_SESSION_FORCE_DOWN:-0}" == "1" ]]; then
    log "FORCE_DOWN: stopping SEZS loopback ports (hs-preview left alone)"
    local port
    for port in "${SESSION_PORTS[@]}"; do
      stop_loopback_port "$port"
    done
    sleep 0.3
  fi
  log "session processes stopped"
}

do_teardown_check() {
  local fails=0 port
  for port in "${SESSION_PORTS[@]}"; do
    if tcp_up "$port"; then
      log "PORT STILL UP :$port"
      fails=$((fails+1))
    fi
  done
  if [[ $fails -eq 0 ]]; then
    log "teardown ok: session ports are free"
    return 0
  fi
  log "teardown incomplete: $fails session port(s) still listening"
  return 1
}

case "$cmd" in
  up) do_up ;;
  health|status) do_health ;;
  seed) do_seed ;;
  instantiate) instantiate_event ;;
  down) do_down ;;
  teardown-check) do_teardown_check ;;
  *)
    echo "usage: $0 up|health|status|seed|instantiate|down|teardown-check" >&2
    exit 2
    ;;
esac
