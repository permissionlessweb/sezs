use cosmwasm_std::{
    to_json_binary, Binary, Deps, DepsMut, Env, HexBinary, MessageInfo, Order, Response, StdResult,
    WasmQuery,
};
#[cfg(not(feature = "library"))]
use cosmwasm_std::entry_point;
use cw2::set_contract_version;
use cw_storage_plus::Bound;

use crate::error::ContractError;
use crate::frost_root::{verify_guest_root_sig};
use crate::msg::{
    ApiVersionResponse, ConsumeConfigResponse, EventInfoResponse, EventView, ExecuteMsg, FaqResponse,
    GroupQuery, InstantiateMsg, LineupResponse, MemberListResponse, MemberResponse,
    NullifierSpentResponse, PaidLeavesResponse, QueryMsg, RafflesResponse, RolesResponse,
    RootsResponse, SponsorsResponse, TiersResponse, TimelineResponse, VenueView,
    WinningLeafResponse,
};
use crate::state::{
    page_limit, paid_count, valid_kind, Config, NullifierRecord, RaffleStatus,
    RootRecord, API_VERSION, CONFIG, FAQ, KIND_TIME_BASED, LINEUP, NULLIFIERS, PAID_LEAVES,
    PAID_NEXT, RAFFLES, ROOTS, SCHEMA, SPONSORS, TIERS, TIMELINE,
};
use crate::verify::{require_canonical_root, verify_ticket_proof, ConsumePublicInputs};

const CONTRACT_NAME: &str = "crates.io:cw-event-manifold";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

fn normalize_origin(raw: &str) -> Result<String, ContractError> {
    let s = raw.trim();
    let lower = s.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(ContractError::InvalidDomain);
    }
    if s.chars().any(|c| c.is_whitespace()) || s.contains('?') || s.contains('#') || s.contains('@') {
        return Err(ContractError::InvalidDomain);
    }
    let rest = if lower.starts_with("https://") {
        &s["https://".len()..]
    } else {
        &s["http://".len()..]
    };
    let hostport = rest.strip_suffix('/').unwrap_or(rest);
    if hostport.is_empty() || hostport.contains('/') {
        return Err(ContractError::InvalidDomain);
    }
    let scheme = if lower.starts_with("https://") { "https" } else { "http" };
    Ok(format!("{scheme}://{hostport}"))
}

fn door_auth_of(raw: Option<HexBinary>) -> Result<HexBinary, ContractError> {
    let bytes = raw.unwrap_or_default();
    if bytes.is_empty() {
        return Ok(bytes);
    }
    if bytes.len() != 32 {
        return Err(ContractError::BadPubkey);
    }
    Ok(bytes)
}

const HIDDEN_VENUE: &str = "Location is shared with ticket holders.";

fn is_coordinator(deps: Deps, addr: &cosmwasm_std::Addr) -> Result<bool, ContractError> {
    let cfg = CONFIG.load(deps.storage)?;
    if addr == cfg.curator {
        return Ok(true);
    }
    let q = GroupQuery::Member {
        addr: addr.to_string(),
        at_height: None,
    };
    let res: MemberResponse = deps.querier.query(&WasmQuery::Smart {
        contract_addr: cfg.coordinators.to_string(),
        msg: to_json_binary(&q)?,
    }.into())?;
    Ok(res.weight.unwrap_or(0) > 0)
}

fn must_write(deps: Deps, sender: &cosmwasm_std::Addr) -> Result<(), ContractError> {
    if is_coordinator(deps, sender)? {
        Ok(())
    } else {
        Err(ContractError::Unauthorized)
    }
}

fn must_curator(deps: Deps, sender: &cosmwasm_std::Addr) -> Result<(), ContractError> {
    let cfg = CONFIG.load(deps.storage)?;
    if sender == cfg.curator {
        Ok(())
    } else {
        Err(ContractError::Unauthorized)
    }
}

fn list_group(deps: Deps, addr: &cosmwasm_std::Addr) -> MemberListResponse {
    deps.querier
        .query(
            &WasmQuery::Smart {
                contract_addr: addr.to_string(),
                msg: to_json_binary(&GroupQuery::ListMembers {
                    start_after: None,
                    limit: Some(100),
                })
                .unwrap_or_default(),
            }
            .into(),
        )
        .unwrap_or(MemberListResponse { members: vec![] })
}

fn is_group_member(
    deps: Deps,
    group: &cosmwasm_std::Addr,
    addr: &cosmwasm_std::Addr,
) -> Result<bool, ContractError> {
    let q = GroupQuery::Member {
        addr: addr.to_string(),
        at_height: None,
    };
    let res: MemberResponse = deps.querier.query(
        &WasmQuery::Smart {
            contract_addr: group.to_string(),
            msg: to_json_binary(&q)?,
        }
        .into(),
    )?;
    Ok(res.weight.unwrap_or(0) > 0)
}

fn must_service_key(deps: Deps, sender: &cosmwasm_std::Addr) -> Result<(), ContractError> {
    let cfg = CONFIG.load(deps.storage)?;
    match cfg.service_key {
        Some(key) if sender == key => Ok(()),
        Some(_) => Err(ContractError::Unauthorized),
        None => Err(ContractError::NoServiceKey),
    }
}

fn must_usher(deps: Deps, sender: &cosmwasm_std::Addr) -> Result<(), ContractError> {
    let cfg = CONFIG.load(deps.storage)?;
    let group = cfg.usher_group.ok_or(ContractError::NoUsherGroup)?;
    if is_group_member(deps, &group, sender)? {
        Ok(())
    } else {
        Err(ContractError::Unauthorized)
    }
}

fn require_sale_rails(tier: &crate::state::TicketTier) -> Result<(), ContractError> {
    if tier.rails.iter().any(|r| !r.allowed_for_sale()) {
        return Err(ContractError::ForbiddenRail);
    }
    if tier
        .discounts_bps
        .iter()
        .any(|(r, _)| !r.allowed_for_sale())
    {
        return Err(ContractError::ForbiddenRail);
    }
    Ok(())
}

fn require_hash32(value: &HexBinary) -> Result<(), ContractError> {
    if value.is_empty() {
        return Ok(());
    }
    if value.len() != 32 {
        return Err(ContractError::BadMetadataHash);
    }
    Ok(())
}

fn collect_map<T: Clone + serde::de::DeserializeOwned + serde::Serialize>(
    deps: Deps,
    map: &cw_storage_plus::Map<&str, T>,
) -> StdResult<Vec<T>> {
    map.range(deps.storage, None, None, Order::Ascending)
        .map(|r| r.map(|(_, v)| v))
        .collect()
}

fn hidden_venue() -> VenueView {
    VenueView {
        api: API_VERSION,
        revealed: false,
        label: None,
        note: HIDDEN_VENUE.into(),
    }
}

fn event_info_of(cfg: &Config) -> EventInfoResponse {
    EventInfoResponse {
        api: API_VERSION,
        schema: SCHEMA.into(),
        id: cfg.id.clone(),
        cw_ave: cfg.cw_ave.clone(),
        name: cfg.name.clone(),
        status: cfg.status.clone(),
        start: cfg.start,
        end: cfg.end,
        timezone: cfg.timezone.clone(),
        domain: cfg.domain.clone(),
        door_auth_pubkey: cfg.door_auth_pubkey.clone(),
        kind: cfg.kind,
        d_tag: cfg.d_tag.clone(),
        summary: cfg.summary.clone(),
        content: cfg.content.clone(),
        location: cfg.location.clone(),
        geohash: cfg.geohash.clone(),
        image: cfg.image.clone(),
        tags: cfg.tags.clone(),
        metadata_uri: cfg.metadata_uri.clone(),
        metadata_hash: cfg.metadata_hash.clone(),
    }
}

fn consume_config_of(cfg: &Config) -> ConsumeConfigResponse {
    ConsumeConfigResponse {
        api: API_VERSION,
        schema: SCHEMA.into(),
        zkid: cfg.zkid,
        event_id_fp: cfg.event_id_fp.clone(),
        domain: cfg.domain.clone(),
        domain_fp: cfg.domain_fp.clone(),
        guest_root: cfg.guest_root.clone(),
        epoch: cfg.epoch,
        leaf_count: cfg.leaf_count,
        service_key: cfg.service_key.as_ref().map(|a| a.to_string()),
        usher_group: cfg.usher_group.as_ref().map(|a| a.to_string()),
        door_auth_pubkey: cfg.door_auth_pubkey.clone(),
        verifier: "zk-wasmvm".into(),
    }
}

fn roles_of(deps: Deps, cfg: &Config) -> RolesResponse {
    let coordinators = list_group(deps, &cfg.coordinators)
        .members
        .into_iter()
        .map(|m| m.addr)
        .collect();
    let ushers = match &cfg.usher_group {
        Some(g) => list_group(deps, g)
            .members
            .into_iter()
            .map(|m| m.addr)
            .collect(),
        None => vec![],
    };
    RolesResponse {
        api: API_VERSION,
        curators: vec![cfg.curator.to_string()],
        coordinators,
        coordinators_group: cfg.coordinators.to_string(),
        ushers,
        usher_group: cfg.usher_group.as_ref().map(|a| a.to_string()),
        service_key: cfg.service_key.as_ref().map(|a| a.to_string()),
    }
}

fn roots_of(deps: Deps) -> StdResult<Vec<RootRecord>> {
    let mut items: Vec<RootRecord> = ROOTS
        .range(deps.storage, None, None, Order::Ascending)
        .map(|r| r.map(|(_, v)| v))
        .collect::<StdResult<_>>()?;
    items.sort_by_key(|r| r.epoch);
    Ok(items)
}

fn event_view(deps: Deps) -> StdResult<EventView> {
    let cfg = CONFIG.load(deps.storage)?;
    Ok(EventView {
        api: API_VERSION,
        schema: SCHEMA.into(),
        event: event_info_of(&cfg),
        venue: hidden_venue(),
        lineup: collect_map(deps, &LINEUP)?,
        timeline: collect_map(deps, &TIMELINE)?,
        sponsors: collect_map(deps, &SPONSORS)?,
        tiers: collect_map(deps, &TIERS)?,
        raffles: collect_map(deps, &RAFFLES)?,
        faq: collect_map(deps, &FAQ)?,
        roles: roles_of(deps, &cfg),
        consume: consume_config_of(&cfg),
        roots: roots_of(deps)?,
    })
}


#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    let curator = match msg.curator {
        Some(s) => deps.api.addr_validate(&s)?,
        None => info.sender,
    };
    let coordinators = deps.api.addr_validate(&msg.coordinators)?;
    let cw_ave = msg.cw_ave.map(|s| deps.api.addr_validate(&s)).transpose()?;
    let randomness = msg
        .randomness
        .map(|s| deps.api.addr_validate(&s))
        .transpose()?;
    let kind = msg.kind.unwrap_or(KIND_TIME_BASED);
    if !valid_kind(kind) {
        return Err(ContractError::BadKind);
    }
    let id: String = if msg.id.is_empty() { "event".into() } else { msg.id.clone() };
    CONFIG.save(
        deps.storage,
        &Config {
            curator: curator.clone(),
            cw_ave,
            coordinators: coordinators.clone(),
            randomness,
            id: id.clone(),
            name: msg.name,
            status: msg.status,
            start: msg.start,
            end: msg.end,
            timezone: msg.timezone,
            venue_label: msg.venue_label.unwrap_or_default(),
            domain: normalize_origin(&msg.domain)?,
            door_auth_pubkey: door_auth_of(msg.door_auth_pubkey)?,
            kind,
            d_tag: msg.d_tag.unwrap_or_else(|| id.clone()),
            summary: msg.summary.unwrap_or_default(),
            content: msg.content.unwrap_or_default(),
            location: msg.location.unwrap_or_default(),
            geohash: msg.geohash.unwrap_or_default(),
            image: msg.image.unwrap_or_default(),
            tags: msg.tags.unwrap_or_default(),
            metadata_uri: msg.metadata_uri.unwrap_or_default(),
            metadata_hash: {
                let h = msg.metadata_hash.unwrap_or_default();
                require_hash32(&h).map(|_| h)?
            },
            service_key: msg
                .service_key
                .map(|s| deps.api.addr_validate(&s))
                .transpose()?,
            usher_group: msg
                .usher_group
                .map(|s| deps.api.addr_validate(&s))
                .transpose()?,
            zkid: msg.zkid.unwrap_or(0),
            event_id_fp: msg.event_id_fp.unwrap_or_default(),
            domain_fp: msg.domain_fp.unwrap_or_default(),
            guest_root: HexBinary::from([0u8; 32]),
            leaf_count: 0,
            epoch: 0,
            guest_root_vk: match msg.guest_root_vk {
                Some(vk) if vk.len() == 32 => Some(vk),
                Some(_) => return Err(ContractError::BadFrostSignature),
                None => None,
            },
        },
    )?;
    PAID_NEXT.save(deps.storage, &0)?;
    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("api", API_VERSION.to_string())
        .add_attribute("curator", curator)
        .add_attribute("coordinators", coordinators))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::UpdateEventInfo {
            id,
            name,
            status,
            start,
            end,
            timezone,
            summary,
            content,
        } => {
            must_curator(deps.as_ref(), &info.sender)?;
            CONFIG.update(deps.storage, |mut c| -> Result<_, ContractError> {
                if let Some(v) = id {
                    c.id = v;
                }
                if let Some(v) = name {
                    c.name = v;
                }
                if let Some(v) = status {
                    c.status = v;
                }
                if let Some(v) = start {
                    c.start = v;
                }
                if let Some(v) = end {
                    c.end = v;
                }
                if let Some(v) = timezone {
                    c.timezone = v;
                }
                if let Some(v) = summary {
                    c.summary = v;
                }
                if let Some(v) = content {
                    c.content = v;
                }
                Ok(c)
            })?;
            Ok(Response::new().add_attribute("action", "update_event_info"))
        }
        ExecuteMsg::SetVenue { label } => {
            must_curator(deps.as_ref(), &info.sender)?;
            CONFIG.update(deps.storage, |mut c| -> Result<_, ContractError> {
                c.venue_label = label;
                Ok(c)
            })?;
            Ok(Response::new().add_attribute("action", "set_venue"))
        }
        ExecuteMsg::SetCwAve { addr } => {
            must_curator(deps.as_ref(), &info.sender)?;
            CONFIG.update(deps.storage, |mut c| -> Result<_, ContractError> {
                c.cw_ave = addr.map(|s| deps.api.addr_validate(&s)).transpose()?;
                Ok(c)
            })?;
            Ok(Response::new().add_attribute("action", "set_cw_ave"))
        }
        ExecuteMsg::SetCoordinators { addr } => {
            must_curator(deps.as_ref(), &info.sender)?;
            let a = deps.api.addr_validate(&addr)?;
            CONFIG.update(deps.storage, |mut c| -> Result<_, ContractError> {
                c.coordinators = a;
                Ok(c)
            })?;
            Ok(Response::new().add_attribute("action", "set_coordinators"))
        }
        ExecuteMsg::SetRandomness { addr } => {
            must_curator(deps.as_ref(), &info.sender)?;
            CONFIG.update(deps.storage, |mut c| -> Result<_, ContractError> {
                c.randomness = addr.map(|s| deps.api.addr_validate(&s)).transpose()?;
                Ok(c)
            })?;
            Ok(Response::new().add_attribute("action", "set_randomness"))
        }
        ExecuteMsg::SetDomain {
            domain,
            door_auth_pubkey,
        } => {
            must_write(deps.as_ref(), &info.sender)?;
            let origin = normalize_origin(&domain)?;
            let pk = door_auth_of(door_auth_pubkey)?;
            CONFIG.update(deps.storage, |mut c| -> Result<_, ContractError> {
                c.domain = origin;
                if !pk.is_empty() {
                    c.door_auth_pubkey = pk;
                }
                Ok(c)
            })?;
            Ok(Response::new().add_attribute("action", "set_domain"))
        }
        ExecuteMsg::UpsertLineupSlot { slot } => {
            must_write(deps.as_ref(), &info.sender)?;
            LINEUP.save(deps.storage, &slot.id.clone(), &slot)?;
            Ok(Response::new().add_attribute("action", "upsert_lineup"))
        }
        ExecuteMsg::RemoveLineupSlot { id } => {
            must_write(deps.as_ref(), &info.sender)?;
            LINEUP.remove(deps.storage, &id);
            Ok(Response::new().add_attribute("action", "remove_lineup"))
        }
        ExecuteMsg::UpsertTimelineItem { item } => {
            must_write(deps.as_ref(), &info.sender)?;
            TIMELINE.save(deps.storage, &item.id.clone(), &item)?;
            Ok(Response::new().add_attribute("action", "upsert_timeline"))
        }
        ExecuteMsg::RemoveTimelineItem { id } => {
            must_write(deps.as_ref(), &info.sender)?;
            TIMELINE.remove(deps.storage, &id);
            Ok(Response::new().add_attribute("action", "remove_timeline"))
        }
        ExecuteMsg::UpsertSponsor { sponsor } => {
            must_write(deps.as_ref(), &info.sender)?;
            SPONSORS.save(deps.storage, &sponsor.id.clone(), &sponsor)?;
            Ok(Response::new().add_attribute("action", "upsert_sponsor"))
        }
        ExecuteMsg::RemoveSponsor { id } => {
            must_write(deps.as_ref(), &info.sender)?;
            SPONSORS.remove(deps.storage, &id);
            Ok(Response::new().add_attribute("action", "remove_sponsor"))
        }
        ExecuteMsg::UpsertTier { tier } => {
            must_curator(deps.as_ref(), &info.sender)?;
            require_sale_rails(&tier)?;
            TIERS.save(deps.storage, &tier.id.clone(), &tier)?;
            Ok(Response::new().add_attribute("action", "upsert_tier"))
        }
        ExecuteMsg::RemoveTier { id } => {
            must_curator(deps.as_ref(), &info.sender)?;
            TIERS.remove(deps.storage, &id);
            Ok(Response::new().add_attribute("action", "remove_tier"))
        }
        ExecuteMsg::RecordSale { tier_id, count } => {
            must_curator(deps.as_ref(), &info.sender)?;
            TIERS.update(deps.storage, &tier_id, |t| match t {
                Some(mut tier) => {
                    tier.sold = tier.sold.saturating_add(count);
                    Ok(tier)
                }
                None => Err(ContractError::UnknownId),
            })?;
            Ok(Response::new().add_attribute("action", "record_sale"))
        }
        ExecuteMsg::RegisterPaidLeaf { commitment } => {
            must_curator(deps.as_ref(), &info.sender)?;
            if commitment.len() != 32 {
                return Err(ContractError::BadLeaf);
            }
            let exists = PAID_LEAVES
                .range(deps.storage, None, None, Order::Ascending)
                .any(|r| r.map(|(_, c)| c == commitment).unwrap_or(false));
            if exists {
                return Err(ContractError::LeafExists);
            }
            let idx = paid_count(deps.storage);
            PAID_LEAVES.save(deps.storage, idx, &commitment)?;
            PAID_NEXT.save(deps.storage, &(idx + 1))?;
            Ok(Response::new()
                .add_attribute("action", "register_paid_leaf")
                .add_attribute("index", idx.to_string()))
        }
        ExecuteMsg::RegisterRafflePrize { prize } => {
            must_write(deps.as_ref(), &info.sender)?;
            RAFFLES.save(deps.storage, &prize.id.clone(), &prize)?;
            Ok(Response::new().add_attribute("action", "register_raffle"))
        }
        ExecuteMsg::CloseRaffle { id } => {
            must_write(deps.as_ref(), &info.sender)?;
            let entries = paid_count(deps.storage);
            RAFFLES.update(deps.storage, &id, |p| match p {
                Some(mut prize) => {
                    prize.entries = entries;
                    prize.status = RaffleStatus::Closed;
                    Ok(prize)
                }
                None => Err(ContractError::UnknownId),
            })?;
            Ok(Response::new().add_attribute("action", "close_raffle"))
        }
        ExecuteMsg::RequestDraw { id } => {
            must_write(deps.as_ref(), &info.sender)?;
            let cfg = CONFIG.load(deps.storage)?;
            let oracle = cfg.randomness.ok_or(ContractError::NoOracle)?;
            let entries = paid_count(deps.storage);
            RAFFLES.update(deps.storage, &id, |p| match p {
                Some(mut prize) => {
                    if matches!(prize.status, RaffleStatus::Drawn) || prize.draw.is_some() {
                        return Err(ContractError::DrawBusy);
                    }
                    prize.entries = entries;
                    if prize.entries == 0 {
                        return Err(ContractError::NotDrawable);
                    }
                    prize.status = RaffleStatus::Closed;
                    prize.draw = Some(crate::state::RaffleDraw {
                        job_id: format!("{}/{}/0", _env.contract.address, id),
                        winner_index: None,
                        proof_href: None,
                        oracle: oracle.to_string(),
                        randomness: None,
                    });
                    Ok(prize)
                }
                None => Err(ContractError::UnknownId),
            })?;
            Ok(Response::new()
                .add_attribute("action", "request_draw")
                .add_attribute("oracle", oracle)
                .add_attribute("pending", "true"))
        }
        ExecuteMsg::RandomnessReceive { job_id, randomness } => {
            let cfg = CONFIG.load(deps.storage)?;
            let oracle = cfg.randomness.ok_or(ContractError::NoOracle)?;
            if info.sender != oracle {
                return Err(ContractError::Unauthorized);
            }
            let mut found = None;
            let keys: Vec<String> = RAFFLES
                .range(deps.storage, None, None, Order::Ascending)
                .map(|r| r.map(|(k, _)| k).unwrap())
                .collect();
            for k in keys {
                let mut prize = RAFFLES.load(deps.storage, &k)?;
                if prize
                    .draw
                    .as_ref()
                    .map(|d| d.job_id == job_id && d.winner_index.is_none())
                    .unwrap_or(false)
                {
                    let entries = prize.entries.max(1);
                    let idx = int_in_range(&randomness, entries);
                    if let Some(d) = prize.draw.as_mut() {
                        d.winner_index = Some(idx);
                        d.randomness = Some(hex_of(&randomness));
                    }
                    prize.status = RaffleStatus::Drawn;
                    RAFFLES.save(deps.storage, &k, &prize)?;
                    found = Some((k, idx));
                    break;
                }
            }
            let (id, idx) = found.ok_or(ContractError::UnknownId)?;
            Ok(Response::new()
                .add_attribute("action", "randomness_receive")
                .add_attribute("id", id)
                .add_attribute("winner_index", idx.to_string()))
        }
        ExecuteMsg::SetNip52 { body } => {
            must_write(deps.as_ref(), &info.sender)?;
            if !valid_kind(body.kind) {
                return Err(ContractError::BadKind);
            }
            CONFIG.update(deps.storage, |mut c| -> Result<_, ContractError> {
                c.kind = body.kind;
                c.d_tag = body.d_tag;
                c.name = body.title;
                c.summary = body.summary;
                c.content = body.content;
                c.start = body.start;
                c.end = body.end;
                c.timezone = body.timezone;
                c.location = body.location;
                c.geohash = body.geohash.unwrap_or_default();
                c.image = body.image.unwrap_or_default();
                c.tags = body.tags;
                Ok(c)
            })?;
            Ok(Response::new().add_attribute("action", "set_nip52"))
        }
        ExecuteMsg::SetMetadata { uri, content_hash } => {
            must_write(deps.as_ref(), &info.sender)?;
            let hash = content_hash.unwrap_or_default();
            require_hash32(&hash)?;
            CONFIG.update(deps.storage, |mut c| -> Result<_, ContractError> {
                c.metadata_uri = uri;
                c.metadata_hash = hash;
                Ok(c)
            })?;
            Ok(Response::new().add_attribute("action", "set_metadata"))
        }
        ExecuteMsg::SetServiceKey { addr } => {
            must_write(deps.as_ref(), &info.sender)?;
            CONFIG.update(deps.storage, |mut c| -> Result<_, ContractError> {
                c.service_key = addr.map(|s| deps.api.addr_validate(&s)).transpose()?;
                Ok(c)
            })?;
            Ok(Response::new().add_attribute("action", "set_service_key"))
        }
        ExecuteMsg::SetUsherGroup { addr } => {
            must_write(deps.as_ref(), &info.sender)?;
            CONFIG.update(deps.storage, |mut c| -> Result<_, ContractError> {
                c.usher_group = addr.map(|s| deps.api.addr_validate(&s)).transpose()?;
                Ok(c)
            })?;
            Ok(Response::new().add_attribute("action", "set_usher_group"))
        }
        ExecuteMsg::SetZkid {
            zkid,
            event_id_fp,
            domain_fp,
        } => {
            must_write(deps.as_ref(), &info.sender)?;
            if let Some(ref fp) = event_id_fp {
                if fp.len() != 32 {
                    return Err(ContractError::BadPublicInput);
                }
            }
            if let Some(ref fp) = domain_fp {
                if fp.len() != 32 {
                    return Err(ContractError::BadPublicInput);
                }
            }
            CONFIG.update(deps.storage, |mut c| -> Result<_, ContractError> {
                c.zkid = zkid;
                if let Some(fp) = event_id_fp {
                    c.event_id_fp = fp;
                }
                if let Some(fp) = domain_fp {
                    c.domain_fp = fp;
                }
                Ok(c)
            })?;
            Ok(Response::new().add_attribute("action", "set_zkid"))
        }
        ExecuteMsg::SetGuestRootVk { vk } => {
            must_write(deps.as_ref(), &info.sender)?;
            if vk.len() != 32 {
                return Err(ContractError::BadFrostSignature);
            }
            CONFIG.update(deps.storage, |mut c| -> Result<_, ContractError> {
                c.guest_root_vk = Some(vk);
                Ok(c)
            })?;
            Ok(Response::new().add_attribute("action", "set_guest_root_vk"))
        }
        ExecuteMsg::UpdateGuestRoot {
            root,
            leaf_count,
            epoch,
            frost_signature,
        } => {
            require_canonical_root(&root)?;
            let cfg = CONFIG.load(deps.storage)?;
            verify_guest_root_sig(
                &_env.contract.address,
                epoch,
                leaf_count,
                &root,
                &cfg.guest_root_vk,
                &frost_signature,
            )?;
            if epoch <= cfg.epoch {
                return Err(ContractError::EpochNotMonotonic);
            }
            if leaf_count < cfg.leaf_count {
                return Err(ContractError::LeafCountDecreased);
            }
            let rec = RootRecord {
                root: root.clone(),
                epoch,
                leaf_count,
                time: _env.block.time,
            };
            ROOTS.save(deps.storage, root.as_slice(), &rec)?;
            CONFIG.update(deps.storage, |mut c| -> Result<_, ContractError> {
                c.guest_root = root.clone();
                c.leaf_count = leaf_count;
                c.epoch = epoch;
                Ok(c)
            })?;
            Ok(Response::new()
                .add_attribute("action", "update_guest_root")
                .add_attribute("epoch", epoch.to_string())
                .add_attribute("leaf_count", leaf_count.to_string()))
        }
        ExecuteMsg::ConsumeTicket {
            proof,
            root,
            nullifier,
            event_id,
            domain,
            rk_x,
            rk_y,
            consent,
        } => {
            must_usher(deps.as_ref(), &info.sender)?;
            let cfg = CONFIG.load(deps.storage)?;
            if ROOTS.may_load(deps.storage, root.as_slice())?.is_none() {
                return Err(ContractError::UnknownRoot);
            }
            if NULLIFIERS
                .may_load(deps.storage, nullifier.as_slice())?
                .is_some()
            {
                return Err(ContractError::NullifierSpent);
            }
            let inputs = ConsumePublicInputs {
                root: root.clone(),
                nullifier: nullifier.clone(),
                event_id,
                domain,
                rk_x,
                rk_y,
            };
            verify_ticket_proof(&_env, &info, &cfg, &proof, &inputs, &consent)?;
            NULLIFIERS.save(
                deps.storage,
                nullifier.as_slice(),
                &NullifierRecord {
                    height: _env.block.height,
                    time: _env.block.time,
                },
            )?;
            Ok(Response::new()
                .add_attribute("action", "consume_ticket")
                .add_attribute("nullifier_spent", "true"))
        }
        ExecuteMsg::UpsertFaq { item } => {
            must_write(deps.as_ref(), &info.sender)?;
            let id = item.id.clone();
            FAQ.save(deps.storage, &id, &item)?;
            Ok(Response::new().add_attribute("action", "upsert_faq"))
        }
        ExecuteMsg::RemoveFaq { id } => {
            must_write(deps.as_ref(), &info.sender)?;
            FAQ.remove(deps.storage, &id);
            Ok(Response::new().add_attribute("action", "remove_faq"))
        }
        ExecuteMsg::ClaimPrize { .. } => Err(ContractError::KnowledgeProofPending),

    }
}

fn int_in_range(randomness: &Binary, entries: u32) -> u32 {
    let mut acc = 0u64;
    for (i, b) in randomness.as_slice().iter().take(8).enumerate() {
        acc |= (*b as u64) << (8 * i);
    }
    if entries == 0 {
        0
    } else {
        (acc % entries as u64) as u32
    }
}

fn hex_of(b: &Binary) -> String {
    b.as_slice().iter().map(|x| format!("{x:02x}")).collect()
}

fn page_map<'a, T: Clone + serde::de::DeserializeOwned + serde::Serialize>(
    deps: Deps,
    map: &cw_storage_plus::Map<&str, T>,
    start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<(Vec<T>, u32)> {
    let cap = page_limit(limit);
    let total = map
        .range(deps.storage, None, None, Order::Ascending)
        .count() as u32;
    let min = start_after
        .as_ref()
        .map(|s| Bound::exclusive(s.as_str()));
    let items = map
        .range(deps.storage, min, None, Order::Ascending)
        .take(cap as usize)
        .map(|r| r.map(|(_, v)| v))
        .collect::<StdResult<Vec<_>>>()?;
    Ok((items, total))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::ApiVersion {} => {
            let cfg = CONFIG.load(deps.storage)?;
            to_json_binary(&ApiVersionResponse {
                api: API_VERSION,
                schema: SCHEMA.into(),
                cw_ave: cfg.cw_ave,
            })
        }
        QueryMsg::EventView {} => to_json_binary(&event_view(deps)?),
        QueryMsg::EventInfo {} => {
            let cfg = CONFIG.load(deps.storage)?;
            to_json_binary(&event_info_of(&cfg))
        }
        QueryMsg::Venue {} => to_json_binary(&hidden_venue()),
        QueryMsg::VenueForHolder { .. } => {
            // Proof wiring lands with the door. Never leak the label on a bare query.
            to_json_binary(&hidden_venue())
        }
        QueryMsg::Lineup { start_after, limit } => {
            let (items, total) = page_map(deps, &LINEUP, start_after, limit)?;
            to_json_binary(&LineupResponse {
                api: API_VERSION,
                items,
                total,
            })
        }
        QueryMsg::Timeline { start_after, limit } => {
            let (items, total) = page_map(deps, &TIMELINE, start_after, limit)?;
            to_json_binary(&TimelineResponse {
                api: API_VERSION,
                items,
                total,
            })
        }
        QueryMsg::Sponsors { start_after, limit } => {
            let (items, total) = page_map(deps, &SPONSORS, start_after, limit)?;
            to_json_binary(&SponsorsResponse {
                api: API_VERSION,
                items,
                total,
            })
        }
        QueryMsg::Tiers {} => {
            let items: Vec<_> = TIERS
                .range(deps.storage, None, None, Order::Ascending)
                .map(|r| r.map(|(_, v)| v))
                .collect::<StdResult<_>>()?;
            to_json_binary(&TiersResponse {
                api: API_VERSION,
                items,
            })
        }
        QueryMsg::Raffles { start_after, limit } => {
            let (items, total) = page_map(deps, &RAFFLES, start_after, limit)?;
            to_json_binary(&RafflesResponse {
                api: API_VERSION,
                items,
                total,
            })
        }
        QueryMsg::Raffle { id } => to_json_binary(&RAFFLES.load(deps.storage, &id)?),
        QueryMsg::PaidLeaves { start_after, limit } => {
            let cap = page_limit(limit);
            let total = paid_count(deps.storage);
            let start = start_after.map(|x| x.saturating_add(1)).unwrap_or(0);
            let mut items = vec![];
            let mut i = start;
            while i < total && (items.len() as u32) < cap {
                if let Some(c) = PAID_LEAVES.may_load(deps.storage, i)? {
                    items.push(c);
                }
                i += 1;
            }
            to_json_binary(&PaidLeavesResponse {
                api: API_VERSION,
                items,
                total,
            })
        }
        QueryMsg::WinningLeaf { id } => {
            let prize = RAFFLES.load(deps.storage, &id)?;
            let winner_index = prize.draw.and_then(|d| d.winner_index);
            let commitment = match winner_index {
                Some(i) => PAID_LEAVES.may_load(deps.storage, i)?,
                None => None,
            };
            to_json_binary(&WinningLeafResponse {
                api: API_VERSION,
                id,
                winner_index,
                commitment,
            })
        }
        QueryMsg::Faq {} => {
            let items = collect_map(deps, &FAQ)?;
            let total = items.len() as u32;
            to_json_binary(&FaqResponse {
                api: API_VERSION,
                items,
                total,
            })
        }
        QueryMsg::Roles {} => {
            let cfg = CONFIG.load(deps.storage)?;
            to_json_binary(&roles_of(deps, &cfg))
        }
        QueryMsg::Roots {} => {
            let cfg = CONFIG.load(deps.storage)?;
            to_json_binary(&RootsResponse {
                api: API_VERSION,
                current_root: cfg.guest_root,
                current_epoch: cfg.epoch,
                current_leaf_count: cfg.leaf_count,
                items: roots_of(deps)?,
            })
        }
        QueryMsg::NullifierSpent { nullifier } => {
            let rec = NULLIFIERS.may_load(deps.storage, nullifier.as_slice())?;
            to_json_binary(&NullifierSpentResponse {
                spent: rec.is_some(),
                height: rec.map(|r| r.height),
            })
        }
        QueryMsg::ConsumeConfig {} => {
            let cfg = CONFIG.load(deps.storage)?;
            to_json_binary(&consume_config_of(&cfg))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::msg::InstantiateMsg;
    use crate::state::{EventStatus, FaqItem, RafflePrize};
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info, MockApi, MockQuerier, MockStorage};
    use cosmwasm_std::{
        from_json, Binary, ContractResult, HexBinary, OwnedDeps, SystemResult, Timestamp,
        WasmQuery as WQ,
    };
    use std::collections::HashMap;

    fn ts() -> Timestamp {
        Timestamp::from_seconds(1_800_000_000)
    }

    fn inst() -> InstantiateMsg {
        InstantiateMsg {
            curator: Some("curator".into()),
            cw_ave: None,
            coordinators: "group".into(),
            randomness: None,
            id: "speakez-sessions".into(),
            name: "Speakez Sessions".into(),
            status: EventStatus::Announced,
            start: ts(),
            end: ts(),
            timezone: "America/New_York".into(),
            venue_label: None,
            domain: "http://127.0.0.1:3051".into(),
            door_auth_pubkey: None,
            kind: None,
            d_tag: None,
            summary: Some("Music until late. Ink, food, a quiet alcove.".into()),
            content: None,
            location: None,
            geohash: None,
            image: None,
            tags: Some(vec!["music".into(), "night".into()]),
            metadata_uri: None,
            metadata_hash: None,
            service_key: None,
            usher_group: None,
            zkid: None,
            event_id_fp: None,
            domain_fp: None,
            guest_root_vk: None,
        }
    }

    fn addrs(
        deps: &OwnedDeps<MockStorage, MockApi, MockQuerier>,
    ) -> (String, String, String, String, String, String, String, String) {
        (
            deps.api.addr_make("curator").to_string(),
            deps.api.addr_make("group").to_string(),
            deps.api.addr_make("coord").to_string(),
            deps.api.addr_make("stranger").to_string(),
            deps.api.addr_make("rand").to_string(),
            deps.api.addr_make("service").to_string(),
            deps.api.addr_make("ushers").to_string(),
            deps.api.addr_make("usher").to_string(),
        )
    }

    fn deps_with_groups(
        groups: &[(&str, &[(&str, u64)])],
    ) -> OwnedDeps<MockStorage, MockApi, MockQuerier> {
        let mut deps = mock_dependencies();
        let mut tables: HashMap<String, HashMap<String, u64>> = HashMap::new();
        for (gname, members) in groups {
            let gaddr = deps.api.addr_make(gname).to_string();
            let map = members
                .iter()
                .map(|(a, w)| (deps.api.addr_make(a).to_string(), *w))
                .collect();
            tables.insert(gaddr, map);
        }
        deps.querier.update_wasm(move |q| match q {
            WQ::Smart { contract_addr, msg } => {
                if let Some(map) = tables.get(contract_addr) {
                    let query: GroupQuery = from_json(msg).unwrap();
                    let bin = match query {
                        GroupQuery::Member { addr, .. } => {
                            let w = map.get(&addr).copied();
                            to_json_binary(&MemberResponse { weight: w }).unwrap()
                        }
                        GroupQuery::ListMembers { .. } => {
                            let members = map
                                .iter()
                                .map(|(addr, weight)| crate::msg::Member {
                                    addr: addr.clone(),
                                    weight: *weight,
                                })
                                .collect();
                            to_json_binary(&MemberListResponse { members }).unwrap()
                        }
                    };
                    SystemResult::Ok(ContractResult::Ok(bin))
                } else {
                    SystemResult::Ok(ContractResult::Err("no wasm".into()))
                }
            }
            _ => SystemResult::Ok(ContractResult::Err("no wasm".into())),
        });
        deps
    }

    fn deps_with_group(members: &[(&str, u64)]) -> OwnedDeps<MockStorage, MockApi, MockQuerier> {
        deps_with_groups(&[("group", members)])
    }

    fn setup() -> OwnedDeps<MockStorage, MockApi, MockQuerier> {
        let mut deps = deps_with_groups(&[
            ("group", &[("coord", 1)]),
            ("ushers", &[("usher", 1)]),
        ]);
        let (curator, group, _, _, _, _, _, _) = addrs(&deps);
        let mut msg = inst();
        msg.curator = Some(curator.clone());
        msg.coordinators = group;
        instantiate(deps.as_mut(), mock_env(), mock_info(&curator, &[]), msg).unwrap();
        deps
    }

    struct TestAdmin {
        vk: HexBinary,
        key_packages: std::collections::BTreeMap<u16, frost_ed25519::keys::KeyPackage>,
        pubkey: frost_ed25519::keys::PublicKeyPackage,
    }

    fn test_admin() -> TestAdmin {
        use frost_ed25519 as frost;
        use frost::keys::dkg;
        use rand::rngs::OsRng;
        let t = 2u16;
        let n = 3u16;
        let mut r1_secrets = std::collections::BTreeMap::new();
        let mut r1_pkgs = std::collections::BTreeMap::new();
        for id in 1u16..=n {
            let ident = frost::Identifier::try_from(id).unwrap();
            let (secret, pkg) = dkg::part1(ident, n, t, OsRng).unwrap();
            r1_secrets.insert(id, secret);
            r1_pkgs.insert(id, pkg);
        }
        let mut r2_secrets = std::collections::BTreeMap::new();
        let mut r2_pkgs: std::collections::BTreeMap<u16, std::collections::BTreeMap<frost::Identifier, _>> =
            std::collections::BTreeMap::new();
        for id in 1u16..=n {
            let mut pkgs = std::collections::BTreeMap::new();
            for (jid, pkg) in &r1_pkgs {
                if *jid != id {
                    pkgs.insert(frost::Identifier::try_from(*jid).unwrap(), pkg.clone());
                }
            }
            let (secret, out) = dkg::part2(r1_secrets[&id].clone(), &pkgs).unwrap();
            r2_secrets.insert(id, secret);
            r2_pkgs.insert(id, out);
        }
        let mut key_packages = std::collections::BTreeMap::new();
        let mut pubkey = None;
        for id in 1u16..=n {
            let ident = frost::Identifier::try_from(id).unwrap();
            let mut r1 = std::collections::BTreeMap::new();
            for (jid, pkg) in &r1_pkgs {
                if *jid != id {
                    r1.insert(frost::Identifier::try_from(*jid).unwrap(), pkg.clone());
                }
            }
            let mut r2 = std::collections::BTreeMap::new();
            for (jid, outs) in &r2_pkgs {
                if *jid == id {
                    continue;
                }
                if let Some(pkg) = outs.get(&ident) {
                    r2.insert(frost::Identifier::try_from(*jid).unwrap(), pkg.clone());
                }
            }
            let (kp, pk) = dkg::part3(&r2_secrets[&id], &r1, &r2).unwrap();
            key_packages.insert(id, kp);
            pubkey = Some(pk);
        }
        let pubkey = pubkey.unwrap();
        let vk = HexBinary::from(pubkey.verifying_key().serialize().unwrap());
        TestAdmin { vk, key_packages, pubkey }
    }

    thread_local! {
        static TEST_ADMIN: TestAdmin = test_admin();
    }

    fn admin_vk() -> HexBinary {
        TEST_ADMIN.with(|a| a.vk.clone())
    }

    fn frost_sig(env: &cosmwasm_std::Env, root: &HexBinary, leaf_count: u32, epoch: u32) -> HexBinary {
        use frost_ed25519 as frost;
        TEST_ADMIN.with(|admin| {
            let message = crate::frost_root::guest_root_message(&env.contract.address, epoch, leaf_count, root);
            let ids: Vec<u16> = vec![1, 2];
            let mut commitments = std::collections::BTreeMap::new();
            let mut nonces = std::collections::BTreeMap::new();
            for id in &ids {
                let (n, c) = frost::round1::commit(admin.key_packages[id].signing_share(), &mut rand::rngs::OsRng);
                commitments.insert(frost::Identifier::try_from(*id).unwrap(), c);
                nonces.insert(*id, n);
            }
            let pkg = frost::SigningPackage::new(commitments.clone(), &message);
            let mut shares = std::collections::BTreeMap::new();
            for id in &ids {
                let share = frost::round2::sign(&pkg, &nonces[id], &admin.key_packages[id]).unwrap();
                shares.insert(frost::Identifier::try_from(*id).unwrap(), share);
            }
            let sig = frost::aggregate(&pkg, &shares, &admin.pubkey).unwrap();
            HexBinary::from(sig.serialize().unwrap())
        })
    }

    fn setup_ready() -> OwnedDeps<MockStorage, MockApi, MockQuerier> {
        let mut deps = setup();
        let (_, _, coord, _, _, service, ushers, _) = addrs(&deps);
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::SetGuestRootVk { vk: admin_vk() },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::SetServiceKey {
                addr: Some(service),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::SetUsherGroup {
                addr: Some(ushers),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::SetZkid {
                zkid: 7,
                event_id_fp: Some(HexBinary::from([3u8; 32])),
                domain_fp: Some(HexBinary::from([4u8; 32])),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::SetDomain {
                domain: "http://127.0.0.1:3051".into(),
                door_auth_pubkey: Some(HexBinary::from([9u8; 32])),
            },
        )
        .unwrap();
        deps
    }

    fn sig_ok() -> Binary {
        Binary::from(vec![1u8; 64])
    }

    fn live_consent(usher: &str, env: &cosmwasm_std::Env) -> crate::msg::Consent {
        let mut ch = b"sezs-door-v2\0".to_vec();
        ch.extend_from_slice(&[3u8; 32]);
        ch.extend_from_slice(&[4u8; 32]);
        ch.extend_from_slice(&[9u8; 16]);
        ch.extend_from_slice(&env.block.time.seconds().to_be_bytes());
        ch.extend_from_slice(usher.as_bytes());
        crate::msg::Consent::Live {
            challenge: Binary::from(ch),
            sig: sig_ok(),
        }
    }

    fn fp(b: u8) -> HexBinary {
        HexBinary::from([b; 32])
    }

    #[test]
    fn coordinator_from_cw420_can_edit_lineup_stranger_cannot() {
        let mut deps = setup();
        let slot = crate::state::LineupSlot {
            id: "slot-1".into(),
            index: 1,
            role: crate::state::SlotRole::Dj,
            handle: "Artist 01".into(),
            reference: None,
            start: ts(),
            duration_min: 50,
            lane: "cellar".into(),
        };
        let (_, _, coord, stranger, _, _, _, _) = addrs(&deps);
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::UpsertLineupSlot { slot: slot.clone() },
        )
        .unwrap();
        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&stranger, &[]),
            ExecuteMsg::UpsertLineupSlot { slot },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::Unauthorized);
    }

    #[test]
    fn no_custom_coordinator_map_and_venue_stays_hidden() {
        let deps = setup();
        // Would not compile if COORDINATORS map existed; Roles reads the group.
        let roles: RolesResponse =
            from_json(query(deps.as_ref(), mock_env(), QueryMsg::Roles {}).unwrap()).unwrap();
        let (_, group, coord, _, _, _, _, _) = addrs(&deps);
        assert_eq!(roles.coordinators_group, group);
        assert_eq!(roles.coordinators, vec![coord]);
        let venue: VenueView =
            from_json(query(deps.as_ref(), mock_env(), QueryMsg::Venue {}).unwrap()).unwrap();
        assert!(!venue.revealed);
        assert!(venue.label.is_none());
    }

    #[test]
    fn paid_leaves_are_raffle_entries_and_draw_needs_randomness() {
        let mut deps = setup();
        let (curator, _, coord, _, rand, _, _, _) = addrs(&deps);
        let leaf = HexBinary::from([7u8; 32]);
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&curator, &[]),
            ExecuteMsg::RegisterPaidLeaf {
                commitment: leaf.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::RegisterRafflePrize {
                prize: RafflePrize {
                    id: "p1".into(),
                    title: "Prize".into(),
                    note: None,
                    entries: 0,
                    status: RaffleStatus::Open,
                    draw: None,
                },
            },
        )
        .unwrap();
        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::RequestDraw { id: "p1".into() },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::NoOracle);

        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&curator, &[]),
            ExecuteMsg::SetRandomness {
                addr: Some(rand.clone()),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::RequestDraw { id: "p1".into() },
        )
        .unwrap();
        let env = mock_env();
        let job = format!("{}/p1/0", env.contract.address);
        execute(
            deps.as_mut(),
            env,
            mock_info(&rand, &[]),
            ExecuteMsg::RandomnessReceive {
                job_id: job,
                randomness: Binary::from(vec![0u8; 8]),
            },
        )
        .unwrap();
        let won: WinningLeafResponse = from_json(
            query(
                deps.as_ref(),
                mock_env(),
                QueryMsg::WinningLeaf { id: "p1".into() },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(won.winner_index, Some(0));
        assert_eq!(won.commitment, Some(leaf));

        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info("anyone", &[]),
            ExecuteMsg::ClaimPrize {
                id: "p1".into(),
                raffle_nullifier: HexBinary::from([1u8; 32]),
                proof: Binary::from(vec![1]),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::KnowledgeProofPending);
    }

    #[test]
    fn event_info_has_stable_id_and_no_venue() {
        let deps = setup();
        let info: EventInfoResponse =
            from_json(query(deps.as_ref(), mock_env(), QueryMsg::EventInfo {}).unwrap()).unwrap();
        assert_eq!(info.id, "speakez-sessions");
        assert_eq!(info.name, "Speakez Sessions");
        let raw = query(deps.as_ref(), mock_env(), QueryMsg::EventInfo {}).unwrap();
        let s = String::from_utf8(raw.to_vec()).unwrap();
        assert!(!s.contains("venue"));
    }

    #[test]
    fn domain_is_coordinator_gated_and_returned_on_event_info() {
        let mut deps = setup();
        let info: EventInfoResponse =
            from_json(query(deps.as_ref(), mock_env(), QueryMsg::EventInfo {}).unwrap()).unwrap();
        assert_eq!(info.domain, "http://127.0.0.1:3051");
        assert!(info.door_auth_pubkey.is_empty());

        let (_, _, coord, stranger, _, _, _, _) = addrs(&deps);
        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&stranger, &[]),
            ExecuteMsg::SetDomain {
                domain: "https://tickets.example".into(),
                door_auth_pubkey: None,
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::Unauthorized);

        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::SetDomain {
                domain: "https://tickets.example/".into(),
                door_auth_pubkey: Some(HexBinary::from([9u8; 32])),
            },
        )
        .unwrap();
        let info: EventInfoResponse =
            from_json(query(deps.as_ref(), mock_env(), QueryMsg::EventInfo {}).unwrap()).unwrap();
        assert_eq!(info.domain, "https://tickets.example");
        assert_eq!(info.door_auth_pubkey, HexBinary::from([9u8; 32]));

        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::SetDomain {
                domain: "not-an-origin".into(),
                door_auth_pubkey: None,
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::InvalidDomain);
    }

    #[test]
    fn event_view_is_complete_and_versioned() {
        let mut deps = setup();
        let (_, _, coord, _, _, _, _, _) = addrs(&deps);
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::UpsertFaq {
                item: FaqItem {
                    id: "q1".into(),
                    question: "When do doors open?".into(),
                    answer: "The time is on the event record.".into(),
                },
            },
        )
        .unwrap();
        let view: EventView =
            from_json(query(deps.as_ref(), mock_env(), QueryMsg::EventView {}).unwrap()).unwrap();
        assert_eq!(view.api, 2);
        assert_eq!(view.schema, "sezs-event-v2");
        assert_eq!(view.event.name, "Speakez Sessions");
        assert_eq!(view.event.kind, 31923);
        assert_eq!(view.event.d_tag, "speakez-sessions");
        assert_eq!(view.event.domain, "http://127.0.0.1:3051");
        assert_eq!(view.faq.len(), 1);
        assert_eq!(view.faq[0].id, "q1");
        assert_eq!(view.consume.verifier, "zk-wasmvm");
        assert_eq!(view.consume.zkid, 0);
        let raw = String::from_utf8(
            query(deps.as_ref(), mock_env(), QueryMsg::EventView {})
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(raw.contains("sezs-event-v2"));
        assert!(raw.contains("summary"));
    }

    #[test]
    fn nip52_and_metadata_uri_round_trip() {
        let mut deps = setup();
        let (_, _, coord, stranger, _, _, _, _) = addrs(&deps);
        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&stranger, &[]),
            ExecuteMsg::SetMetadata {
                uri: "https://example.invalid/event.json".into(),
                content_hash: Some(fp(9)),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::Unauthorized);
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::SetNip52 {
                body: crate::msg::Nip52Body {
                    kind: 31923,
                    d_tag: "night-01".into(),
                    title: "A night".into(),
                    summary: "A short summary.".into(),
                    content: "A longer description.".into(),
                    start: ts(),
                    end: ts(),
                    timezone: "UTC".into(),
                    location: "The cellar".into(),
                    geohash: Some("dr5regw".into()),
                    image: Some("https://127.0.0.1/img.png".into()),
                    tags: vec!["music".into()],
                },
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::SetMetadata {
                uri: "https://127.0.0.1/meta.json".into(),
                content_hash: Some(fp(9)),
            },
        )
        .unwrap();
        let view: EventView =
            from_json(query(deps.as_ref(), mock_env(), QueryMsg::EventView {}).unwrap()).unwrap();
        assert_eq!(view.event.name, "A night");
        assert_eq!(view.event.d_tag, "night-01");
        assert_eq!(view.event.location, "The cellar");
        assert_eq!(view.event.geohash, "dr5regw");
        assert_eq!(view.event.metadata_uri, "https://127.0.0.1/meta.json");
        assert_eq!(view.event.metadata_hash, fp(9));
        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::SetNip52 {
                body: crate::msg::Nip52Body {
                    kind: 1,
                    d_tag: "x".into(),
                    title: "x".into(),
                    summary: "".into(),
                    content: "".into(),
                    start: ts(),
                    end: ts(),
                    timezone: "UTC".into(),
                    location: "".into(),
                    geohash: None,
                    image: None,
                    tags: vec![],
                },
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::BadKind);
    }

    #[test]
    fn eth_and_base_tiers_are_rejected() {
        let mut deps = setup();
        let (curator, _, _, _, _, _, _, _) = addrs(&deps);
        let mut tier = crate::state::TicketTier {
            id: "ga".into(),
            label: "Admission".into(),
            guest_weight: Some(1),
            list_cents: 4000,
            discounts_bps: vec![(crate::state::Rail::Zec, 5000)],
            supply: 10,
            sold: 0,
            rails: vec![crate::state::Rail::Zec, crate::state::Rail::Eth],
        };
        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&curator, &[]),
            ExecuteMsg::UpsertTier { tier: tier.clone() },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::ForbiddenRail);
        tier.rails = vec![crate::state::Rail::Zec, crate::state::Rail::Penumbra];
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&curator, &[]),
            ExecuteMsg::UpsertTier { tier },
        )
        .unwrap();
    }

    #[test]
    fn admin_frost_publishes_roots_and_history_is_kept() {
        let mut deps = setup_ready();
        let (_, _, coord, stranger, _, service, _, usher) = addrs(&deps);
        let _ = (coord, usher, service);
        let env = mock_env();
        let err = execute(
            deps.as_mut(),
            env.clone(),
            mock_info(&stranger, &[]),
            ExecuteMsg::UpdateGuestRoot {
                root: fp(1),
                leaf_count: 1,
                epoch: 1,
                frost_signature: HexBinary::from(vec![0u8; 64]),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::BadFrostSignature);
        execute(
            deps.as_mut(),
            env.clone(),
            mock_info(&stranger, &[]),
            ExecuteMsg::UpdateGuestRoot {
                root: fp(1),
                leaf_count: 2,
                epoch: 1,
                frost_signature: frost_sig(&env, &fp(1), 2, 1),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            env.clone(),
            mock_info(&stranger, &[]),
            ExecuteMsg::UpdateGuestRoot {
                root: fp(2),
                leaf_count: 4,
                epoch: 2,
                frost_signature: frost_sig(&env, &fp(2), 4, 2),
            },
        )
        .unwrap();
        let err = execute(
            deps.as_mut(),
            env.clone(),
            mock_info(&stranger, &[]),
            ExecuteMsg::UpdateGuestRoot {
                root: fp(3),
                leaf_count: 3,
                epoch: 3,
                frost_signature: frost_sig(&env, &fp(3), 3, 3),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::LeafCountDecreased);
        let roots: RootsResponse =
            from_json(query(deps.as_ref(), mock_env(), QueryMsg::Roots {}).unwrap()).unwrap();
        assert_eq!(roots.current_epoch, 2);
        assert_eq!(roots.current_leaf_count, 4);
        assert_eq!(roots.items.len(), 2);
        assert_eq!(roots.items[0].root, fp(1));
        assert_eq!(roots.items[1].root, fp(2));
    }

    #[test]
    fn consume_ticket_is_usher_only_and_stub_verifies_in_tests() {
        let mut deps = setup_ready();
        let (_, _, coord, stranger, _, service, _, usher) = addrs(&deps);
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&service, &[]),
            ExecuteMsg::UpdateGuestRoot {
                root: fp(1),
                leaf_count: 1,
                epoch: 1,
                frost_signature: frost_sig(&mock_env(), &fp(1), 1, 1),
            },
        )
        .unwrap();
        let msg = ExecuteMsg::ConsumeTicket {
            proof: Binary::from(b"stub-ok".to_vec()),
            root: fp(1),
            nullifier: fp(8),
            event_id: fp(3),
            domain: fp(4),
            rk_x: fp(5),
            rk_y: fp(6),
            consent: crate::msg::Consent::Printed { sig: sig_ok() },
        };
        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&stranger, &[]),
            msg.clone(),
        )
        .unwrap_err();
        assert_eq!(err, ContractError::Unauthorized);
        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            msg.clone(),
        )
        .unwrap_err();
        assert_eq!(err, ContractError::Unauthorized);
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&usher, &[]),
            msg.clone(),
        )
        .unwrap();
        let spent: NullifierSpentResponse = from_json(
            query(
                deps.as_ref(),
                mock_env(),
                QueryMsg::NullifierSpent { nullifier: fp(8) },
            )
            .unwrap(),
        )
        .unwrap();
        assert!(spent.spent);
        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&usher, &[]),
            msg.clone(),
        )
        .unwrap_err();
        assert_eq!(err, ContractError::NullifierSpent);
        let mut bad = msg;
        if let ExecuteMsg::ConsumeTicket { proof, nullifier, .. } = &mut bad {
            *proof = Binary::from(vec![9, 9, 9]);
            *nullifier = fp(11);
        }
        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&usher, &[]),
            bad,
        )
        .unwrap_err();
        assert_eq!(err, ContractError::TicketRejected("ticket proof invalid".into()));
        let unspent: NullifierSpentResponse = from_json(
            query(
                deps.as_ref(),
                mock_env(),
                QueryMsg::NullifierSpent { nullifier: fp(11) },
            )
            .unwrap(),
        )
        .unwrap();
        assert!(!unspent.spent);
    }

    #[test]
    fn consume_is_fail_closed_when_zkid_is_zero() {
        let mut deps = setup();
        let (_, _, coord, _, _, service, ushers, usher) = addrs(&deps);
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::SetServiceKey {
                addr: Some(service.clone()),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::SetUsherGroup {
                addr: Some(ushers),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&coord, &[]),
            ExecuteMsg::SetGuestRootVk { vk: admin_vk() },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&service, &[]),
            ExecuteMsg::UpdateGuestRoot {
                root: fp(1),
                leaf_count: 1,
                epoch: 1,
                frost_signature: frost_sig(&mock_env(), &fp(1), 1, 1),
            },
        )
        .unwrap();
        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&usher, &[]),
            ExecuteMsg::ConsumeTicket {
                proof: Binary::from(b"stub-ok".to_vec()),
                root: fp(1),
                nullifier: fp(8),
                event_id: fp(3),
                domain: fp(4),
                rk_x: fp(5),
                rk_y: fp(6),
                consent: crate::msg::Consent::Live {
                    challenge: Binary::from(b"c".to_vec()),
                    sig: Binary::from(vec![1]),
                },
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::ZkidUnset);
    }

    #[test]
    fn consume_rejects_wrong_event_and_does_not_spend() {
        let mut deps = setup_ready();
        let (_, _, _, _, _, service, _, usher) = addrs(&deps);
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&service, &[]),
            ExecuteMsg::UpdateGuestRoot {
                root: fp(1),
                leaf_count: 1,
                epoch: 1,
                frost_signature: frost_sig(&mock_env(), &fp(1), 1, 1),
            },
        )
        .unwrap();
        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&usher, &[]),
            ExecuteMsg::ConsumeTicket {
                proof: Binary::from(b"stub-ok".to_vec()),
                root: fp(1),
                nullifier: fp(8),
                event_id: fp(9),
                domain: fp(4),
                rk_x: fp(5),
                rk_y: fp(6),
                consent: crate::msg::Consent::Printed { sig: sig_ok() },
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::WrongEvent);
        let unspent: NullifierSpentResponse = from_json(
            query(
                deps.as_ref(),
                mock_env(),
                QueryMsg::NullifierSpent { nullifier: fp(8) },
            )
            .unwrap(),
        )
        .unwrap();
        assert!(!unspent.spent);
    }

    #[test]
    fn consume_live_binds_the_usher_sender() {
        let mut deps = setup_ready();
        let (_, _, _, _, _, service, _, usher) = addrs(&deps);
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&service, &[]),
            ExecuteMsg::UpdateGuestRoot {
                root: fp(1),
                leaf_count: 1,
                epoch: 1,
                frost_signature: frost_sig(&mock_env(), &fp(1), 1, 1),
            },
        )
        .unwrap();
        let env = mock_env();
        // A challenge issued to a different usher must not be spendable by this sender.
        let err = execute(
            deps.as_mut(),
            env.clone(),
            mock_info(&usher, &[]),
            ExecuteMsg::ConsumeTicket {
                proof: Binary::from(b"stub-ok".to_vec()),
                root: fp(1),
                nullifier: fp(8),
                event_id: fp(3),
                domain: fp(4),
                rk_x: fp(5),
                rk_y: fp(6),
                consent: live_consent("not-this-usher", &env),
            },
        )
        .unwrap_err();
        match err {
            ContractError::TicketRejected(m) => {
                assert!(m.contains("another usher"), "{m}")
            }
            other => panic!("expected TicketRejected, got {other:?}"),
        }
        execute(
            deps.as_mut(),
            env.clone(),
            mock_info(&usher, &[]),
            ExecuteMsg::ConsumeTicket {
                proof: Binary::from(b"stub-ok".to_vec()),
                root: fp(1),
                nullifier: fp(8),
                event_id: fp(3),
                domain: fp(4),
                rk_x: fp(5),
                rk_y: fp(6),
                consent: live_consent(&usher, &env),
            },
        )
        .unwrap();
    }

    #[test]
    fn update_guest_root_rejects_a_non_canonical_field() {
        let mut deps = setup_ready();
        let (_, _, _, _, _, service, _, _) = addrs(&deps);
        // Pallas modulus itself is not a canonical field element.
        let p = HexBinary::from(vec![
            0x01, 0x00, 0x00, 0x00, 0xed, 0x30, 0x2d, 0x99, 0x1b, 0xf9, 0x4c, 0x09, 0xfc, 0x98, 0x46, 0x22,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40,
        ]);
        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(&service, &[]),
            ExecuteMsg::UpdateGuestRoot {
                root: p,
                leaf_count: 1,
                epoch: 1,
                frost_signature: HexBinary::from(vec![0u8; 64]),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::BadPublicInput);
    }

}

