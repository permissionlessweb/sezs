# sezs-orch

Reusable [cw-orch](https://github.com/AbstractSDK/cw-orchestrator) Deploy
suite for Speak-Ez Sessions, compiled against the terp-core
`cw-orchestrator` fork (`cw-orch` 0.30, `zk` feature).

This workspace members `sezs-orch` and `sezs-circuit-orch`. The
`[patch.crates-io]` table points `cosmwasm-std` 4.1, `cw-orch`,
`cosmrs`, and the related crates in a local terp-core checkout, which is how
the fork is meant to be consumed (same pattern as `terp-rs`).

## What it deploys

1. Production circuit `sezs_consume_v2`: `prepare_artifacts()` builds
   params, vk, and the 80-byte CircuitFooter from
   `circuits/sezs-ticket-v2` (or reuses a valid existing blob).
   `SezsConsumeV2Circuit::upload_circuit()` registers it on chain
   through the daemon (`MsgStoreCircuit`) and records the zkid in
   cw-orch state.
2. SEZS contracts: `cw420` coordinator and usher groups,
   `cw-event-manifold`, optional `cw-ave` / `cw-ave-factory`.
3. A minimal DAO (`dao-dao-core` + `dao-voting-cw4` +
   `dao-proposal-single` + `cw4-group`) and `dao-calendar` when those
   artifacts are present under `terp-core/crates/dao-contracts/artifacts`.
4. `terp-beacon` (official drand quicknet verifier) and `nftfi-raffle`.
   Event-manifold `RequestDraw` still expects a later
   `RandomnessReceive`; it does not call terp-beacon `Provide`.
5. The fictional Lantern Night seed (16 January 2027, Africa/Dakar),
   with the circuit zkid wired into event instantiate.

There is no `terpd tx wasm store-full-circuit` fallback.

## Networks

`NETWORK` / `SEZS_NETWORK` (`local` default, `mainnet` / `morocco-1`,
`testnet`). Remote broadcast is refused unless
`SEZS_DEPLOY_CONFIRM_MAINNET=1`. Local is `sezs-local-1` on loopback,
gas denom `uterp`.

## How to run

```sh
make deploy-local
```

See `docs/DEPLOY.md` for signer env vars, state files, and boot output.
`cargo test --manifest-path packages/sezs-orch/Cargo.toml` covers
network policy, footer validation, artifact prepare, and the seed
payload. Live `upload_circuit()` is exercised by `make deploy-local`
(the fork's `ZkTxHandler` is implemented for the Daemon, not Mock).
