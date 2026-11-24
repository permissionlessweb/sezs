# Building SEZS

This repository is meant to build from a clean clone. You do not need a
local crates checkout (optional; see `just deps-patch-local`).

## Tooling

| Tool | Pin |
| --- | --- |
| Node.js | `.nvmrc` (`24.18.0`) |
| pnpm | `package.json` `packageManager` field (Corepack) |
| Rust | `rust-toolchain.toml` (`1.97.1`, plus `wasm32-unknown-unknown`) |
| Contract optimizer | terp-optimizer Docker image, see below |

```bash
just install          # Corepack + pnpm install --frozen-lockfile
just typecheck
just build            # Next.js production export
just test             # app unit tests
just check-crates     # cargo check for orch crates
just test-crates
just build-contracts  # cargo test/check of the contracts workspace
just optimize         # terp-optimizer (Docker) + checksums
```

`just install` uses `--frozen-lockfile`. To refresh the lockfile after a
dependency change, run `just install-update`.

## Rust dependencies

Host crates (`crates/`) and the ticket circuit (`circuits/sezs-ticket-v2`)
use crates.io versions plus a generated `[patch.crates-io]` table of
published git revisions of our forks (cw-orchestrator, cosmwasm,
cosmos-rust, zakura common). The table is produced by:

```bash
just deps-validate
just deps-branch-check
just deps-patch-git          # committed default
```

Developers who have a local crates checkout can point `SEZS_CRATES_ROOT` at
it and run `just deps-patch-local`. That rewrite is for local use only; do
not commit it. CI expects `patch-git`.

`cw-orch-kms` is not on crates.io; `crates/sezs-orch` depends on it by git
revision (the same SHA as the other cw-orch crates).

## Contract artifacts

`just optimize` builds in-repo contracts (`contracts/cw-event-manifold`)
with [terp-optimizer](https://github.com/permissionlessweb/terp-optimizer).
The project is mounted at the canonical path `/src` so checksums do not
depend on where you cloned the repo.

Images (override with `TERP_OPTIMIZER_IMAGE`):

| Arch | Image |
| --- | --- |
| linux/amd64 | `terpnetwork/optimizer:0.17.0-rust1.97` |
| linux/arm64 | `terpnetwork/optimizer-arm64:0.17.0-rust1.97` |

Set `TERP_OPTIMIZER_DIGEST=sha256:…` to pin the image by digest when you
have resolved it (`docker buildx imagetools inspect`).

Checksums are written to `contracts/artifacts/checksums.txt`.

### External contracts (not vendored)

These are referenced, never copied into this repo. Point the orchestrator
at prebuilt wasm with environment variables (or a documented sibling
checkout). No absolute machine paths are hardcoded.

| Contracts | Repository | Pin | Lookup |
| --- | --- | --- | --- |
| `cw-ave`, `cw-ave-factory`, `cw420` | [permissionlessweb/cw-ave](https://github.com/permissionlessweb/cw-ave) | `218aab19dba78bc9a1ba05097d16c1a7253bc983` (main, Apache-2.0) | `CW_AVE_ROOT` or `SEZS_CW_AVE_ARTIFACTS` |
| `dao-dao-core`, `dao-voting-cw4`, `dao-proposal-single`, `cw4-group` | [permissionlessweb/dao-contracts](https://github.com/permissionlessweb/dao-contracts) (DAO DAO fork) | official / fork artifacts | `DAO_CONTRACTS_ROOT` or `SEZS_DAO_ARTIFACTS` |
| `dao-calendar` | same repo, `feat/calander` @ `af4651407425bfa2b32cb51b03e559f631257e5b` | stays in that repo | same as DAO artifacts |
| `terp-beacon`, `nftfi-raffle` | [permissionlessweb/terp-rs](https://github.com/permissionlessweb/terp-rs) | built with terp-optimizer in that repo | `TERP_RS_ROOT` or `SEZS_TERP_RS_ARTIFACTS` |

In-repo wasm is also found at `contracts/artifacts/<stem>.wasm`.

## Local development (optional)

`just env-up`, `just env-down`, `just deploy-local`, and the studio /
walkthrough recipes are conveniences for a loopback chain. They are not
required to typecheck, build, or unit-test the app, and they must not
assume a sibling monorepo layout.

## Optional Zafu wasm

Frost relay cipher tests load a Zafu wasm package. On a clean clone they
are skipped unless you set `SEZS_ZAFU_WASM` to a built package directory.

## Circuit artifacts

The optional `just circuits` recipe builds the ticket-circuit params and
verification-key blob under `circuits/sezs-ticket-v2/artifacts/`. Those
files are gitignored because they are derived; rebuild with
`SEZS_REBUILD_CIRCUITS=1`. Crate tests that inspect the production blob
skip when the files are absent, so a clean clone does not require a prior
keygen. They are not copied from a developer workspace.

## hash-market (sezs-server)

`crates/sezs-server` depends on `hash-market` from the terp-rs git repo at
the SHA in `tools/deps/_devops/dependency-matrix.toml`. That SHA lives on
the local `sezs/service-trait` branch until it is pushed. Until then,
`just deps-patch-git` cannot resolve it.

For a local build, point `SEZS_CRATES_ROOT` at a directory that contains a
`terp-rs` checkout of that branch and run `SEZS_DEPS_GIT_ONLY=1 just deps-patch-local`
(so only the git-only path patch is written; crates.io pins stay on patch-git). Do not
commit the resulting `[patch."https://github.com/permissionlessweb/terp-rs"]`
block. Switch back with `just deps-patch-git` before committing
`crates/Cargo.toml`.
