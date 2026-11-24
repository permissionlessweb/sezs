//! `#[cw_orch::circuit_interface(id = "sezs_consume_v2")]` against the
//! terp-core cw-orch fork, mirroring itl-zk-cw-orch `ConsumeCircuitSuite`
//! and terp-orch `interfaces/circuits.rs`.
//!
//! `artifacts_dir` is relative to this crate's `CARGO_MANIFEST_DIR`.
//! `.upload_circuit()` (available when `Chain: ZkCwEnv`) stores
//! `sezs_consume_v2_vk.bin` via the daemon `MsgStoreCircuit` path and
//! persists the zkid in cw-orch state.

/// Production consume circuit. Combined store-circuit blob
/// `[params][cs][vk][CircuitFooter]` at
/// `circuits/sezs-ticket-v2/artifacts/sezs_consume_v2_vk.bin`.
#[cw_orch::circuit_interface(
    id = "sezs_consume_v2",
    artifacts_dir = "../../circuits/sezs-ticket-v2/artifacts"
)]
pub struct SezsConsumeV2Circuit;
