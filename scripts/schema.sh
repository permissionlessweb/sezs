#!/usr/bin/env bash
# Generate CosmWasm schema JSON for SEZS contracts (terp-rs style: each
# contract with src/bin/schema.rs, then a merged JSON under the crate and
# a copy in api/schema/<contract>.json).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WS="$ROOT/contracts/cw-ave"
OUT="$ROOT/api/schema"
mkdir -p "$OUT"

packages=(cw-event-manifold cw420 cw-ave cw-ave-factory)
cd "$WS"
for pkg in "${packages[@]}"; do
  echo "schema $pkg"
  cargo schema --package "$pkg"
  # cargo schema writes ./schema/<pkg>.json (workspace cwd) or the crate dir.
  for cand in \
    "$WS/schema/${pkg}.json" \
    "$WS/contracts/${pkg}/schema/${pkg}.json" \
    "$WS/schema/${pkg//-/_}.json"
  do
    if [[ -f "$cand" ]]; then
      mkdir -p "$WS/contracts/${pkg}/schema"
      cp "$cand" "$WS/contracts/${pkg}/schema/${pkg}.json"
      cp "$cand" "$OUT/${pkg}.json"
      echo "  wrote api/schema/${pkg}.json"
      break
    fi
  done
  if [[ ! -f "$OUT/${pkg}.json" ]]; then
    # Some workspaces emit a directory of per-message schemas; keep it too.
    if [[ -d "$WS/schema" ]]; then
      echo "  warning: merged JSON for $pkg not found under schema/; listing:" >&2
      ls -la "$WS/schema" >&2 || true
    fi
  fi
done
echo "schema done"
