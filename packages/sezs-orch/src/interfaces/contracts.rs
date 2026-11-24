//! cw-orch contract interfaces. Message types are JSON so this crate can
//! compile against the cw-orch 0.30 / cosmwasm-std 4.1 fork without
//! depending on the CosmWasm 2.2 contract packages. Uploadable only
//! provides `wasm()` — wrappers would require those packages, and Mock
//! is not a ZkCwEnv in the fork anyway.

use cw_orch::{interface, prelude::*};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Transparent JSON message for instantiate / execute / query.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct JsonMsg(pub Value);

fn wasm_sezs(stem: &str) -> WasmPath {
    let p = crate::wasm::sezs_wasm(stem).unwrap_or_else(|e| panic!("{e}"));
    WasmPath::new(p).unwrap()
}

fn wasm_dao(stem: &str) -> WasmPath {
    let p = crate::wasm::dao_wasm(stem).unwrap_or_else(|e| panic!("{e}"));
    WasmPath::new(p).unwrap()
}

fn wasm_terp(stem: &str) -> WasmPath {
    let p = crate::wasm::terp_rs_wasm(stem).unwrap_or_else(|e| panic!("{e}"));
    WasmPath::new(p).unwrap()
}

macro_rules! only_wasm {
    ($ty:ident, $resolve:ident, $stem:expr) => {
        impl<Chain> Uploadable for $ty<Chain> {
            fn wasm(_chain: &ChainInfoOwned) -> WasmPath {
                $resolve($stem)
            }
        }
    };
}

#[interface(JsonMsg, JsonMsg, JsonMsg, Empty, id = "cw_event_manifold")]
pub struct EventManifold;
only_wasm!(EventManifold, wasm_sezs, "cw_event_manifold");

#[interface(JsonMsg, JsonMsg, JsonMsg, Empty, id = "cw420_coordinators")]
pub struct Coordinators;
only_wasm!(Coordinators, wasm_sezs, "cw420");

#[interface(JsonMsg, JsonMsg, JsonMsg, Empty, id = "cw420_ushers")]
pub struct Ushers;
only_wasm!(Ushers, wasm_sezs, "cw420");

#[interface(JsonMsg, JsonMsg, JsonMsg, Empty, id = "cw_ave")]
pub struct CwAve;
only_wasm!(CwAve, wasm_sezs, "cw_ave");

#[interface(JsonMsg, JsonMsg, JsonMsg, Empty, id = "cw_ave_factory")]
pub struct CwAveFactory;
only_wasm!(CwAveFactory, wasm_sezs, "cw_ave_factory");

#[interface(JsonMsg, JsonMsg, JsonMsg, Empty, id = "dao_dao_core")]
pub struct DaoDaoCore;
only_wasm!(DaoDaoCore, wasm_dao, "dao_dao_core");

#[interface(JsonMsg, JsonMsg, JsonMsg, Empty, id = "dao_voting_cw4")]
pub struct DaoVotingCw4;
only_wasm!(DaoVotingCw4, wasm_dao, "dao_voting_cw4");

#[interface(JsonMsg, JsonMsg, JsonMsg, Empty, id = "dao_proposal_single")]
pub struct DaoProposalSingle;
only_wasm!(DaoProposalSingle, wasm_dao, "dao_proposal_single");

#[interface(JsonMsg, JsonMsg, JsonMsg, Empty, id = "cw4_group")]
pub struct Cw4Group;
only_wasm!(Cw4Group, wasm_dao, "cw4_group");

#[interface(JsonMsg, JsonMsg, JsonMsg, Empty, id = "dao_calendar")]
pub struct DaoCalendar;
only_wasm!(DaoCalendar, wasm_dao, "dao_calendar");

#[interface(JsonMsg, JsonMsg, JsonMsg, Empty, id = "terp_beacon")]
pub struct TerpBeacon;
only_wasm!(TerpBeacon, wasm_terp, "terp_beacon");

#[interface(JsonMsg, JsonMsg, JsonMsg, Empty, id = "nftfi_raffle")]
pub struct NftfiRaffle;
only_wasm!(NftfiRaffle, wasm_terp, "nftfi_raffle");
