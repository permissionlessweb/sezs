# SEZS monorepo restructure plan

**Status:** Phase 1 audit only. No tree restructure, no push, and no changes to terp-rs or other repositories have been made. This file is uncommitted on purpose.

**Date:** 24 Nov 2026 (Africa/Dakar, UTC+0)

**Scope:** the public `permissionlessweb/sezs` tree (current `main`: `f0e2daa712e3386511a9eb81116eccd79bc0a9aa`) and the forks / contract sources it depends on.

**Constraint for later public commits:** never write host names, home-directory paths, or machine-login aliases into this repository.

---

## 1. Forks and current dependency resolution

The export does **not** use git-remote-accessible sources for its CosmWasm or orchestrator forks. `packages/Cargo.toml` has a 59-entry `[patch.crates-io]` table of **sibling path** crates (`../../terp-core/crates/...`). `packages/sezs-orch/Cargo.toml` also has direct path dependencies on `cosmrs` and `cw-orch-kms` in that same sibling tree. A clean clone of `permissionlessweb/sezs` cannot build the Rust workspace.

### 1.1 cw-orch (circuit_interface / cw-orch-kms)

| | |
|---|---|
| Public fork | `https://github.com/permissionlessweb/cw-orchestrator` |
| Upstream | `https://github.com/AbstractSDK/cw-orchestrator` |
| GitHub default branch | `main` @ `ff94f0474bda8a420cfd61c67199b2eacc768f9f` (“correct ibc-proto crate”) — **not** the line SEZS uses |
| terp-rs matrix pin (`[crates.cw-orch.git]`, and the other `cw-orch-*` crates except polytone) | branch `penumbra-custody`, rev `ef40605512eaf5f99522bf5d956c5d3aad0b38f1` (published on the fork) |
| Local checkout actually used to compile SEZS | branch `sezs/msg-store-full-circuit`, rev `4d229628a8333b2d7011a0e670238d5e8494bff4` — **7 commits ahead of the matrix pin, not present on any remote-tracking branch** |

`circuit_interface` is not a separate crate. It is the `zk` feature on this fork:

- `cw_orch_circuit_derive::circuit_interface` re-exported from `cw-orch`
- `cw-orch-core` `circuits` module (`Circuit`, `CircuitInstance`, `CwOrchCircuitUpload`, …)
- `cw-orch` feature `zk = ["cosmwasm-std/zk", "cw-orch-core/zk", "cw-orch-daemon/zk"]` (already present on `penumbra-custody`)

`cw-orch-kms` lives at `packages/cw-orch-kms` in the same repository. SEZS depends on it by path, not via `[patch]`.

The tip commit (`fix(zk): upload circuits with MsgStoreFullCircuit and parse zk_id`) is the one SEZS circuit upload needs. `MsgStoreFullCircuit` appears in `cw-orch-daemon` only on the unpublished tip; the published pin has the name in `cw-orch-kms` capabilities only.

**Blocker:** those 7 commits (and the matching `cosmrs` change below) must be published and leak-scanned before this repo can pin a public git rev that actually builds SEZS.

### 1.2 cosmwasm

| | |
|---|---|
| Public fork | `https://github.com/permissionlessweb/cosmwasm` |
| Upstream | `https://github.com/CosmWasm/cosmwasm` |
| GitHub default branch | `main` @ `b3c3dc42413d1c92025b0035aca31e33c30286a5` — **not** the line SEZS uses |
| terp-rs matrix pin (all `cosmwasm-*` and `zk-cosmwasm`) | branch `security/advisory-bumps`, rev `ffe57a757cab77211e0c3a85a9c00109a52b1965` |
| Current tip of that published branch (and the local checkout) | `adace180be362e03c5aabed4b705c37c7f633d94` (“changelog: label release 4.1.0 (headstash v0.0.1 build pin)”, 3 Nov 2026 20:06 UTC / 20:06 Africa/Dakar) |

Fork version in the matrix is `4.1.0`, which matches `cosmwasm-std = { version = "=4.1.0", ... }` in `sezs-orch`. Related org repo `permissionlessweb/core-cosmwasm` exists; this tree uses `permissionlessweb/cosmwasm`, not that one.

### 1.3 cosmrs (required third fork; not in the original feedback list)

Circuit upload also needs `MsgStoreFullCircuit` in cosmrs:

| | |
|---|---|
| Public fork | `https://github.com/permissionlessweb/cosmos-rust` |
| Upstream | `https://github.com/cosmos/cosmos-rust` |
| terp-rs matrix pin (`[crates.cosmrs.git]`) | rev `877ee79b693760f7ffa97ef542f5788c26f537dd` (no branch field in the matrix entry) |
| Local checkout used with SEZS | branch `sezs/msg-store-full-circuit`, rev `cd05b370ddff27fba82fa071c76d270c1ca7181c` (“feat(cosmwasm): add MsgStoreFullCircuit matching current wasmd”) — **2 commits ahead of the matrix pin, not on `origin`** |

### 1.4 What the export resolves today

Declared in `packages/sezs-orch` / `packages/sezs-circuit-orch`:

| Crate | Declared | Resolves today |
|---|---|---|
| `cw-orch` | `version = "0.30.0"`, features `daemon` + `zk` (orch) or `zk` only (circuit-orch) | `[patch.crates-io]` → sibling `cw-orchestrator/cw-orch` |
| `cw-orch-core`, `cw-orch-daemon`, `cw-orch-traits` | transitive | patched to sibling paths |
| `cw-orch-kms` | **direct path** to sibling `cw-orchestrator/packages/cw-orch-kms` | not git-remote accessible |
| `cosmwasm-std` | `=4.1.0`, feature `std` | patched to sibling `cosmwasm/packages/std` |
| `cosmwasm-core`, `cosmwasm-crypto`, `cosmwasm-derive`, `cosmwasm-schema`, `cosmwasm-schema-derive`, `cosmwasm-vm`, `cw-schema`, `cw-schema-derive`, `zk-cosmwasm` | patch table only | sibling `cosmwasm/packages/*` |
| `cosmrs` | **direct path** to sibling `cosmos-rust/cosmrs` | not git-remote accessible |

The other ~45 path patches (Hermes/IBC, Neutron, Osmosis, cw-plus, zakura, tendermint-rs, etc.) were copied as a blanket terp-core mirror. Most are not SEZS product crates. After switching to `patch-git`, the table should contain only crates the workspace actually selects; unused entries should be dropped.

Artifact lookup has the same sibling-tree problem: `packages/sezs-orch/src/wasm.rs` finds DAO wasm under `../terp-core/crates/dao-contracts/artifacts` and terp-rs wasm under `../terp-core/crates/terp-rs/artifacts`. `cw-ave` already has env / sibling-repo fallbacks (`SEZS_CW_AVE_ARTIFACTS`, `CW_AVE_ROOT`, `../cw-ave/artifacts`); beacon, raffle, and DAO artifacts need the same treatment.

---

## 2. The terp-rs patch technique (and how to reuse it)

**terp-rs remote:** `https://github.com/permissionlessweb/terp-rs.git` (checked out as a crate under the terp-core monorepo, not as a standalone default-branch pin).

### How it works

The stable control plane is Python, not the experimental Rust `gen-tools deps` binary:

- `tools/gen-tools/_scripts/dep.py` — CLI
- `tools/gen-tools/_scripts/dep-switch.py` — switch implementation
- `tools/gen-tools/_scripts/dep_common.py` — shared policy / matrix I/O
- `tools/gen-tools/_devops/dep-config.toml` — monorepo root, matrix path, policy
- `tools/gen-tools/_devops/dependency-matrix.toml` — one entry per crate: crates.io version, `local` / `zk_local` relative paths, `git.url` + `git.branch` + `git.rev` (full 40-char SHA)
- mode state file `.dep-mode`

Recipes live in `tools/gen-tools/justfile` (`deps-config`, `deps-validate`, `deps-branch-check`, `deps-switch`, `deps-patch-local`, `deps-patch-git`, stamp / heal / status / HTML report, plus tests including `test_dep_patch_mode.py`).

**Modes:** `stable | local | git | zk_local | zk_git | dev | zk_dev | patch-local | patch-git`.

The important ones for a public consumer repo:

- **Version lines in member `Cargo.toml` files stay on crates.io versions.** Example: `cw-orch = { version = "0.30.0", features = ["daemon", "zk"] }`.
- One `[patch.crates-io]` table is rewritten in a single shot. A crates.io→git patch is the source Cargo keeps, so a second `[patch."https://…"]` on that git URL does **not** select a local tree. Local vs git are alternatives, not layers.
- `patch-git`: each patch entry becomes `{ git = "<url>", rev = "<40-char SHA>" }` (and a subdirectory when the crate is not at the repo root). Branches and short SHAs are refused. If a rev cannot be fetched, that crate is left as-is (fail-soft per crate, fail-closed for a dirty matrix).
- `patch-local`: the same table is rewritten back to relative local paths from the matrix. Policy **forbids absolute paths**.
- Composite `dev` = workspace git deps + local patches; SEZS does not need the full zk/dev matrix.

Supporting automation: `deps-branch-check` (`git ls-remote`, exit 1 if a matrix branch is unpublished), `deps-validate` (package-name / path integrity), `deps-stamp-revs` (record local HEADs into `git.rev`, dry-run unless `--write`), `deps-git-status` (dirty / outgoing / detached preflight), `forbid_absolute_paths = true`, `strict_package_names = true`.

terp-rs also has manual `[patch."https://github.com/permissionlessweb/tendermint-rs"]` and `[patch."https://github.com/permissionlessweb/terp-rs"]` tables for deps that are already git-sourced. The same rule applies: do not stack a second patch on a git source.

### Proposal for this repo

Do **not** vendor the whole terp-rs gen-tools tree. Copy a slim slice:

```
tools/deps/
  dep.py
  dep-switch.py
  dep_common.py          # trimmed to patch-local / patch-git / validate / branch-check
  _devops/
    dep-config.toml
    dependency-matrix.toml
```

Just recipes: `deps-status`, `deps-validate`, `deps-branch-check`, `deps-patch-git`, `deps-patch-local`, `deps-stamp-revs`.

**Committed default:** `patch-git` only. A clean clone builds with published git revs and no sibling monorepo. Developers with a terp-core checkout may run `just deps-patch-local` (relative paths only, never committed). CI runs `just deps-validate` and `just deps-branch-check`.

Matrix for SEZS starts small: `cw-orch*` (including `cw-orch-kms`), `cosmwasm-*`, `zk-cosmwasm`, `cosmrs`, and any other crate the lockfile actually selects from our forks. Convert the current direct path deps (`cosmrs`, `cw-orch-kms`) into crates.io version lines plus `[patch.crates-io]`.

---

## 3. Contracts inventory

### 3.1 What SEZS actually deploys / talks to

From `packages/sezs-orch` interfaces and the deploy suite:

| Wasm stem | Role | Source today | Recommendation |
|---|---|---|---|
| `cw_event_manifold` | Event coordinator (core product) | **Only in the private app tree**, under the vendored `contracts/cw-ave/contracts/cw-event-manifold` (~13 files, ~3.2k Rust LOC). **Not in this public repo. Not in `permissionlessweb/cw-ave`.** TS schema lives at `api/ts/cw-event-manifold`. | **Move into this monorepo** (`contracts/cw-event-manifold`). History-free copy (this repo is already a single-commit export; do not subtree terp-rs or the private tree). This is a gap, not just an organization issue. |
| `cw420` | Coordinators and ushers (same wasm, two instances) | Duplicated: `permissionlessweb/cw-ave` (`contracts/cw420`) **and** `terp-rs` `contracts/ave/cw420`. Orch currently looks for the wasm via the cw-ave artifact helper. | Keep as a **git dependency** on `permissionlessweb/cw-ave`. Remove the terp-rs copy in a later terp-rs PR. Do not make a third copy here. |
| `cw_ave`, `cw_ave_factory` | Audio visual events | `permissionlessweb/cw-ave`. Apache-2.0 relicensing PR [#1](https://github.com/permissionlessweb/cw-ave/pull/1) is **merged**. Still also present under terp-rs `contracts/ave/`. | Same as cw420: git-dep on the standalone repo; remove from terp-rs later. |
| `dao_dao_core`, `dao_voting_cw4`, `dao_proposal_single`, `cw4_group` | Minimal DAO | Prebuilt artifacts from the dao-contracts fork (`dao-contracts/artifacts`). Not terp-rs. | **Do not vendor official DAO DAO contracts.** Resolve artifacts via env / documented git checkout, same pattern as cw-ave. |
| `dao_calendar` | Calendar module used by the suite | Custom crate in the dao-contracts fork (`contracts/proposal/dao-calendar`). | **Decision needed** (see §7). Not a terp-rs contract. |
| `terp_beacon` | Official drand quicknet verifier | terp-rs `contracts/nfts/terp-beacon` | **Decision needed.** Used by SEZS raffle wiring, but it is a generic chain primitive. |
| `nftfi_raffle` | Raffle | terp-rs `contracts/nfts/raffle` (plus shared `nftfi-randomness`, `nftfi-utils`) | **Decision needed.** Same question as beacon. |

### 3.2 terp-rs contracts that should stay in terp-rs (flag / ask)

terp-rs has a large `contracts/` tree (accounts, ave, cashu, hash-merchant, headstash, IBC, infuser, light-clients, nfts, revenue, shitstrap, smart-accounts, zk demos). The user asked to put **all** smart contracts SEZS needs into this monorepo and remove them from terp-rs. The following are **not** referenced by SEZS orch or the public app, and clearly belong to the chain / other products. They should **not** move here:

- headstash and private-voting stack (`cw-headstash*`, nullifier, vote-anchor/ceremony, no-rick, …)
- hash-merchant (oracles, marketplace-mirror, loyalty, …)
- infuser / svg minter / whitelist
- light clients (`cw-ics08-*`, aggregators, …)
- revenue (marketplace, auctions, private-dex, residual registry, bounty)
- shitstrap
- smart accounts (`terp-passkey`, `terp-frost`, `terp-bls`, `terp-eth`, …) — the app talks to these as **chain account types**, not as SEZS-owned contract sources
- terp721 accounts, cashu registry, IBC proxies, zk verify demos

`cw-ave` / `cw420` / `cw-ave-factory` in terp-rs are stale duplicates of `permissionlessweb/cw-ave` and should be removed from terp-rs once consumers depend on the standalone repo. That is a later terp-rs PR (plan only in this phase).

### 3.3 How to move (when approved)

- **History-free copy** into `contracts/`, then rust-fmt / license headers / workspace membership. Do not `git subtree` terp-rs or the private app: both histories contain machine-identifying paths, and this public repo was deliberately published as a single fresh commit.
- Update `sezs-orch` wasm lookup to in-repo `artifacts/` or `SEZS_CONTRACT_ARTIFACTS`.
- Follow-up (separate repo, separate go-ahead): terp-rs PR that deletes only the crates that actually moved or that became pure duplicates of `cw-ave`. Leave beacon/raffle in terp-rs until §7 is decided.

---

## 4. Dead weight (TypeScript)

`apps/sezs` is already a largely self-contained Next app (~180 TS/TSX source files, ~18.8k source LOC; ~406 files / ~52k LOC including tests and docs). It does **not** import `@dao-dao/state`, `@dao-dao/stateful`, `@dao-dao/stateless`, `@dao-dao/types`, `@dao-dao/utils`, `@dao-dao/i18n`, or `@dao-dao/storybook` anywhere in source. Those names appear only in comments, `package.json` `workspace:*` dependencies, and (for config) `tsconfig.json` `extends`.

The eight leftover DAO DAO packages still import **each other** heavily. Zero of those imports originate in `apps/sezs`.

| Package | Files | Approx. source LOC | Used by `apps/sezs`? |
|---|---:|---:|---|
| `@dao-dao/types` | 2,217 | 513k (1,980 files are protobuf codegen) | No (dep only) |
| `@dao-dao/stateful` | 1,220 | 163k | No (dep only; comment says “do not import — it OOMs Next compile”) |
| `@dao-dao/state` | 286 | 83k | No (comment: “modeled on”) |
| `@dao-dao/stateless` | 500 | 43k | No |
| `@dao-dao/utils` | 185 | 31k | No |
| `@dao-dao/i18n` | 24 | ~10k locale JSON | **No.** Zero i18n usage in the app. Locales: `en`, `es`, `fr`, `it`, `ko`, `pl`, `uk`, `zh`, `zh-tw`, plus joke locales `bad` and `dog`. |
| `@dao-dao/storybook` | 26–45 | <1k code + binary fixtures | **No.** Also referenced from a `turbo.json` `storybook` task. |
| `@dao-dao/math` | 9 | 0.5k | No |
| `@dao-dao/config` | 18 | tiny | **Yes, indirectly** — `apps/sezs/tsconfig.json` extends `@dao-dao/config/ts/nextjs.json`; root Prettier points at `@dao-dao/config/prettier`. |
| leftover import | — | — | `@dao-dao/cosmiframe` is imported from leftover packages but **is not in this workspace**. |

**Removable if the Next build and `tsc` stay green after deletion:** about **4,486 files / ~863k LOC** in unused workspace packages, plus storybook static fixtures. That is the single largest “minor-league fork” signal in the tree.

### Proposed TS package set after collapse

Do not invent a half-dozen empty packages. After deletion, keep:

- `apps/sezs` — the product (rename package to `@sezs/app` or `sezs`)
- `packages/config` — only the eslint / tsconfig / prettier files the app still extends, renamed `@sezs/config` (or inline them into the app and delete the package)
- existing Rust: moved to `crates/` (see §5)
- existing `api/ts/*` schemas can stay as `packages/schema` or under `contracts/*/ts` once contracts land

Extract `packages/ticket`, `packages/query`, `packages/auth` later **only if** a second app or a published SDK needs them. They already live coherently under `apps/sezs/src/`.

---

## 5. Proposed layout and justfile

```
sezs/
  apps/sezs/                 # Next app (today)
  contracts/                 # SEZS-owned CosmWasm crates (start with cw-event-manifold)
  crates/
    sezs-orch/
    sezs-circuit-orch/
  circuits/sezs-ticket-v2/   # already here
  packages/
    config/                  # or inlined and omitted
    schema/                  # optional; today’s api/ts
  tools/deps/                # slim patch-git / patch-local
  docs/
  scripts/                   # called from just, not a second entry point
  justfile                   # the only operator entry point
```

DAO DAO `packages/state{,ful,less,types,utils,i18n,storybook,math}` go away. `websites/sezs-docs` can remain or move under `docs/site` in a later cleanup.

### Makefile → justfile

Today there are two entry points, and they disagree. Root `justfile` is a thin wrapper that shells out to `make` for **nine** recipes (`help`, `build`, `test`, `docs`, `circuits`, `env-up`, `env-fund`, `env-seed`, `env-down`, `env-health`, `e2e`) and omits the rest. The Makefile is the real surface. Several Makefile recipes start with `true;` (no-op cargo-cult). `docs` cds into `websites/sezs-docs`.

Replace both with one justfile. Map:

| Current make target | Proposed just recipe | Notes |
|---|---|---|
| `help` | default / `help` | |
| `build` | `build` | `tsc` + `next build` for `apps/sezs` |
| `test` | `test` | current unit set; later add `test-e2e`, `test-orch` |
| `docs` | `docs` | `websites/sezs-docs` or future `docs/site` |
| `circuits` | `circuits` | keep in-tree artifact short-circuit |
| `schema` / `codegen` | `schema` / `codegen` | |
| `deploy-local` / `deploy` | `deploy-local` / `deploy` | keep mainnet confirm guard |
| `event-roles` / `event-curate` | `event-roles` / `event-curate` | |
| `orch-test` | `test-orch` | |
| `kms-local-test` | `test-kms-local` | loopback only |
| `env-up` / `env-fund` / `env-seed` / `env-down` / `env-health` | same names | |
| `e2e` | `e2e` | |
| `narration-lint` / `narration-validate` | same | |
| `diagrams` / `flows-derive` | same | |
| `studio` / `studio-serve` / `studio-takes` / `studio-lint` | same | |
| `walkthrough-timeline` / `render` / `preview` / `capture-stub` | same | |
| *(new)* | `deps-patch-git`, `deps-patch-local`, `deps-validate`, `deps-branch-check` | |
| *(new)* | `check` | fmt + lint + `tsc` + unit tests |

Root `package.json` scripts can stay as thin `pnpm` aliases, but operators should be told to use `just`. Delete `Makefile` once the justfile is complete and tested. Recurse: no nested Makefiles were found in the export.

---

## 6. Slop audit (ranked)

Counts are from the current public export, excluding `node_modules`, `.next`, `target`, and lockfiles.

1. **Unused DAO DAO workspace (critical).** ~4,486 files / ~863k LOC that the app does not import. Includes a `packages/types/shit/` folder, Headstash / Shitstrap / Infusions / Vesting / Validator actions, and 1,980 protobuf codegen files (individual files up to 9.4k LOC). This is the primary “unpolished fork” impression.

2. **`@dao-dao` branding (critical, after deletion it mostly vanishes).** ~4,770 hits in ~1,763 files: package names (`@dao-dao/sezs` for the product app), imports, README, CONTRIBUTING, turbo filters. Rename whatever remains to `@sezs/*`.

3. **Bloated Rust `[patch]` table (high).** 59 sibling-path patches, most unused by this workspace; plus direct path deps. See §1 and §2.

4. **Commented-out code (medium).** ~415 comment lines that look like disabled statements, in 69 files. Worst: `packages/stateful/modules/modules/Headstash/components/ClaimHeadstashModal.tsx` (814 comment lines in a 1,421-line file), `ManageAvEvents/index.tsx` (460 / 969). Most of this disappears with the unused packages. In the app, `apps/sezs/src/ticket/qrcode-generator.js` is a 2,299-line vendored generator (176 comment lines) — keep or replace deliberately.

5. **Junk / overlapping markdown (medium).** 189 markdown files, ~9.7k LOC. Some is real product spec (`TICKET-V2-SPEC`, `IDENTITY-AND-ROLES`, `DEPLOY`). Some is leftover DAO DAO package READMEs, a 548-line `docs/specs/GUIDES-AND-DEMO-ENGINE.md`, derived flow dumps (`docs/flows/derived/`), and `apps/sezs/docs/V0-ITERATIONS.md`. Giant generated SVGs under `docs/flows/derived/` should not be hand-edited source.

6. **Residual machine-identifying strings (medium, fix before the next public commit).** 19 hits in 9 **repo-relative** files: `packages/storybook/README.md`, `packages/stateful/modules/modules/Calendar/README.md`, `packages/utils/labTopology.test.ts`, `packages/utils/embedFriction.test.ts`, `packages/utils/constants/registry.ts`, `packages/utils/constants/chains.ts`, `apps/sezs/docs/ZAFU-CONNECT.md`, `apps/sezs/dev/splash/consume-relay.test.mjs`, `apps/sezs/src/auth/rpId.test.mjs`. Do not quote the values here. Several of these files die with the unused packages; scrub the app-side ones explicitly.

7. **Prompt-runoff / generic filler (low–medium).** 36 hits in 24 files, mostly generated protobuf comments and `packages/types/README.md`. Vanishes with types. Re-read remaining docs for assistant-voice leftovers when deslopping.

8. **ITL naming remnants (low).** Domain-separator / old product name in circuit and orch comments (`circuits/sezs-ticket-v2/circuit/src/blob.rs`, `packages/sezs-orch/src/lib.rs`, `packages/sezs-circuit-orch/src/interface.rs`) and in derived flow diagrams (`itl_domain`). Rename only where it is user-facing or confusing; preserve on-wire constants if they are consensus-critical (confirm before renaming).

9. **TODO/FIXME (low).** 60 hits in 40 files, many inside protobuf. Not a priority until after deletion.

10. **Lab-pay leftovers (low, verify).** 4 hits in 3 files: `scripts/studio-lint.py`, `scripts/env/sezs_payroll_drive.mjs`, `scripts/env/sezs_real_ticket_payroll.mjs`. Confirm these are not the removed UI control; delete or reword if they only exist for the old loopback-pay path.

11. **justfile is a Makefile shim (high, easy).** See §5. The Makefile `true;` prefixes and the incomplete recipe list read careless.

12. **wasm.rs still assumes a sibling terp-core checkout** for DAO and terp-rs artifacts (high for “clone and build”).

---

## 7. Risks, order of operations, effort, decisions

### Risks

- **Unpublished fork tips.** Pinning the matrix pin for cw-orch / cosmrs produces a public clone that **cannot upload circuits** the way SEZS does. Pinning the local tips without publishing them also fails. Those unpublished commits must be leak-scanned before they go to the public forks.
- **Deleting TS packages** should be proven with `tsc` and `next build` (and a lockfile rewrite). Risk is low given zero source imports, but turbo / prettier / eslint still reach `@dao-dao/config`.
- **Contract moves** must not silently change deployed bytecode. Copy sources, document artifact hashes, and keep looking up existing mainnet code ids. History-free copy means no blame; acceptable because the public repo already has no imported history.
- **CosmWasm 2.2 contract packages vs 4.1 orch fork** is already papered over with JSON `interface` wrappers. Moving contracts into the same workspace must not accidentally compile them against 4.1 or the orch against 2.2 without a decision.
- **This plan file** is written to be public-safe. Commit it only after review; it will itself be judged.

### Suggested order (after go-ahead; not started)

1. **Publish and pin forks** (separate repos, separate approval): leak-scan and push `sezs/msg-store-full-circuit` (or a merged public branch) on `cw-orchestrator` and `cosmos-rust`. Choose the cosmwasm SHA (§7 decisions). Then add `tools/deps` + `patch-git` in this repo and drop sibling paths.
2. **Replace Makefile with a complete justfile** (no behavior change besides not calling `make`).
3. **Delete unused TS packages**, rewrite pnpm workspace / turbo / root scripts, rename `@dao-dao/sezs` → `@sezs/…`. Verify `tsc` + `next build` + unit tests (same known ticket-vector exceptions).
4. **Land `cw-event-manifold` in `contracts/`**, point orch + `api/ts` at it, document artifact env vars.
5. **Scrub remaining slop** in the kept tree (machine-path strings, ITL comments, lab-pay script hits, doc overlap, `true;` leftovers).
6. **Only then**, if decided, vendor or git-dep beacon / raffle / dao-calendar; open a terp-rs removal PR for true duplicates (`cw-ave` / `cw420` / factory, and anything actually moved).

Rough effort after fork publication: **about one to two weeks** of focused work (1–2 days deps + justfile, 1–2 days TS deletion and rename, 1–2 days event-manifold + orch paths, 2–3 days deslop and doc pass). Beacon/raffle moves and the terp-rs PR are extra and should wait on the decisions below.

### Decisions needed

1. **Which SHAs to publish and pin** for `permissionlessweb/cw-orchestrator` and `permissionlessweb/cosmos-rust`. Recommendation: leak-scan and publish the current `sezs/msg-store-full-circuit` tips (`4d229628a8333b2d7011a0e670238d5e8494bff4` and `cd05b370ddff27fba82fa071c76d270c1ca7181c`), then pin those full revs. Do not pin `penumbra-custody` / matrix cosmrs if circuit upload must work from a clean clone.

2. **Cosmwasm pin:** matrix `ffe57a757cab77211e0c3a85a9c00109a52b1965` vs current `security/advisory-bumps` tip `adace180be362e03c5aabed4b705c37c7f633d94` (4.1.0 changelog label). Recommendation: **the branch tip**, unless a consumer is known to require the older SHA.

3. **Where `cw-event-manifold` lives.** Recommendation: **this monorepo** (`contracts/cw-event-manifold`), not `cw-ave`. It is the SEZS product contract and is already absent from `permissionlessweb/cw-ave`.

4. **`cw-ave` / `cw420` / `cw-ave-factory`:** vendor into this monorepo, or git-dep on `permissionlessweb/cw-ave`? Recommendation: **git-dep** on the standalone Apache-2.0 repo (already public; PR #1 merged). That still satisfies “contracts are curated and buildable,” without a third copy. Remove the terp-rs duplicates later. If the letter of “all smart contracts live in this monorepo” is mandatory, say so and we will vendor them — at the cost of diverging from the standalone repo.

5. **`terp-beacon` and `nftfi-raffle`:** move here, or keep as terp-rs artifacts / git deps? These look like **terp-core primitives** that SEZS uses, not SEZS-owned contracts. Recommendation: **keep them in terp-rs**, look up wasm via env, and do not move them unless you want this repo to be the canonical home of raffle/beacon.

6. **`dao-calendar` and the official DAO DAO wasm set:** leave as external artifacts, or vendor `dao-calendar` only? Recommendation: **external artifacts** for official DAO DAO crates; decide `dao-calendar` separately if it is our fork-only module and we want to own it here.

7. **TS deletion sharpness.** Recommendation: **delete the unused packages in one change**, keep only `@sezs/config` (or inline it). Do not try to “save” types/utils “just in case.”

8. **Dep-switch tooling.** Recommendation: **slim copy** of the terp-rs Python control plane into `tools/deps/`, not a submodule of terp-rs and not a from-scratch rewrite.

---

*End of Phase 1. Implementation waits on the decisions above and an explicit go-ahead.*
