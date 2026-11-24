# sezs-orch

Reusable [cw-orch](https://github.com/permissionlessweb/cw-orchestrator)
Deploy suite for Speak-Ez Sessions (`cw-orch` 0.30 with the `daemon` and
`zk` features). Workspace members are `sezs-orch` and `sezs-circuit-orch`.

Rust dependencies resolve from crates.io plus the committed
`[patch.crates-io]` table of published git revisions (see
`tools/deps` and `docs/BUILD.md`). A clean clone does not need a
sibling crates checkout.

## What it deploys

1. Production circuit `sezs_consume_v2`: `prepare_artifacts()` builds
   or reuses the store-circuit blob under
   `circuits/sezs-ticket-v2/artifacts/` (run `just circuits` first).
   `SezsConsumeV2Circuit::upload_circuit()` registers it on chain
   (`MsgStoreCircuit`) and records the zkid in cw-orch state.
2. In-repo `cw-event-manifold`, plus optional `cw-ave` / `cw-ave-factory`
   when those artifacts are supplied.
3. A minimal DAO (`dao-dao-core`, `dao-voting-cw4`,
   `dao-proposal-single`, `cw4-group`) and `dao-calendar` when those
   artifacts are supplied. dao-calendar stays in
   [permissionlessweb/dao-contracts](https://github.com/permissionlessweb/dao-contracts);
   it is not vendored here.
4. `terp-beacon` and `nftfi-raffle` when those artifacts are supplied.
   Event-manifold `RequestDraw` still expects a later
   `RandomnessReceive`; it does not call terp-beacon `Provide`.
5. The fictional Lantern Night seed (16 January 2027, Africa/Dakar),
   with the circuit zkid wired into event instantiate.

Artifact lookup is env-first, then in-repo `contracts/artifacts`, then
an optional relative sibling. See `src/wasm.rs` and `docs/BUILD.md`.
No absolute machine paths are hardcoded.

## Networks

`NETWORK` / `SEZS_NETWORK` (`local` default, `mainnet` / `morocco-1`,
`testnet`). Remote broadcast is refused unless
`SEZS_DEPLOY_CONFIRM_MAINNET=1`. Local is `sezs-local-1` on loopback,
gas denom `uterp`.

## How to run

```sh
just deploy-local
```

See `docs/DEPLOY.md` for signer env vars, state files, and boot output.
`just test-crates` covers network policy, footer validation (skipped if
the circuit blob is absent), and the seed payload. Live
`upload_circuit()` is exercised by `just deploy-local` (the fork's
`ZkTxHandler` is implemented for the Daemon, not Mock).
