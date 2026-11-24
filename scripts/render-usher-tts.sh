#!/usr/bin/env bash
# Draft offline TTS for usher check-in using macOS say. No network, no signup.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:${PATH}"
exec python3 "${ROOT}/scripts/render-guide-tts.py" usher-check-in "$@"
