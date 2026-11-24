#!/usr/bin/env bash
# Fund a fresh SEZS session: ZEC FROST treasury, two-phase miner + maturity,
# pcli dest wallets, ticket-dests.env, restart splash, start Next.
# Loopback only. Never prints keys, seeds, or destination values.
set -euo pipefail

log() { printf '[sezs-fund] %s\n' "$*"; }

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${SEZS_SESSION_ROOT:-}"
if [[ -z "$ROOT" && -f /tmp/sezs-session/current/session.json ]]; then
  ROOT="$(python3 -c 'import json; print(json.load(open("/tmp/sezs-session/current/session.json")).get("root",""))' 2>/dev/null || true)"
fi
if [[ -z "$ROOT" || ! -d "$ROOT" ]]; then
  echo "SEZS_SESSION_ROOT is required and must exist" >&2
  exit 2
fi
export SEZS_SESSION_ROOT="$ROOT"
HOME_DIR="${HOME:-$HOME}"
SEZS_APP="${SEZS_APP:?set SEZS_APP to the apps/sezs directory}"
PCLI_BIN="${PCLI_BIN:-$HOME_DIR/.ict-rs/bins/pcli}"
BIND="127.0.0.1"
PENUMBRA_GRPC="${PENUMBRA_GRPC_URL:-http://$BIND:28080}"
NEXT_PORT="${SEZS_NEXT_PORT:-3051}"
SPLASH_PORT="${SEZS_SPLASH_PORT:-3052}"

if [[ -s "$HOME_DIR/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  . "$HOME_DIR/.nvm/nvm.sh"
  nvm use 24.18.0 >/dev/null 2>&1 || nvm use 24 >/dev/null 2>&1 || true
fi
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

tcp_up() {
  python3 - "$BIND" "$1" << 'PY'
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
s = socket.socket(); s.settimeout(0.4)
try:
    s.connect((host, port)); sys.exit(0)
except Exception:
    sys.exit(1)
finally:
    s.close()
PY
}

http_up() {
  curl -sf --max-time 2 "$1" >/dev/null 2>&1
}

stop_port() {
  local port="$1"
  case "$port" in 47080|47090|47658) log "refusing hs-preview port $port"; return 0 ;; esac
  python3 - "$BIND" "$port" << 'PY' || true
import os, signal, subprocess, sys, time
host, port = sys.argv[1], int(sys.argv[2])
if port in (47080, 47090, 47658):
    sys.exit(0)
pids=set()
try:
    out=subprocess.check_output(["lsof","-nP",f"-iTCP@{host}:{port}","-sTCP:LISTEN","-t"], text=True)
    for line in out.split():
        if line.strip().isdigit():
            pids.add(int(line.strip()))
except Exception:
    pass
for pid in pids:
    try: os.kill(pid, signal.SIGTERM)
    except ProcessLookupError: pass
if pids:
    time.sleep(0.4)
    for pid in pids:
        try: os.kill(pid, signal.SIGKILL)
        except ProcessLookupError: pass
PY
}

record_pid() {
  mkdir -p "$ROOT/run"
  printf '%s %s %s\n' "$1" "$2" "${3:-1}" >>"$ROOT/run/pidlist"
}

# --- FROST treasury + payout recipient (secrets stay in 0600 files) ---
log "ensuring ZEC FROST treasury under session root (secrets not logged)"
mkdir -p "$ROOT/zec-frost" "$ROOT/pcli" "$ROOT/logs"
chmod 700 "$ROOT/zec-frost" "$ROOT/pcli"
node "$HERE/sezs_zec_frost_payout.mjs" setup

# miner.addr is the treasury UA only (no other fields)
python3 - "$ROOT" << 'PY'
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
dealer = json.loads((root / "zec-frost" / "dealer.json").read_text())
ua = dealer.get("ua_uregtest") or dealer.get("ua")
if not ua or not str(ua).startswith("uregtest1"):
    raise SystemExit("treasury UA missing after setup")
p = root / "zec-frost" / "miner.addr"
p.write_text(ua + "\n")
p.chmod(0o600)
print("wrote miner.addr (not printed)")
PY

# --- two-phase ZEC funding ---
if ! tcp_up 18232; then
  log "zakura RPC is down — cannot fund ZEC"
  exit 1
fi
status="$(SEZS_SESSION_ROOT="$ROOT" SEZS_ZEC_CMD=status python3 "$HERE/sezs_zec_two_phase.py" 2>&1 || true)"
log "zakura status (pools only): $(echo "$status" | tr '\n' ' ' | cut -c1-240)"

need_mine=1
python3 - "$status" << 'PY' && need_mine=0 || need_mine=1
import re, sys
text = sys.argv[1]
m = re.search(r"height=(\d+)", text)
h = int(m.group(1)) if m else 0
iw = 0.0
mi = re.search(r"'ironwood': ([0-9.]+)", text) or re.search(r"ironwood=([0-9.]+)", text)
if mi:
    try: iw = float(mi.group(1))
    except Exception: iw = 0
if h >= 104 and iw > 0:
    sys.exit(0)
sys.exit(1)
PY

if [[ "$need_mine" == "1" ]]; then
  # Zakura state does not survive miner-address restarts on this host, so
  # mine Ironwood coinbases in one process: NU6.3 at height 1, FROST miner,
  # then 100 maturity blocks to the same treasury.
  log "one-shot Ironwood FROST funding (NU6.3 at 1, no mid-run restart)"
  SEZS_SESSION_ROOT="$ROOT" python3 "$HERE/sezs_zec_fund.py"
else
  log "ZEC already funded (height and ironwood pool present) — skip mining"
fi

# --- pcli addresses: seats from threshold deal, dest1 soft-kms for payroll UM ---
if [[ -x "$PCLI_BIN" ]] && tcp_up 28080; then
  log "writing pcli address files (addresses not logged)"
  for seat in seat0 seat1 seat2; do
    if [[ -d "$ROOT/pcli/$seat" && ! -s "$ROOT/pcli/$seat.addr" ]]; then
      "$PCLI_BIN" --home "$ROOT/pcli/$seat" view address >"$ROOT/pcli/$seat.addr" 2>>"$ROOT/pcli/addr.err" || true
      chmod 600 "$ROOT/pcli/$seat.addr" "$ROOT/pcli/addr.err" 2>/dev/null || true
    fi
  done
  if [[ ! -d "$ROOT/pcli/dest1" ]]; then
    mkdir -p "$ROOT/pcli/dest1"
    chmod 700 "$ROOT/pcli/dest1"
    log "initializing dest1 soft-kms home (secrets not logged)"
    "$PCLI_BIN" --home "$ROOT/pcli/dest1" init --grpc-url "$PENUMBRA_GRPC" soft-kms >/dev/null 2>"$ROOT/pcli/dest1.err" || true
    chmod 600 "$ROOT/pcli/dest1.err" 2>/dev/null || true
  fi
  if [[ ! -s "$ROOT/pcli/dest1.addr" ]]; then
    "$PCLI_BIN" --home "$ROOT/pcli/dest1" view address >"$ROOT/pcli/dest1.addr" 2>>"$ROOT/pcli/dest1.err" || true
    chmod 600 "$ROOT/pcli/dest1.addr" 2>/dev/null || true
  fi
  # Ticket UM dest must be a viewable pcli home (seat0). Do not use empty artist.addr.
  if [[ -s "$ROOT/pcli/seat0.addr" && ! -s "$ROOT/pcli/artist.addr" ]]; then
    cp "$ROOT/pcli/seat0.addr" "$ROOT/pcli/artist.addr"
    chmod 600 "$ROOT/pcli/artist.addr"
  fi
else
  log "pcli or penumbra grpc unavailable — dest files may be missing"
fi

# --- ticket-dests.env (0600, values never printed) ---
python3 - "$ROOT" << 'PY'
import json, os, sys
from pathlib import Path
root = Path(sys.argv[1])
def addr(p):
    try:
        t = Path(p).read_text().strip().splitlines()[0].strip()
        return t
    except Exception:
        return ""
dealer = {}
dj = root / "zec-frost" / "dealer.json"
if dj.exists():
    dealer = json.loads(dj.read_text())
zec = dealer.get("ua_uregtest") or dealer.get("ua") or ""
rec = {}
rj = root / "zec-frost" / "payout-recipient.json"
if rj.exists():
    rec = json.loads(rj.read_text())
pay_zec = rec.get("ua_uregtest") or rec.get("ua") or rec.get("ua_utest") or zec
um = addr(root / "pcli" / "seat0.addr") or addr(root / "pcli" / "artist.addr")
pay_um = addr(root / "pcli" / "dest1.addr") or um
if not zec or not um:
    raise SystemExit("ticket dests incomplete (zec or um missing)")
envp = root / "ticket-dests.env"
lines = [
    "SEZS_ALLOW_LOCAL_UM=1",
    "SEZS_TICKET_ZEC_DEST=%s" % zec,
    "SEZS_TICKET_UM_DEST=%s" % um,
    "SEZS_PAYROLL_ZEC_DEST=%s" % pay_zec,
    "SEZS_PAYROLL_UM_DEST=%s" % pay_um,
]
envp.write_text("\n".join(lines) + "\n")
os.chmod(envp, 0o600)
print("wrote ticket-dests.env (values not printed) zec_ok=%s um_ok=%s pay_zec_ok=%s pay_um_ok=%s" % (
    bool(zec), bool(um), bool(pay_zec), bool(pay_um)))
PY

# Source dests + event env without printing.
set -a
# shellcheck disable=SC1091
. "$ROOT/ticket-dests.env"
set +a
export SEZS_V2_KEYRING_HOME="${SEZS_V2_KEYRING_HOME:-${SEZS_LOCALTERP_HOME:-$ROOT/terp}}"
export SEZS_LOCALTERP_HOME="${SEZS_LOCALTERP_HOME:-$ROOT/terp}"
export SEZS_V2_ROOT_SIGNER="${SEZS_V2_ROOT_SIGNER:-frost}"
export SEZS_V2_KEY_NAME="${SEZS_V2_KEY_NAME:-coord}"
export SEZS_V2_BOOT="${SEZS_V2_BOOT:-$ROOT/terp-boot.json}"
export SEZS_V2_NODE="${SEZS_V2_NODE:-tcp://$BIND:26657}"
export SEZS_LCD="${SEZS_LCD:-http://$BIND:1317}"
export SEZS_SPLASH_DIR="${SEZS_SPLASH_DIR:-$ROOT/splash}"
export SEZS_ADMIN_FROST_DIR="${SEZS_ADMIN_FROST_DIR:-$ROOT/admin-frost}"
export SEZS_SPLASH=1
export NEXT_PUBLIC_SEZS_SPLASH=1
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
exp("SEZS_V2_CHAIN_ID", d.get("chainId") or "sezs-local-1")
PY
)"
fi

# Bind splash lab identities to the session coord/usher keyring addresses.
python3 "$HERE/sezs_bind_live_roles.py" || log "live role bind skipped"

# --- restart splash so dests and frost signer are in its environment ---
log "restarting splash with session dests and FROST root signer"
stop_port "$SPLASH_PORT"
sleep 0.4
nohup env \
  SEZS_SESSION_ROOT="$ROOT" \
  SEZS_SPLASH_DIR="${SEZS_SPLASH_DIR:-$ROOT/splash}" \
  SEZS_ADMIN_FROST_DIR="${SEZS_ADMIN_FROST_DIR:-$ROOT/admin-frost}" \
  SEZS_V2_ROOT_SIGNER=frost \
  SEZS_V2_KEY_NAME=coord \
  SEZS_V2_KEYRING_HOME="${SEZS_V2_KEYRING_HOME:-$ROOT/terp}" \
  SEZS_V2_BOOT="${SEZS_V2_BOOT:-$ROOT/terp-boot.json}" \
  SEZS_V2_NODE="${SEZS_V2_NODE:-tcp://$BIND:26657}" \
  SEZS_V2_CHAIN_ID="${SEZS_V2_CHAIN_ID:-sezs-local-1}" \
  SEZS_LCD="${SEZS_LCD:-http://$BIND:1317}" \
  SEZS_V2_ROOT_CONTRACT="${SEZS_V2_ROOT_CONTRACT:-}" \
  SEZS_EVENT_CONTRACT="${SEZS_EVENT_CONTRACT:-}" \
  SEZS_COORD_GROUP="${SEZS_COORD_GROUP:-}" \
  SEZS_USHER_GROUP="${SEZS_USHER_GROUP:-}" \
  SEZS_GUEST_ROOT_VK="${SEZS_GUEST_ROOT_VK:-}" \
  SEZS_TICKET_ZEC_DEST="${SEZS_TICKET_ZEC_DEST:-}" \
  SEZS_TICKET_UM_DEST="${SEZS_TICKET_UM_DEST:-}" \
  SEZS_PAYROLL_ZEC_DEST="${SEZS_PAYROLL_ZEC_DEST:-}" \
  SEZS_PAYROLL_UM_DEST="${SEZS_PAYROLL_UM_DEST:-}" \
  SEZS_ALLOW_LOCAL_UM=1 \
  SEZS_SPLASH=1 \
  SEZS_SPLASH_PORT="$SPLASH_PORT" \
  SEZS_SPLASH_APP="http://$BIND:$NEXT_PORT" \
  NODE_ENV="${NODE_ENV:-development}" \
  node "$SEZS_APP/dev/splash/server.mjs" >"$ROOT/logs/splash.log" 2>&1 &
record_pid splash "$!" 1
for i in $(seq 1 40); do
  if http_up "http://$BIND:$SPLASH_PORT/sezs/session/me"; then
    log "splash is listening"
    break
  fi
  sleep 0.25
done

# --- Next on :3051 with the same session env ---
if ! http_up "http://$BIND:$NEXT_PORT"; then
  log "starting Next on $BIND:$NEXT_PORT"
  (
    cd "$SEZS_APP"
    nohup env \
      SEZS_SESSION_ROOT="$ROOT" \
      SEZS_SPLASH=1 \
      NEXT_PUBLIC_SEZS_SPLASH=1 \
      SEZS_V2_ROOT_SIGNER=frost \
      SEZS_V2_KEY_NAME=coord \
      SEZS_V2_KEYRING_HOME="${SEZS_V2_KEYRING_HOME:-$ROOT/terp}" \
      SEZS_V2_BOOT="${SEZS_V2_BOOT:-$ROOT/terp-boot.json}" \
      SEZS_V2_NODE="${SEZS_V2_NODE:-tcp://$BIND:26657}" \
      SEZS_V2_CHAIN_ID="${SEZS_V2_CHAIN_ID:-sezs-local-1}" \
      SEZS_LCD="${SEZS_LCD:-http://$BIND:1317}" \
      SEZS_V2_ROOT_CONTRACT="${SEZS_V2_ROOT_CONTRACT:-}" \
      SEZS_ALLOW_LOCAL_UM=1 \
      SEZS_SPLASH_PORT="$SPLASH_PORT" \
      PORT="$NEXT_PORT" \
      HOSTNAME="$BIND" \
      pnpm exec next dev --hostname "$BIND" --port "$NEXT_PORT" \
      >"$ROOT/logs/next.log" 2>&1 &
    echo $! >"$ROOT/run/next.pid"
  )
  record_pid next "$(cat "$ROOT/run/next.pid")" 1
  for i in $(seq 1 80); do
    if http_up "http://$BIND:$NEXT_PORT"; then
      log "Next is listening"
      break
    fi
    sleep 0.5
  done
else
  log "reusing Next on :$NEXT_PORT"
fi

log "fund complete"
SEZS_SESSION_ROOT="$ROOT" SEZS_ZEC_CMD=status python3 "$HERE/sezs_zec_two_phase.py" || true
