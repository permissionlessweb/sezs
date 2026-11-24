#!/usr/bin/env bash
# Build the sezs_consume_v2 prover / ticket-key library (Rust → wasm) from
# <repo>/e2e/lab/sezs-ticket-v2 and stage it for the app:
#   public/zk/sezs-ticket-v2/   web build + prover worker (served to the browser)
#   .zk/sezs-ticket-v2/node/    nodejs build (splash backend tree builder, tests)
# Both outputs are gitignored and reproducible. Build on build-host.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SEZS_TICKET_V2_SRC:?set SEZS_TICKET_V2_SRC to circuits/sezs-ticket-v2}"
WASM_OPT="${WASM_OPT:-/opt/homebrew/bin/wasm-opt}"
cd "$SRC"
CARGO_TARGET_DIR="$SRC/target" cargo build -q -p sezs-ticket-v2-wasm --release --target wasm32-unknown-unknown
W="$SRC/target/wasm32-unknown-unknown/release/sezs_ticket_v2_wasm.wasm"
WEB="$APP/public/zk/sezs-ticket-v2"; NODE="$APP/.zk/sezs-ticket-v2/node"
rm -rf "$WEB" "$NODE"; mkdir -p "$WEB" "$NODE"
wasm-bindgen --target web --out-dir "$WEB" "$W"
wasm-bindgen --target nodejs --out-dir "$NODE" "$W"
for d in "$WEB" "$NODE"; do
  [ -x "$WASM_OPT" ] && "$WASM_OPT" -O3 "$d/sezs_ticket_v2_wasm_bg.wasm" -o "$d/sezs_ticket_v2_wasm_bg.wasm"
done
cp "$APP/src/ticket/v2/prover-worker.js" "$WEB/prover-worker.js"
( cd "$SRC" && git rev-parse --short HEAD 2>/dev/null || echo unknown ) > "$WEB/SOURCE_REV"
cp "$WEB/SOURCE_REV" "$NODE/SOURCE_REV"
ls -la "$WEB" "$NODE"
