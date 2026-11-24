#!/usr/bin/env bash
# Deploy through sezs-orch-deploy / the terp-core cw-orch fork.
# Local defaults to loopback sezs-local-1; remote chains (morocco-1) require
# SEZS_DEPLOY_CONFIRM_MAINNET=1. Never prints key material.
#
# Mainnet signs as the cw-orch-kms operator (grantee). The cold curator
# CW_ORCH_GRANTER (Zigner account 0) authorizes MsgExec; this script never
# exports a key named `do` and will not read a cold key from the keyring.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NETWORK="${NETWORK:-${SEZS_NETWORK:-local}}"
SESSION="${SEZS_SESSION_ROOT:-/tmp/sezs-session-walkthrough}"
TERPD="${SEZS_V2_TERPD:-${TERPD:-terpd}}"
if ! command -v "$TERPD" >/dev/null 2>&1 && [[ ! -x "$TERPD" ]]; then
  TERPD="$(command -v terpd || echo "$TERPD")"
fi

export NETWORK
export SEZS_NETWORK="$NETWORK"
export SEZS_SESSION_ROOT="$SESSION"

is_local=0
if [[ "$NETWORK" == "local" || "$NETWORK" == "sezs-local-1" || "$NETWORK" == "sezs_local_1" ]]; then
  is_local=1
fi

KEY_NAME="${SEZS_KEY_NAME:-}"
if [[ "$is_local" -eq 1 ]]; then
  LAB="${SEZS_LOCALTERP_HOME:-$SESSION/terp}"
  if [[ -z "$KEY_NAME" ]]; then
    KEY_NAME="curator"
  fi
  export SEZS_CHAIN_ID="${SEZS_CHAIN_ID:-sezs-local-1}"
  export SEZS_LCD="${SEZS_LCD:-http://127.0.0.1:1317}"
  export SEZS_RPC="${SEZS_RPC:-http://127.0.0.1:26657}"
  export SEZS_GRPC="${SEZS_GRPC:-http://127.0.0.1:9090}"
  export STATE_FILE="${STATE_FILE:-$SESSION/cw-orch-state.json}"
else
  if [[ "${SEZS_DEPLOY_CONFIRM_MAINNET:-}" != "1" ]]; then
    echo "refusing NETWORK=$NETWORK (not loopback). Set SEZS_DEPLOY_CONFIRM_MAINNET=1 to override." >&2
    exit 1
  fi
  LAB="${SEZS_KEYRING_HOME:-}"
  export CW_ORCH_GRANTER="${CW_ORCH_GRANTER:-terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052}"
  export SEZS_CHAIN_ID="${SEZS_CHAIN_ID:-morocco-1}"
  export SEZS_LCD="${SEZS_LCD:-https://api.terp.network}"
  export SEZS_RPC="${SEZS_RPC:-https://rpc.terp.network}"
  export SEZS_GRPC="${SEZS_GRPC:-https://grpc.terp.network:443}"
  export SEZS_CURATOR="${SEZS_CURATOR:-terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052}"
  export SEZS_SKIP_CIRCUIT_UPLOAD="${SEZS_SKIP_CIRCUIT_UPLOAD:-1}"
  export SEZS_MINIMAL_STACK="${SEZS_MINIMAL_STACK:-1}"
  export STATE_FILE="${STATE_FILE:-$SESSION/cw-orch-state-morocco-1.json}"
  if [[ ! -f "$STATE_FILE" && -f "$ROOT/deploy/mainnet/cw-orch-state.seed.json" ]]; then
    mkdir -p "$(dirname "$STATE_FILE")"
    cp "$ROOT/deploy/mainnet/cw-orch-state.seed.json" "$STATE_FILE"
  fi
fi

# Public FROST group verifying key for UpdateGuestRoot; never printed.
if [[ "$is_local" -eq 1 && -z "${SEZS_GUEST_ROOT_VK:-}" && -f "$SESSION/admin-frost/meta.json" ]]; then
  SEZS_GUEST_ROOT_VK=$(python3 -c 'import json,sys; v=str(json.load(open(sys.argv[1])).get("verifyingKey","")).strip().lower().removeprefix("0x"); print(v if len(v)==64 else "", end="")' "$SESSION/admin-frost/meta.json")
  export SEZS_GUEST_ROOT_VK
fi

export SEZS_DEPLOYMENT_ID="${SEZS_DEPLOYMENT_ID:-sezs-$(date +%Y%m%d%H%M%S)}"

addr() {
  "$TERPD" keys show "$1" -a --keyring-backend test --home "$LAB"
}

if [[ "$is_local" -eq 1 && -x "$TERPD" && -d "$LAB" ]]; then
  export SEZS_CURATOR="${SEZS_CURATOR:-$(addr curator)}"
  export SEZS_SERVICE="${SEZS_SERVICE:-$(addr service)}"
  export SEZS_USHER="${SEZS_USHER:-$(addr usher)}"
  export SEZS_COORD="${SEZS_COORD:-$(addr coord)}"
fi

# Sign with an already-derived secp256k1 secret from the test keyring when
# no mnemonic/key is already in the environment. Never print it.
# On mainnet this is the operator/grantee only, and only if SEZS_KEY_NAME is
# set explicitly (never a default key named `do`).
if [[ -z "${SEZS_DEPLOY_MNEMONIC:-}" && -z "${LOCAL_MNEMONIC:-}" && -z "${SEZS_DEPLOY_SECP256K1:-}" ]]; then
  if [[ "$is_local" -eq 1 && -n "$KEY_NAME" && -d "${LAB:-}" ]] && command -v "$TERPD" >/dev/null 2>&1; then
    SEZS_DEPLOY_SECP256K1="$("$TERPD" keys export "$KEY_NAME" --unarmored-hex --unsafe --yes --keyring-backend test --home "$LAB" 2>/dev/null)"
    export SEZS_DEPLOY_SECP256K1
    _unset_secp=1
  elif [[ "$is_local" -eq 0 && -n "$KEY_NAME" && -n "${LAB:-}" && -d "$LAB" ]] && command -v "$TERPD" >/dev/null 2>&1; then
    SEZS_DEPLOY_SECP256K1="$("$TERPD" keys export "$KEY_NAME" --unarmored-hex --unsafe --yes --keyring-backend test --home "$LAB" 2>/dev/null)"
    export SEZS_DEPLOY_SECP256K1
    _unset_secp=1
  else
    echo "sezs-orch-deploy needs the operator signer: SEZS_DEPLOY_MNEMONIC, LOCAL_MNEMONIC, or SEZS_DEPLOY_SECP256K1." >&2
    if [[ "$is_local" -eq 0 ]]; then
      echo "Cold granter ${CW_ORCH_GRANTER:-terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052} stays on Zigner account 0." >&2
      echo "If no covering authz+feegrant is Ready, sezs-orch-deploy will refuse (no mid-deploy QR)." >&2
      echo "Request a grant with scripts/kms-approve.sh / sezs-orch-kms-approve, then rerun." >&2
    else
      echo "For the local session keyring on loopback, set SEZS_LOCALTERP_HOME or a signer env var." >&2
    fi
    exit 2
  fi
fi

cleanup() {
  if [[ "${_unset_secp:-}" == "1" ]]; then
    unset SEZS_DEPLOY_SECP256K1
  fi
}
trap cleanup EXIT

mkdir -p "$SESSION"
cd "$ROOT"
cargo run --manifest-path "$ROOT/packages/Cargo.toml" --bin sezs-orch-deploy --release
