# Speak-Ez Sessions

Private events powered by anti-surveillance money.

Speak-Ez Sessions (SEZS) is an event web app. Guests buy tickets with
shielded payments, keep the ticket secret in their own browser, and show
it at the door. Ushers verify the ticket and consume it so it cannot be
used twice.

## Layout

| Path | What it is |
| --- | --- |
| `apps/sezs` | The web app (Next.js, static export) and its session server |
| `packages/` | Shared UI and chain-state packages derived from DAO DAO UI |
| `packages/sezs-orch` | cw-orch deploy and curate suite for the SEZS contracts |
| `packages/sezs-circuit-orch` | cw-orch interface for the ticket consume circuit |
| `circuits/sezs-ticket-v2` | Halo2 ticket consume circuit, prover and wasm bindings |
| `websites/sezs-docs` | Public docs site |
| `deploy/events` | Event definitions |

## Develop

```bash
pnpm install
make build   # type-check and build the app
make test    # app unit tests (needs the prover wasm: apps/sezs/scripts/build-ticket-v2-wasm.sh)
```

Dev servers bind to `127.0.0.1` only. Deploys of contracts and circuits
go through cw-orch (`packages/sezs-orch`).

## Licenses

See `NOTICE`. `apps/sezs` is AGPL-3.0-only. Packages derived from DAO DAO
UI keep The Clear BSD License. `contracts/cw-ave` has its own license.


## Event contracts

Event contracts live in a separate repository, [permissionlessweb/cw-ave](https://github.com/permissionlessweb/cw-ave).
That project is maintained by PermissionlessWeb; it is not an official DAO DAO contract suite.

To deploy or curate, build the contract artifacts there and point the orchestrator at them:

```bash
export CW_AVE_ROOT=/path/to/cw-ave
# or
export SEZS_CW_AVE_ARTIFACTS=/path/to/cw-ave/artifacts
```
