//! Speak-Ez Sessions cw-orch suite, compiled against the terp-core
//! `cw-orchestrator` fork (`cw-orch` 0.30 + `cosmwasm-std` 4.1 via
//! `[patch.crates-io]` in this workspace).
//!
//! Follows terp-orch / itl-zk-cw-orch: one interface per contract, a
//! [`suite::SezsSuite`] that implements [`cw_orch::prelude::Deploy`],
//! and `#[cw_orch::circuit_interface(id = "sezs_consume_v2")]` so
//! circuit compilation and `upload_circuit()` run in the same flow as
//! contract `upload()`.
//!
//! Network: `NETWORK` / `SEZS_NETWORK` (`local` / `sezs-local-1`
//! default). Mainnet (`morocco-1`) is variables only. Broadcast is
//! refused unless `SEZS_DEPLOY_CONFIRM_MAINNET=1`. Local deploys target
//! loopback only.
//!
//! The `sezs-orch-deploy` and `sezs-orch-curate` bins sign with a
//! cw-orch Daemon when `SEZS_DEPLOY_MNEMONIC` / `LOCAL_MNEMONIC` or
//! `SEZS_DEPLOY_SECP256K1` is already in the environment. Those values
//! are never logged. On remote chains the signer is the cw-orch-kms
//! operator (grantee): `CW_ORCH_GRANTER` (default morocco-1 curator)
//! must already have a covering authz+feegrant, or the bin refuses
//! without opening a Zigner page. `make deploy-local` can feed a
//! keyring hex export into `SEZS_DEPLOY_SECP256K1` without printing it
//! (loopback, no `CW_ORCH_GRANTER`, still signs directly).
//!
//! Randomness / raffle: existing `terp-beacon` (drand quicknet verifier)
//! and `nftfi-raffle`. Event-manifold `RequestDraw` records a job and
//! expects a later `RandomnessReceive`; it does not call terp-beacon
//! `Provide`. The deploy wires both and documents that callback gap.

pub mod interfaces;
pub mod kms;
pub mod networks;
pub mod seed;
pub mod suite;
pub mod wasm;

pub use interfaces::SezsSuite;
pub use networks::{assert_deploy_allowed, chain_from_env, NetworkChoice};
pub use seed::{EventSpec, LanternNight};
pub use suite::{Member, SezsAddresses, SezsDeployData};
