//! Lab probe: the smallest contract that runs the v2 door checks on chain.
//! Not the event contract. cw-event-manifold calls the same `verify_consume`.

use cosmwasm_schema::cw_serde;
use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, HexBinary, MessageInfo, Response, StdError, StdResult,
};
use cw_storage_plus::{Item, Map};
use sezs_ticket_v2_verify::{verify_consume, Consent, ConsumeInput, Ctx, DoorConfig, TerpHost, ZkHost};

#[cw_serde]
pub struct Config {
    pub zkid: u64,
    pub event_id_fp: HexBinary,
    pub domain_fp: HexBinary,
    pub door_auth_pubkey: String,
    /// Optional initial root (fixture runs). Later roots come from UpdateGuestRoot.
    pub root: Option<HexBinary>,
}

#[cw_serde]
pub enum ConsentMsg {
    Live { challenge: Binary, sig: Binary },
    Printed { sig: Binary },
}

#[cw_serde]
pub enum ExecuteMsg {
    /// Publisher-only (the instantiator stands in for the principal admin FROST set).
    UpdateGuestRoot { root: HexBinary, leaf_count: u32, epoch: u32 },
    /// Full door path: proof + consent, then record N.
    Consume { proof: Binary, root: HexBinary, nullifier: HexBinary, rk_x: HexBinary, rk_y: HexBinary, consent: ConsentMsg },
    /// Proof only (gas split measurement).
    ProofOnly { proof: Binary, instances: Binary },
    /// RedPallas only (gas split measurement).
    SigOnly { message: Binary, sig: Binary, rk: HexBinary },
}

#[cw_serde]
pub enum QueryMsg {
    Config {},
    Roots {},
    Spent { nullifier: HexBinary },
}

const CONFIG: Item<Config> = Item::new("config");
const NULLIFIERS: Map<&[u8], u64> = Map::new("n");
const ROOTS: Map<&[u8], u32> = Map::new("r");
const PUBLISHER: Item<String> = Item::new("publisher");
const EPOCH: Item<u32> = Item::new("epoch");

fn a32(h: &HexBinary, what: &str) -> StdResult<[u8; 32]> {
    h.as_slice().try_into().map_err(|_| StdError::generic_err(format!("{what} must be 32 bytes")))
}

#[entry_point]
pub fn instantiate(deps: DepsMut, _env: Env, info: MessageInfo, msg: Config) -> StdResult<Response> {
    if let Some(r) = &msg.root {
        ROOTS.save(deps.storage, r.as_slice(), &0)?;
    }
    PUBLISHER.save(deps.storage, &info.sender.to_string())?;
    EPOCH.save(deps.storage, &0)?;
    CONFIG.save(deps.storage, &msg)?;
    Ok(Response::new())
}

#[entry_point]
pub fn execute(deps: DepsMut, env: Env, info: MessageInfo, msg: ExecuteMsg) -> StdResult<Response> {
    match msg {
        ExecuteMsg::UpdateGuestRoot { root, leaf_count, epoch } => {
            if info.sender.as_str() != PUBLISHER.load(deps.storage)? {
                return Err(StdError::generic_err("only the root publisher"));
            }
            a32(&root, "root")?;
            if epoch <= EPOCH.load(deps.storage)? {
                return Err(StdError::generic_err("epoch not monotonic"));
            }
            EPOCH.save(deps.storage, &epoch)?;
            ROOTS.save(deps.storage, root.as_slice(), &epoch)?;
            Ok(Response::new()
                .add_attribute("action", "update_guest_root")
                .add_attribute("root", root.to_hex())
                .add_attribute("leaf_count", leaf_count.to_string())
                .add_attribute("epoch", epoch.to_string()))
        }
        ExecuteMsg::Consume { proof, root, nullifier, rk_x, rk_y, consent } => {
            let c = CONFIG.load(deps.storage)?;
            if !ROOTS.has(deps.storage, root.as_slice()) {
                return Err(StdError::generic_err("unknown root"));
            }
            let n = a32(&nullifier, "nullifier")?;
            if NULLIFIERS.has(deps.storage, &n) {
                return Err(StdError::generic_err("ticket already used"));
            }
            let cfg = DoorConfig {
                zkid: c.zkid,
                event_id_fp: a32(&c.event_id_fp, "event_id_fp")?,
                domain_fp: a32(&c.domain_fp, "domain_fp")?,
                door_auth_pubkey: c.door_auth_pubkey.as_bytes(),
                challenge_ttl_s: sezs_ticket_v2_verify::DEFAULT_CHALLENGE_TTL_S,
            };
            let consent = match &consent {
                ConsentMsg::Live { challenge, sig } => Consent::Live { challenge: challenge.as_slice(), sig: sig.as_slice() },
                ConsentMsg::Printed { sig } => Consent::Printed { sig: sig.as_slice() },
            };
            let input = ConsumeInput {
                proof: proof.as_slice(),
                root: a32(&root, "root")?,
                nullifier: n,
                rk_x: a32(&rk_x, "rk_x")?,
                rk_y: a32(&rk_y, "rk_y")?,
                consent,
            };
            let v = verify_consume(&TerpHost, &cfg, &input, Ctx { sender: info.sender.as_str(), now_s: env.block.time.seconds() })
                .map_err(|e| StdError::generic_err(e.to_string()))?;
            NULLIFIERS.save(deps.storage, &n, &env.block.height)?;
            Ok(Response::new()
                .add_attribute("action", "ticket_consumed")
                .add_attribute("nullifier", nullifier.to_hex())
                .add_attribute("consent", if v.live { "live" } else { "printed" }))
        }
        ExecuteMsg::ProofOnly { proof, instances } => {
            let c = CONFIG.load(deps.storage)?;
            let ok = TerpHost.proof_instance_verify(c.zkid, proof.as_slice(), instances.as_slice()).map_err(StdError::generic_err)?;
            Ok(Response::new().add_attribute("action", "proof_only").add_attribute("valid", ok.to_string()))
        }
        ExecuteMsg::SigOnly { message, sig, rk } => {
            let ok = TerpHost.redpallas_spendauth_verify(message.as_slice(), sig.as_slice(), rk.as_slice()).map_err(StdError::generic_err)?;
            Ok(Response::new().add_attribute("action", "sig_only").add_attribute("valid", ok.to_string()))
        }
    }
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&CONFIG.load(deps.storage)?),
        QueryMsg::Roots {} => to_json_binary(
            &ROOTS
                .range(deps.storage, None, None, cosmwasm_std::Order::Ascending)
                .map(|r| r.map(|(k, e)| (HexBinary::from(k), e)))
                .collect::<StdResult<Vec<_>>>()?,
        ),
        QueryMsg::Spent { nullifier } => to_json_binary(&NULLIFIERS.may_load(deps.storage, nullifier.as_slice())?),
    }
}
