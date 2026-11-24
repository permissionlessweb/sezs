#!/usr/bin/env bash
# Request a covering cw-orch-kms grant (ApprovalSession / grant_to).
# Loopback: set SEZS_KMS_LOCAL_GRANT=1 and a local granter signer.
# Remote: requires SEZS_DEPLOY_CONFIRM_MAINNET=1 and opens a Zigner page
# for account 0. Never prints key material. Does not default to a key named `do`.
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
export SEZS_KMS_SCOPE="${SEZS_KMS_SCOPE:-deploy}"

is_local=0
if [[ "$NETWORK" == "local" || "$NETWORK" == "sezs-local-1" || "$NETWORK" == "sezs_local_1" ]]; then
  is_local=1
fi

KEY_NAME="${SEZS_KEY_NAME:-}"
if [[ "$is_local" -eq 1 ]]; then
  LAB="${SEZS_LOCALTERP_HOME:-$SESSION/terp}"
  if [[ -z "$KEY_NAME" ]]; then
    KEY_NAME="operator"
  fi
  export SEZS_CHAIN_ID="${SEZS_CHAIN_ID:-sezs-local-1}"
  export SEZS_LCD="${SEZS_LCD:-http://127.0.0.1:1317}"
  export SEZS_RPC="${SEZS_RPC:-http://127.0.0.1:26657}"
  export SEZS_GRPC="${SEZS_GRPC:-http://127.0.0.1:9090}"
else
  if [[ "${SEZS_DEPLOY_CONFIRM_MAINNET:-}" != "1" ]]; then
    echo "refusing NETWORK=$NETWORK (not loopback). Set SEZS_DEPLOY_CONFIRM_MAINNET=1 to open a Zigner grant page." >&2
    exit 1
  fi
  LAB="${SEZS_KEYRING_HOME:-}"
  export CW_ORCH_GRANTER="${CW_ORCH_GRANTER:-terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052}"
  export SEZS_CHAIN_ID="${SEZS_CHAIN_ID:-morocco-1}"
  export SEZS_LCD="${SEZS_LCD:-https://api.terp.network}"
  export SEZS_RPC="${SEZS_RPC:-https://rpc.terp.network}"
  export SEZS_GRPC="${SEZS_GRPC:-https://grpc.terp.network:443}"
fi

if [[ -z "${SEZS_DEPLOY_MNEMONIC:-}" && -z "${LOCAL_MNEMONIC:-}" && -z "${SEZS_DEPLOY_SECP256K1:-}" ]]; then
  if [[ -n "$KEY_NAME" && -n "${LAB:-}" && -d "$LAB" ]] && command -v "$TERPD" >/dev/null 2>&1; then
    SEZS_DEPLOY_SECP256K1="$("$TERPD" keys export "$KEY_NAME" --unarmored-hex --unsafe --yes --keyring-backend test --home "$LAB" 2>/dev/null)"
    export SEZS_DEPLOY_SECP256K1
    _unset_secp=1
  else
    echo "sezs-orch-kms-approve needs the operator signer: SEZS_DEPLOY_MNEMONIC, LOCAL_MNEMONIC, or SEZS_DEPLOY_SECP256K1." >&2
    exit 2
  fi
fi

cleanup() {
  if [[ "${_unset_secp:-}" == "1" ]]; then
    unset SEZS_DEPLOY_SECP256K1
  fi
  if [[ "${_unset_granter_secp:-}" == "1" ]]; then
    unset SEZS_GRANTER_SECP256K1
  fi
}
trap cleanup EXIT

cd "$ROOT"
cargo run --manifest-path "$ROOT/packages/Cargo.toml" --bin sezs-orch-kms-approve --release
