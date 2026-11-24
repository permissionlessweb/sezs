#!/usr/bin/env bash
# Reproducible CosmWasm build via terp-optimizer (fork of cosmwasm/optimizer).
# Sources are always mounted at the canonical path /src so rustc-embedded
# paths (and therefore checksums) do not depend on the host checkout location.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SEZS_CONTRACTS_DIR:-$ROOT/contracts}"
OUT="${SEZS_ARTIFACTS_DIR:-$SRC/artifacts}"

# Image tags used by terp-rs. Override with TERP_OPTIMIZER_IMAGE.
# Digests are optional: set TERP_OPTIMIZER_DIGEST (sha256:...) when known
# so the pull is pinned. A running docker daemon is required to resolve a
# digest at runtime (`docker buildx imagetools inspect`).
AMD64_IMAGE="${TERP_OPTIMIZER_AMD64_IMAGE:-terpnetwork/optimizer:0.17.0-rust1.97}"
ARM64_IMAGE="${TERP_OPTIMIZER_ARM64_IMAGE:-terpnetwork/optimizer-arm64:0.17.0-rust1.97}"

arch="$(uname -m)"
case "$arch" in
  arm64|aarch64) image="$ARM64_IMAGE" ;;
  *) image="$AMD64_IMAGE" ;;
esac
if [[ -n "${TERP_OPTIMIZER_IMAGE:-}" ]]; then
  image="$TERP_OPTIMIZER_IMAGE"
fi
if [[ -n "${TERP_OPTIMIZER_DIGEST:-}" ]]; then
  # "name:tag@sha256:..." or "name@sha256:..."
  if [[ "$image" == *@sha256:* ]]; then
    :
  else
    image="${image%@*}@${TERP_OPTIMIZER_DIGEST}"
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "optimize: docker is required (terp-optimizer runs in a container)" >&2
  exit 1
fi
if [[ ! -f "$SRC/Cargo.toml" ]]; then
  echo "optimize: no Cargo.toml at $SRC" >&2
  exit 1
fi

# Canonical mount: /src. Never mount at a host home or workspace path.
canon=/src
echo "optimize: image=$image"
echo "optimize: mounting $SRC -> $canon"
mkdir -p "$OUT"

docker run --rm \
  -v "$SRC:$canon" \
  -e PROJECT_DIR="$canon" \
  -e CANONICAL_PROJECT_DIR="$canon" \
  -w "$canon" \
  --mount type=volume,source="${SEZS_OPTIMIZE_TARGET_VOLUME:-sezs_contracts_cache}",target=/target \
  --mount type=volume,source="${SEZS_OPTIMIZE_REGISTRY_VOLUME:-sezs_registry_cache}",target=/usr/local/cargo/registry \
  "$image"

# The optimizer writes artifacts/ inside the mounted project.
if [[ -d "$SRC/artifacts" ]]; then
  # checksums: sha256 of every wasm, reproducible sort
  (
    cd "$SRC/artifacts"
    if command -v sha256sum >/dev/null 2>&1; then
      shopt -s nullglob
      files=(*.wasm)
      if ((${#files[@]})); then
        sha256sum "${files[@]}" | sort -k2 > checksums.txt
        echo "optimize: wrote $SRC/artifacts/checksums.txt"
        cat checksums.txt
      fi
    elif command -v shasum >/dev/null 2>&1; then
      shopt -s nullglob
      files=(*.wasm)
      if ((${#files[@]})); then
        shasum -a 256 "${files[@]}" | sort -k2 > checksums.txt
        echo "optimize: wrote $SRC/artifacts/checksums.txt"
        cat checksums.txt
      fi
    fi
  )
fi
