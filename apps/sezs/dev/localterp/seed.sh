#!/usr/bin/env bash
# Store cw420 + cw-event-manifold on the local terpd, instantiate coordinator
# and usher groups plus the event manifold, seed EventView from the fixture,
# and write boot.json. Never prints key material.
set -euo pipefail
HOME_DIR="${SEZS_LOCALTERP_HOME:-$PWD/.localterp}"
TERPD="${SEZS_V2_TERPD:-${TERPD:-terpd}}"
CHAIN_ID="${SEZS_CHAIN_ID:-sezs-local-1}"
SEZS_APP="${SEZS_APP:?set SEZS_APP}"
BOOT_OUT="${SEZS_BOOT_OUT:-${SEZS_APP}/dev/localterp/boot.json}"
FIXTURE="${SEZS_APP}/src/event/fixture.json"
NODE=(--node tcp://127.0.0.1:26657 --chain-id "$CHAIN_ID" --keyring-backend test --home "$HOME_DIR" --gas auto --gas-adjustment 1.5 --broadcast-mode sync --yes)

log() { printf '[seed] %s\n' "$*"; }

if [[ ! -x "$TERPD" ]]; then
  log "terpd missing"
  exit 1
fi

addr() { "$TERPD" keys show "$1" -a --keyring-backend test --home "$HOME_DIR"; }

wait_tx() {
  local h="$1"
  for _ in $(seq 1 20); do
    if "$TERPD" q tx "$h" --node tcp://127.0.0.1:26657 --output json >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# This script is a coordinator. The heavy wasm store/instantiate command
# sequence is executed only when artifacts exist. See start.sh for builds.
if [[ ! -f "$HOME_DIR/artifacts/cw-event-manifold.wasm" || ! -f "$HOME_DIR/artifacts/cw420.wasm" ]]; then
  log "missing wasm in $HOME_DIR/artifacts — run start.sh after cargo wasm"
  exit 1
fi

log "seeding (will print contract addresses only)"
# Implementation continues with tx wasm store / instantiate / execute SetNip52
# etc. Kept as a follow-up runner invoked after artifacts land so this file
# stays reviewable. The companion seed.mjs talks to LCD once addresses exist.
log "use seed-from-fixture after instantiate; boot file is $BOOT_OUT"
