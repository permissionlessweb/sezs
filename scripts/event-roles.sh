#!/usr/bin/env bash
# Apply coordinator and usher terp1 addresses to the existing local event
# via cw-orch (cw420 update_members). Does not instantiate a new suite.
# Requires SEZS_COORDINATOR and SEZS_USHER. Loopback only. Never prints keys.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NETWORK="${NETWORK:-${SEZS_NETWORK:-local}}"
SESSION="${SEZS_SESSION_ROOT:-/tmp/sezs-session-walkthrough}"
LAB="${SEZS_LOCALTERP_HOME:-$SESSION/terp}"
TERPD="${SEZS_V2_TERPD:-${TERPD:-terpd}}"
export NETWORK
export SEZS_NETWORK="$NETWORK"
export SEZS_SESSION_ROOT="$SESSION"
export SEZS_CHAIN_ID="${SEZS_CHAIN_ID:-sezs-local-1}"
export SEZS_LCD="${SEZS_LCD:-http://127.0.0.1:1317}"
export SEZS_RPC="${SEZS_RPC:-http://127.0.0.1:26657}"
export SEZS_GRPC="${SEZS_GRPC:-http://127.0.0.1:9090}"
export STATE_FILE="${STATE_FILE:-$SESSION/cw-orch-state.json}"

if [[ -z "${SEZS_COORDINATOR:-}" || -z "${SEZS_USHER:-}" ]]; then
  echo "usage: NETWORK=local SEZS_COORDINATOR=terp1… SEZS_USHER=terp1… make event-roles" >&2
  exit 2
fi

if [[ "$NETWORK" != "local" && "$NETWORK" != "sezs-local-1" && "${SEZS_DEPLOY_CONFIRM_MAINNET:-}" != "1" ]]; then
  echo "refusing NETWORK=$NETWORK (not loopback). Set SEZS_DEPLOY_CONFIRM_MAINNET=1 to override." >&2
  exit 1
fi

if [[ -z "${SEZS_DEPLOY_MNEMONIC:-}" && -z "${LOCAL_MNEMONIC:-}" && -z "${SEZS_DEPLOY_SECP256K1:-}" ]]; then
  if [[ ! -x "$TERPD" || ! -d "$LAB" ]]; then
    echo "sezs-orch-roles needs SEZS_DEPLOY_MNEMONIC, LOCAL_MNEMONIC, or the session keyring at $LAB" >&2
    exit 2
  fi
  SEZS_DEPLOY_SECP256K1="$("$TERPD" keys export curator --unarmored-hex --unsafe --yes --keyring-backend test --home "$LAB" 2>/dev/null)"
  export SEZS_DEPLOY_SECP256K1
  _unset_secp=1
fi

cleanup() {
  if [[ "${_unset_secp:-}" == "1" ]]; then
    unset SEZS_DEPLOY_SECP256K1
  fi
}
trap cleanup EXIT

# Fund the coordinator and usher from the session curator (same pattern
# as apps/sezs/dev/localterp/upgrade-v2.mjs). Loopback only.
NODE_TCP="${SEZS_RPC/http:\/\//tcp:\/\/}"
if [[ "$NODE_TCP" != tcp://127.0.0.1:* && "$NODE_TCP" != tcp://localhost:* ]]; then
  echo "refusing to fund on a non-loopback node $NODE_TCP" >&2
  exit 1
fi

fund_addr() {
  local name="$1"
  local addr="$2"
  local bal json hash
  bal="$("$TERPD" q bank balances "$addr" --node "$NODE_TCP" -o json 2>/dev/null || echo '{"balances":[]}')"
  json="$(python3 -c 'import json,sys; b=json.loads(sys.stdin.read() or "{\"balances\":[]}").get("balances") or []; print(next((x["amount"] for x in b if x.get("denom")=="uterp"), "0"))' <<<"$bal")"
  if [[ "${json:-0}" -ge 1000000000 ]]; then
    echo "sezs-orch-roles: $name already funded"
    return 0
  fi
  echo "sezs-orch-roles: funding $name"
  hash="$("$TERPD" tx bank send curator "$addr" 10000000000uterp \
    --from curator \
    --keyring-backend test \
    --home "$LAB" \
    --chain-id "$SEZS_CHAIN_ID" \
    --node "$NODE_TCP" \
    --gas auto --gas-adjustment 1.6 \
    -y -o json -b sync 2>/dev/null | python3 -c 'import json,sys,re; raw=sys.stdin.read();
try:
    print(json.loads(raw).get("txhash") or "")
except Exception:
    m=re.search(r"\"txhash\"\s*:\s*\"([0-9A-Fa-f]{64})\"", raw)
    print(m.group(1) if m else "")')"
  if [[ -z "$hash" ]]; then
    echo "sezs-orch-roles: fund $name did not return a txhash" >&2
    return 1
  fi
  echo "sezs-orch-roles: fund $name txhash $hash"
  for i in 1 2 3 4 5 6 7 8; do
    if "$TERPD" q tx "$hash" --node "$NODE_TCP" -o json >/dev/null 2>&1; then
      break
    fi
    sleep 0.4
  done
}


if [[ -x "${TERPD}" && -d "$LAB" ]]; then
  fund_addr coordinator "$SEZS_COORDINATOR"
  fund_addr usher "$SEZS_USHER"
else
  echo "sezs-orch-roles: skipping fund (no session keyring / terpd)" >&2
fi

cd "$ROOT"
cargo run --manifest-path "$ROOT/packages/Cargo.toml" --bin sezs-orch-roles --release
