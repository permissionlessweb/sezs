# Deploying Speak-Ez Sessions

Local deploys go through the permissionlessweb `cw-orchestrator` fork (`cw-orch`
0.30 with the `zk` feature). Circuit compilation and registration use
the same scripting surface as contract wasm: `SezsSuite` implements
`cw_orch::prelude::Deploy`, prepares the `sezs_consume_v2` store-circuit
blob (`[params][cs][vk][CircuitFooter]`) from `circuits/sezs-ticket-v2`,
and calls `SezsConsumeV2Circuit::upload_circuit()`. The daemon splits the
combined blob and sends `MsgStoreFullCircuit`, then records the zkid in
cw-orch state the same way it records code ids. That zkid is passed into
the event contract instantiate, and `set_zkid` also writes the ticket-v2
`event_id_fp` and `domain_fp` fingerprints. If `SEZS_GUEST_ROOT_VK` or
`admin-frost/meta.json` is present, the suite also sets the admin FROST
group verifying key so guest-root publishes can be verified.

There is no `terpd tx wasm store-full-circuit` path and no fallback to
it.

## Networks

| `NETWORK` / `SEZS_NETWORK` | chain id | gas denom | broadcast |
| --- | --- | --- | --- |
| `local` (default) | `sezs-local-1` | `uterp` | loopback only (`127.0.0.1`) |
| `mainnet` / `morocco-1` | `morocco-1` | `uthiol` | refused unless `SEZS_DEPLOY_CONFIRM_MAINNET=1` |
| `testnet` | `90u-4` | `uthiolx` | same confirm var |

Mainnet values are configuration only. This tree never points a default
broadcast at a public node.

## Local walkthrough

The walkthrough terpd must already be running. This target will not
start a new chain.

```sh
just deploy-local
```

That runs `scripts/deploy.sh`, which:

1. Reads public addresses for `curator`, `service`, `usher`, and `coord`
   from the session test keyring (`--home /tmp/sezs-session-walkthrough/terp`).
2. If `LOCAL_MNEMONIC` / `SEZS_DEPLOY_MNEMONIC` is not already in the
   environment, exports the curator secp256k1 secret into
   `SEZS_DEPLOY_SECP256K1` for the process only (never printed) and
   unsets it on exit.
3. Runs `sezs-orch-deploy` with `STATE_FILE` at
   `/tmp/sezs-session-walkthrough/cw-orch-state.json` and a fresh
   `SEZS_DEPLOYMENT_ID`. The daemon also writes a network-suffixed
   `cw-orch-state_local.json` next to that path.
4. `SezsSuite::deploy_on` compiles or reuses a valid
   `sezs_consume_v2_vk.bin`, uploads the circuit through cw-orch, stores
   SEZS / DAO / terp-beacon / nftfi-raffle wasm, instantiates the stack,
   and curates the fictional Lantern Night record (16 January 2027,
   Africa/Dakar).
5. Writes `terp-boot.json` and `apps/sezs/dev/localterp/boot.json` so
   the app can be repointed at the new event, zkid, and groups.

Force a fresh keygen even when a valid blob exists with
`SEZS_REBUILD_CIRCUIT=1`. Skip keygen (and fail if the blob is invalid)
with `SEZS_SKIP_CIRCUIT_KEYGEN=1`.

After a successful local deploy, restart the Next and splash processes
so they pick up the new boot file. Do not tear down the walkthrough
terpd.

## Signing

The Daemon path needs one of:

- `SEZS_DEPLOY_MNEMONIC` or `LOCAL_MNEMONIC` already in the environment
- `SEZS_DEPLOY_SECP256K1` — 32-byte hex of an already-derived secp256k1
  secret (the fork's `CosmosOptions::secp256k1_secret`, the same shape
  as a `terpd keys export --unarmored-hex`)

This crate never reads a mnemonic file and never logs signer material.

## Fork wiring

The workspace root is `packages/Cargo.toml` (members `sezs-orch` and
`sezs-circuit-orch`). It depends on the permissionlessweb `cw-orchestrator` fork
crates and uses `[patch.crates-io]` so `cosmwasm-std = 4.1.0` and the
fork's `cosmrs` (which carries `MsgStoreFullCircuit`) resolve to the
private path crates, matching `terp-rs` and the intended use of the
fork. `sezs-circuit-orch` holds

```rust
#[cw_orch::circuit_interface(id = "sezs_consume_v2", artifacts_dir = "...")]
pub struct SezsConsumeV2Circuit;
```

SEZS contract packages stay on CosmWasm 2.2 and are not compiled into
this workspace. Instantiate and curate messages are JSON that matches
the uploaded wasm ABI.

## Randomness and raffles

The suite stores and instantiates `terp-beacon` (official drand quicknet
verifier, scheme `bls-unchained-g1-rfc9380`) and `nftfi-raffle`.
Event-manifold `RequestDraw` still expects a later `RandomnessReceive`
callback; it does not call terp-beacon `Provide`. That gap is
unchanged. Do not invent a new oracle.


To refresh the public NIP-52 metadata file and upsert sponsors on that
same already-deployed local event (loopback only; does not instantiate a
new suite):

```sh
make event-curate
```

`sezs-orch-curate` writes `apps/sezs/public/lantern-night-nip52.json`,
then sends `SetMetadata` and `UpsertSponsor` through cw-orch. Lineup,
tiers, and raffles are left untouched.

## Schema and TypeScript clients

```sh
make schema
make codegen
```

`make schema` runs each contract's `schema` example into
`contracts/cw-ave/contracts/<name>/schema`. `make codegen` writes
TypeScript types, clients, and message composers under `api/ts/<name>/`.
The app LCD client remains the hand-written `apps/sezs/lib/event-client.ts`.

## Apply coordinator and usher addresses (existing local event)

Once the coordinator and usher `terp1` addresses are known, apply them
to the already-deployed local event in one step (loopback only; does not
instantiate a new suite):

```
NETWORK=local SEZS_COORDINATOR=terp1… SEZS_USHER=terp1… make event-roles
```

This funds each address from the session curator if needed, then runs
`sezs-orch-roles`. That binary loads `STATE_FILE` / `terp-boot.json`,
adds the coordinator to the coordinators group, adds the usher to the
ushers group, and sets the ushers group admin to the coordinator
address (cw420 admin is a single Addr; later update_members is signed
by that coordinator in Zafu, not by the backend).
