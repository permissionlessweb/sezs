# Speak-Ez Sessions

Private events powered by anti-surveillance money.

Speak-Ez Sessions (SEZS) is an event web app. Guests buy tickets with
shielded payments, keep the ticket secret in their own browser, and show
it at the door. Ushers verify the ticket and consume it so it cannot be
used twice.

Public repository: [permissionlessweb/sezs](https://github.com/permissionlessweb/sezs).

## Layout

| Path | What it is |
| --- | --- |
| `apps/sezs` | Web app (Next.js, static export) |
| `packages/config` | Shared TypeScript, ESLint and Prettier config |
| `crates/sezs-server` | One-bind loopback backend (session, ticketing, payroll; email opt-in) |
| `crates/sezs-outpost` | Loopback Bluetooth outpost (usher devices) |
| `crates/sezs-orch` | cw-orch deploy and curate suite |
| `crates/sezs-circuit-orch` | cw-orch interface for the ticket consume circuit |
| `contracts/cw-event-manifold` | Event coordinator CosmWasm contract |
| `circuits/sezs-ticket-v2` | Halo2 ticket consume circuit, prover and wasm bindings |
| `docs/specs` | ZIP-style specifications (source for the docs site) |
| `docs/` | Product and build documentation |
| `justfile` | The only operator entry point |

Related contracts that this repo **references but does not vendor**:

- [permissionlessweb/cw-ave](https://github.com/permissionlessweb/cw-ave) — `cw-ave`, factory, `cw420`
- [permissionlessweb/dao-contracts](https://github.com/permissionlessweb/dao-contracts) — DAO modules and `dao-calendar` (calendar stays in that repo)
- [permissionlessweb/terp-rs](https://github.com/permissionlessweb/terp-rs) — `terp-beacon`, `nftfi-raffle`

## Build

A clean clone is enough. You do not need a sibling monorepo.

```bash
just install       # Node via .nvmrc + Corepack pnpm, frozen lockfile
just typecheck
just build
just test
just check-crates
just optimize      # terp-optimizer (Docker); writes contracts/artifacts/checksums.txt
```

Tooling pins, fork revisions, and artifact environment variables are in
[`docs/BUILD.md`](docs/BUILD.md).

Optional loopback recipes (`just env-up`, `just deploy-local`, studio and
walkthroughs) are for local development and are not required to build or
test.

## Licenses

See `NOTICE`. `apps/sezs` is AGPL-3.0-only. `packages/config` (derived from
DAO DAO UI config) keeps The Clear BSD License. Orchestrator and circuit
crates are BSD-3-Clause. `contracts/` is Apache-2.0.
