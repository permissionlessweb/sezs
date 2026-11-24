//! SezsSuite Deploy: compile/upload the consume circuit through the
//! cw-orch fork, store contracts, instantiate the stack, and seed
//! Lantern Night. Mirrors contract `upload()` with `upload_circuit()`.

use anyhow::anyhow;
use base64::Engine;
use cw_orch::environment::{IndexResponse, ZkCwEnv};
use cw_orch::{
    core::CwEnvError,
    prelude::{
        CircuitInstance, ContractInstance, CwEnv, CwOrchCircuitUpload, CwOrchExecute,
        CwOrchInstantiate, CwOrchQuery, CwOrchUpload, Deploy,
    },
};
use sezs_circuit_orch::SezsConsumeV2Circuit;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::interfaces::{
    Coordinators, CwAve, CwAveFactory, Cw4Group, DaoCalendar, DaoDaoCore, DaoProposalSingle,
    DaoVotingCw4, EventManifold, JsonMsg, NftfiRaffle, TerpBeacon, Ushers,
};
use crate::seed::{terp_beacon_instantiate, EventSpec, LanternNight};
use crate::wasm;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Member {
    pub addr: String,
    pub weight: u64,
}

/// Data required to instantiate a fresh SEZS event stack.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SezsDeployData {
    pub coordinators: Vec<Member>,
    pub ushers: Vec<Member>,
    pub curator: Option<String>,
    pub service_key: Option<String>,
    pub event: LanternNight,
    /// Optional structured event spec (overrides `event` when present).
    pub spec: Option<EventSpec>,
    /// Public NIP-52 document path (default: apps/sezs/public/lantern-night-nip52.json).
    pub meta_path: Option<PathBuf>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SezsAddresses {
    pub cw_event_manifold: Option<String>,
    pub cw420_coordinators: Option<String>,
    pub cw420_ushers: Option<String>,
    pub cw_ave_factory: Option<String>,
    pub dao_dao_core: Option<String>,
    pub dao_calendar: Option<String>,
    pub terp_beacon: Option<String>,
    pub nftfi_raffle: Option<String>,
}

#[derive(Clone)]
pub struct SezsSuite<Chain: CwEnv> {
    pub event: EventManifold<Chain>,
    pub coordinators: Coordinators<Chain>,
    pub ushers: Ushers<Chain>,
    pub cw_ave: CwAve<Chain>,
    pub cw_ave_factory: CwAveFactory<Chain>,
    pub dao_core: DaoDaoCore<Chain>,
    pub dao_voting: DaoVotingCw4<Chain>,
    pub dao_proposal: DaoProposalSingle<Chain>,
    pub cw4_group: Cw4Group<Chain>,
    pub dao_calendar: DaoCalendar<Chain>,
    pub terp_beacon: TerpBeacon<Chain>,
    pub nftfi_raffle: NftfiRaffle<Chain>,
    pub circuit: SezsConsumeV2Circuit<Chain>,
    pub zkid: Option<u64>,
    pub addresses: SezsAddresses,
}

impl<Chain: CwEnv> SezsSuite<Chain> {
    pub fn new(chain: Chain) -> Self {
        Self {
            event: EventManifold::new(chain.clone()),
            coordinators: Coordinators::new(chain.clone()),
            ushers: Ushers::new(chain.clone()),
            cw_ave: CwAve::new(chain.clone()),
            cw_ave_factory: CwAveFactory::new(chain.clone()),
            dao_core: DaoDaoCore::new(chain.clone()),
            dao_voting: DaoVotingCw4::new(chain.clone()),
            dao_proposal: DaoProposalSingle::new(chain.clone()),
            cw4_group: Cw4Group::new(chain.clone()),
            dao_calendar: DaoCalendar::new(chain.clone()),
            terp_beacon: TerpBeacon::new(chain.clone()),
            nftfi_raffle: NftfiRaffle::new(chain.clone()),
            circuit: SezsConsumeV2Circuit::new(chain),
            zkid: None,
            addresses: SezsAddresses::default(),
        }
    }

    fn store_sezs_contracts(&self) -> Result<(), CwEnvError> {
        if self.coordinators.code_id().is_err() {
            self.coordinators.upload()?;
        } else {
            eprintln!("sezs-orch: reusing cw420_coordinators code_id={}", self.coordinators.code_id().unwrap());
        }
        if let Ok(code) = self.coordinators.code_id() {
            let _ = self.ushers.set_code_id(code);
        } else if self.ushers.code_id().is_err() {
            self.ushers.upload()?;
        }
        if self.event.code_id().is_err() {
            self.event.upload()?;
        } else {
            eprintln!("sezs-orch: reusing cw_event_manifold code_id={}", self.event.code_id().unwrap());
        }
        if !minimal_stack() {
            if self.cw_ave.code_id().is_err() && wasm::sezs_wasm("cw_ave").is_ok() {
                self.cw_ave.upload()?;
            }
            if self.cw_ave_factory.code_id().is_err() && wasm::sezs_wasm("cw_ave_factory").is_ok() {
                self.cw_ave_factory.upload()?;
            }
        }
        Ok(())
    }
}

impl<Chain: ZkCwEnv> SezsSuite<Chain> {
    /// Compile (or reuse a valid blob) then `upload_circuit()` via the
    /// daemon `MsgStoreCircuit` path. Persists zkid in cw-orch state.
    pub fn compile_and_upload_circuit(&mut self) -> Result<u64, CwEnvError> {
        sezs_circuit_orch::prepare_artifacts()
            .map_err(|e| CwEnvError::StdErr(e))?;
        let resp = self.circuit.upload_circuit()?;
        let zkid = resp
            .uploaded_zk_id()
            .or_else(|_| self.circuit.zk_id())
            .map_err(|e| CwEnvError::StdErr(e.to_string()))?;
        self.circuit.set_zk_id(zkid);
        self.zkid = Some(zkid);
        eprintln!("sezs-orch: uploaded sezs_consume_v2 zkid={zkid}");
        Ok(zkid)
    }
}

impl<Chain: ZkCwEnv> Deploy<Chain> for SezsSuite<Chain> {
    type Error = CwEnvError;
    type DeployData = SezsDeployData;

    fn store_on(chain: Chain) -> Result<Self, Self::Error> {
        let mut suite = Self::new(chain);
        if skip_circuit_upload() {
            eprintln!("sezs-orch: SEZS_SKIP_CIRCUIT_UPLOAD=1 — skipping circuit upload (zkid=None)");
        } else {
            suite.compile_and_upload_circuit()?;
        }
        suite.store_sezs_contracts()?;
        if !minimal_stack() {
            if suite.dao_core.code_id().is_err() && wasm::dao_wasm("dao_dao_core").is_ok() {
                suite.dao_core.upload()?;
            }
            if suite.dao_voting.code_id().is_err() && wasm::dao_wasm("dao_voting_cw4").is_ok() {
                suite.dao_voting.upload()?;
            }
            if suite.dao_proposal.code_id().is_err() && wasm::dao_wasm("dao_proposal_single").is_ok() {
                suite.dao_proposal.upload()?;
            }
            if suite.cw4_group.code_id().is_err() && wasm::dao_wasm("cw4_group").is_ok() {
                suite.cw4_group.upload()?;
            }
            if suite.dao_calendar.code_id().is_err() && wasm::dao_wasm("dao_calendar").is_ok() {
                suite.dao_calendar.upload()?;
            }
            if suite.terp_beacon.code_id().is_err() && wasm::terp_rs_wasm("terp_beacon").is_ok() {
                suite.terp_beacon.upload()?;
            }
            if suite.nftfi_raffle.code_id().is_err() && wasm::terp_rs_wasm("nftfi_raffle").is_ok() {
                suite.nftfi_raffle.upload()?;
            }
        }
        Ok(suite)
    }

    fn get_contracts_mut(&mut self) -> Vec<Box<&mut dyn ContractInstance<Chain>>> {
        vec![
            Box::new(&mut self.event),
            Box::new(&mut self.coordinators),
            Box::new(&mut self.ushers),
            Box::new(&mut self.cw_ave),
            Box::new(&mut self.cw_ave_factory),
            Box::new(&mut self.dao_core),
            Box::new(&mut self.dao_voting),
            Box::new(&mut self.dao_proposal),
            Box::new(&mut self.cw4_group),
            Box::new(&mut self.dao_calendar),
            Box::new(&mut self.terp_beacon),
            Box::new(&mut self.nftfi_raffle),
        ]
    }

    fn deploy_on(chain: Chain, mut data: Self::DeployData) -> Result<Self, Self::Error> {
        let sender = chain.sender_addr();
        let mut suite = Self::store_on(chain.clone())?;
        let curator = data
            .curator
            .clone()
            .unwrap_or_else(|| sender.to_string());
        let mut spec = data
            .spec
            .clone()
            .unwrap_or_else(|| EventSpec::from(&data.event));
        if skip_circuit_upload() {
            suite.zkid = spec.zkid;
        } else {
            let zkid = suite
                .zkid
                .ok_or_else(|| CwEnvError::StdErr("circuit zkid missing after upload".into()))?;
            data.event.zkid = Some(zkid);
            spec.zkid = Some(zkid);
        }

        suite
            .coordinators
            .instantiate(
                &JsonMsg(json!({
                    "admin": curator,
                    "members": data.coordinators.iter().map(|m| json!({"addr": m.addr, "weight": m.weight})).collect::<Vec<_>>(),
                })),
                Some(&sender),
                &[],
            )
            .map_err(into_env)?;
        suite.addresses.cw420_coordinators = Some(suite.coordinators.addr_str()?);

        suite
            .ushers
            .instantiate(
                &JsonMsg(json!({
                    "admin": curator,
                    "members": data.ushers.iter().map(|m| json!({"addr": m.addr, "weight": m.weight})).collect::<Vec<_>>(),
                })),
                Some(&sender),
                &[],
            )
            .map_err(into_env)?;
        suite.addresses.cw420_ushers = Some(suite.ushers.addr_str()?);

        if !minimal_stack() {
            if suite.cw_ave_factory.code_id().is_ok() && suite.cw_ave.code_id().is_ok() {
                match suite.cw_ave_factory.instantiate(
                    &JsonMsg(json!({
                        "owner": curator,
                        "cw_ave_id": suite.cw_ave.code_id().unwrap(),
                    })),
                    Some(&sender),
                    &[],
                ) {
                    Ok(_) => suite.addresses.cw_ave_factory = suite.cw_ave_factory.addr_str().ok(),
                    Err(e) => eprintln!("sezs-orch: cw-ave-factory instantiate skipped: {e}"),
                }
            }

            if let Err(e) = instantiate_dao(&mut suite, &curator, &sender, &data) {
                eprintln!("sezs-orch: DAO stack skipped: {e}");
            }
            if let Err(e) = instantiate_randomness(&mut suite, &curator, &sender) {
                eprintln!("sezs-orch: randomness/raffle skipped: {e}");
            }
        } else {
            suite.addresses.terp_beacon = suite.terp_beacon.addr_str().ok();
            suite.addresses.nftfi_raffle = suite.nftfi_raffle.addr_str().ok();
        }

        let meta_path = data.meta_path.clone().unwrap_or_else(|| {
            wasm::repo_root().join(format!("apps/sezs/public/{}-nip52.json", spec.id))
        });
        let (meta_uri, meta_hash) = spec
            .write_metadata_file(&meta_path)
            .map_err(|e| CwEnvError::StdErr(e.to_string()))?;

        let ev = spec.instantiate_msg(
            curator.clone(),
            suite
                .addresses
                .cw420_coordinators
                .clone()
                .ok_or_else(|| CwEnvError::StdErr("coordinators addr missing".into()))?,
            suite.addresses.cw420_ushers.clone(),
            data.service_key.clone(),
            suite.addresses.terp_beacon.clone(),
            Some(meta_uri.clone()),
            Some(meta_hash.clone()),
        );
        suite
            .event
            .instantiate(&JsonMsg(ev), Some(&sender), &[])
            .map_err(into_env)?;
        suite.addresses.cw_event_manifold = Some(suite.event.addr_str()?);

        if let Some(vk) = guest_root_vk_hex() {
            if let Err(e) = suite.event.execute(&JsonMsg(json!({ "set_guest_root_vk": { "vk": vk } })), &[]) {
                eprintln!("sezs-orch: set_guest_root_vk skipped: {e}");
            }
        }

        for msg in spec.curate_msgs(Some(meta_uri), Some(meta_hash)) {
            if let Err(e) = suite.event.execute(&JsonMsg(msg.clone()), &[]) {
                eprintln!(
                    "sezs-orch: curate {} skipped: {e}",
                    msg.as_object()
                        .and_then(|o| o.keys().next().cloned())
                        .unwrap_or_else(|| "msg".into())
                );
            }
        }
        eprintln!(
            "sezs-orch: {} curated on {} zkid={:?}",
            spec.id,
            suite.event.addr_str()?,
            suite.zkid
        );
        Ok(suite)
    }

    fn load_from(chain: Chain) -> Result<Self, Self::Error> {
        let mut suite = Self::new(chain);
        if let Ok(z) = suite.circuit.zk_id() {
            suite.zkid = Some(z);
        }
        suite.addresses.cw_event_manifold = suite.event.addr_str().ok();
        suite.addresses.cw420_coordinators = suite.coordinators.addr_str().ok();
        suite.addresses.cw420_ushers = suite.ushers.addr_str().ok();
        suite.addresses.cw_ave_factory = suite.cw_ave_factory.addr_str().ok();
        suite.addresses.dao_dao_core = suite.dao_core.addr_str().ok();
        suite.addresses.dao_calendar = suite.dao_calendar.addr_str().ok();
        suite.addresses.terp_beacon = suite.terp_beacon.addr_str().ok();
        suite.addresses.nftfi_raffle = suite.nftfi_raffle.addr_str().ok();
        Ok(suite)
    }
}


fn skip_circuit_upload() -> bool {
    std::env::var("SEZS_SKIP_CIRCUIT_UPLOAD").ok().as_deref() == Some("1")
}

fn minimal_stack() -> bool {
    std::env::var("SEZS_MINIMAL_STACK").ok().as_deref() == Some("1")
}

fn guest_root_vk_hex() -> Option<String> {
    if let Ok(v) = std::env::var("SEZS_GUEST_ROOT_VK") {
        let v = v.trim().trim_start_matches("0x").to_lowercase();
        if v.len() == 64 && v.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(v);
        }
    }
    let path = std::env::var("SEZS_SESSION_ROOT")
        .ok()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp/sezs-session-walkthrough"))
        .join("admin-frost/meta.json");
    let raw = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let s = v.get("verifyingKey")?.as_str()?.trim().trim_start_matches("0x").to_lowercase();
    (s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())).then_some(s)
}

fn into_env<E: std::fmt::Display>(e: E) -> CwEnvError {
    CwEnvError::StdErr(e.to_string())
}

fn b64(msg: &Value) -> String {
    base64::engine::general_purpose::STANDARD.encode(msg.to_string())
}

fn instantiate_dao<Chain: ZkCwEnv>(
    suite: &mut SezsSuite<Chain>,
    curator: &str,
    sender: &cosmwasm_std::Addr,
    data: &SezsDeployData,
) -> Result<(), anyhow::Error> {
    if suite.dao_core.code_id().is_err()
        || suite.dao_voting.code_id().is_err()
        || suite.dao_proposal.code_id().is_err()
        || suite.cw4_group.code_id().is_err()
    {
        anyhow::bail!("dao wasm not stored");
    }
    let voting_msg = json!({
        "group_contract": {
            "new": {
                "cw4_group_code_id": suite.cw4_group.code_id()?,
                "initial_members": data.coordinators.iter().map(|m| json!({"addr": m.addr, "weight": m.weight})).collect::<Vec<_>>(),
            }
        }
    });
    let prop_msg = json!({
        "threshold": { "threshold_quorum": { "threshold": { "majority": {} }, "quorum": { "percent": "0.20" } } },
        "max_voting_period": { "time": 604800 },
        "min_voting_period": null,
        "only_members_execute": true,
        "allow_revoting": false,
        "pre_propose_info": { "anyone_may_propose": {} },
        "close_proposal_on_execution_failure": true,
    });
    let dao_init = json!({
        "admin": curator,
        "name": "Lantern Night DAO",
        "description": "Principal admin set for Speak-Ez Sessions: Lantern Night.",
        "image_url": null,
        "automatically_add_cw20s": false,
        "automatically_add_cw721s": false,
        "voting_module_instantiate_info": {
            "code_id": suite.dao_voting.code_id()?,
            "msg": b64(&voting_msg),
            "admin": { "core_module": {} },
            "label": "lantern-voting",
        },
        "proposal_modules_instantiate_info": [{
            "code_id": suite.dao_proposal.code_id()?,
            "msg": b64(&prop_msg),
            "admin": { "core_module": {} },
            "label": "lantern-proposal",
        }],
        "initial_items": [],
        "dao_uri": null,
    });
    suite
        .dao_core
        .instantiate(&JsonMsg(dao_init), Some(&sender), &[])
        .map_err(|e| anyhow!("{e}"))?;
    suite.addresses.dao_dao_core = Some(suite.dao_core.addr_str()?);

    if suite.dao_calendar.code_id().is_ok() {
        let dao_addr = suite.dao_core.addr_str()?;
        let attempts = [
            json!({ "name": "Lantern Night Calendar", "symbol": "LNITE", "minter": dao_addr }),
            json!({ "initial_groups": null }),
        ];
        let mut ok = false;
        for msg in attempts {
            match suite
                .dao_calendar
                .instantiate(&JsonMsg(msg), Some(&sender), &[])
            {
                Ok(_) => {
                    ok = true;
                    break;
                }
                Err(e) => eprintln!("sezs-orch: dao_calendar instantiate attempt skipped: {e}"),
            }
        }
        if ok {
            suite.addresses.dao_calendar = suite.dao_calendar.addr_str().ok();
        }
    }
    Ok(())
}

fn instantiate_randomness<Chain: ZkCwEnv>(
    suite: &mut SezsSuite<Chain>,
    curator: &str,
    sender: &cosmwasm_std::Addr,
) -> Result<(), anyhow::Error> {
    if suite.terp_beacon.code_id().is_ok() {
        suite
            .terp_beacon
            .instantiate(
                &JsonMsg(terp_beacon_instantiate(curator)),
                Some(&sender),
                &[],
            )
            .map_err(|e| anyhow!("{e}"))?;
        suite.addresses.terp_beacon = Some(suite.terp_beacon.addr_str()?);
    }
    if suite.nftfi_raffle.code_id().is_ok() {
        let mut msgs = vec![json!({
            "name": "Lantern Night raffles",
            "owner": curator,
            "fee_addr": curator,
            "raffle_fee": "0",
            "randomness": { "seed": {} },
        })];
        if let Some(beacon) = &suite.addresses.terp_beacon {
            msgs.insert(
                0,
                json!({
                    "name": "Lantern Night raffles",
                    "owner": curator,
                    "fee_addr": curator,
                    "raffle_fee": "0",
                    "randomness": { "callback": { "verifier": beacon } },
                }),
            );
        }
        let mut ok = false;
        for msg in msgs {
            match suite
                .nftfi_raffle
                .instantiate(&JsonMsg(msg), Some(&sender), &[])
            {
                Ok(_) => {
                    ok = true;
                    break;
                }
                Err(e) => eprintln!("sezs-orch: nftfi-raffle instantiate attempt skipped: {e}"),
            }
        }
        if ok {
            suite.addresses.nftfi_raffle = suite.nftfi_raffle.addr_str().ok();
        }
    }
    Ok(())
}

impl<Chain: CwEnv> SezsSuite<Chain> {
    pub fn code_ids(&self) -> BTreeMap<String, u64> {
        let mut m = BTreeMap::new();
        let mut put = |k: &str, v: Result<u64, _>| {
            if let Ok(id) = v {
                m.insert(k.to_string(), id);
            }
        };
        put("cw420", self.coordinators.code_id());
        put("cw_event_manifold", self.event.code_id());
        put("cw_ave", self.cw_ave.code_id());
        put("cw_ave_factory", self.cw_ave_factory.code_id());
        put("dao_dao_core", self.dao_core.code_id());
        put("dao_voting_cw4", self.dao_voting.code_id());
        put("dao_proposal_single", self.dao_proposal.code_id());
        put("cw4_group", self.cw4_group.code_id());
        put("dao_calendar", self.dao_calendar.code_id());
        put("terp_beacon", self.terp_beacon.code_id());
        put("nftfi_raffle", self.nftfi_raffle.code_id());
        m
    }

    pub fn query_event_view(&self) -> Result<Value, CwEnvError> {
        self.event
            .query(&JsonMsg(json!({ "event_view": {} })))
            .map_err(into_env)
    }
}

// Keep Context in the crate graph for anyhow call sites.
#[allow(dead_code)]
fn _context_marker() -> anyhow::Error {
    anyhow!("x").context("y")
}
