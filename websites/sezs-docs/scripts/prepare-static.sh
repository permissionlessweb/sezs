#!/usr/bin/env bash
# Vocs full-static → out/ for loopback static serving.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/dist/public"
DEST="$ROOT/out"
if [[ ! -f "$SRC/index.html" ]]; then
  echo "prepare-static: missing $SRC/index.html — run vocs build" >&2
  exit 1
fi
rm -rf "$DEST"
mkdir -p "$DEST"
cp -a "$SRC"/. "$DEST"/
if [[ -f "$DEST/serve-node.js" || -d "$DEST/server" ]]; then
  echo "prepare-static: server files leaked into out/" >&2
  exit 1
fi
echo "prepare-static: $(find "$DEST" -name '*.html' | wc -l | tr -d ' ') html files"
