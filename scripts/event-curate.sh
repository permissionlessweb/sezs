#!/usr/bin/env bash
# Update metadata and curation data on an existing event via cw-orch.
# Local defaults to loopback sezs-local-1; remote chains require
# SEZS_DEPLOY_CONFIRM_MAINNET=1. Never prints key material.
#
# Mainnet curate is signed by the cw-orch-kms operator (grantee) as
# CW_ORCH_GRANTER. This script never defaults to or exports a key named `do`.
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
  export SEZS_METADATA_PATH="${SEZS_METADATA_PATH:-$ROOT/apps/sezs/public/lantern-night-nip52.json}"
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
  export STATE_FILE="${STATE_FILE:-$SESSION/cw-orch-state-morocco-1.json}"
fi

export SEZS_EVENT_CONTRACT="${SEZS_EVENT_CONTRACT:-}"

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
    echo "sezs-orch-curate needs the operator signer: SEZS_DEPLOY_MNEMONIC, LOCAL_MNEMONIC, or SEZS_DEPLOY_SECP256K1." >&2
    if [[ "$is_local" -eq 0 ]]; then
      echo "Cold granter ${CW_ORCH_GRANTER:-terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052} stays on Zigner account 0." >&2
      echo "If no covering ContractExecutionAuthorization + feegrant is Ready, curate will refuse." >&2
      echo "Request a grant: SEZS_KMS_SCOPE=curate SEZS_EVENT_CONTRACT=<event> ./scripts/kms-approve.sh" >&2
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

cd "$ROOT"
cargo run --manifest-path "$ROOT/packages/Cargo.toml" --bin sezs-orch-curate --release
