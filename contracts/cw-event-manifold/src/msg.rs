use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{Addr, Binary, HexBinary, Timestamp};

use crate::state::{
    EventStatus, FaqItem, LineupSlot, RafflePrize, RootRecord, Sponsor, TicketTier, TimelineItem,
};

#[cw_serde]
pub struct InstantiateMsg {
    pub curator: Option<String>,
    pub cw_ave: Option<String>,
    /// cw420 (cw4) group address. Principal admin / FROST coordinator set. Required.
    pub coordinators: String,
    /// Pluggable randomness contract. Leave unset until the user points at theirs.
    pub randomness: Option<String>,
    pub id: String,
    pub name: String,
    pub status: EventStatus,
    pub start: Timestamp,
    pub end: Timestamp,
    pub timezone: String,
    pub venue_label: Option<String>,
    /// Origin URL (scheme + host + optional port) for ZID and ticket signatures.
    pub domain: String,
    pub door_auth_pubkey: Option<HexBinary>,
    /// NIP-52 kind. Defaults to 31923 (time-based) when omitted.
    pub kind: Option<u16>,
    pub d_tag: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub location: Option<String>,
    pub geohash: Option<String>,
    pub image: Option<String>,
    pub tags: Option<Vec<String>>,
    pub metadata_uri: Option<String>,
    pub metadata_hash: Option<HexBinary>,
    pub service_key: Option<String>,
    /// 32-byte admin FROST verifying key. Required before the first UpdateGuestRoot.
    pub guest_root_vk: Option<HexBinary>,
    pub usher_group: Option<String>,
    pub zkid: Option<u64>,
    pub event_id_fp: Option<HexBinary>,
    pub domain_fp: Option<HexBinary>,
}

#[cw_serde]
#[derive(cw_orch::ExecuteFns)]
pub enum ExecuteMsg {
    UpdateEventInfo {
        id: Option<String>,
        name: Option<String>,
        status: Option<EventStatus>,
        start: Option<Timestamp>,
        end: Option<Timestamp>,
        timezone: Option<String>,
        summary: Option<String>,
        content: Option<String>,
    },
    /// Write the NIP-52-shaped event definition (title is `name`).
    SetNip52 { body: Nip52Body },
    /// Optional off-chain metadata pointer. On-chain fields stay authoritative.
    SetMetadata {
        uri: String,
        content_hash: Option<HexBinary>,
    },
    SetVenue { label: String },
    SetCwAve { addr: Option<String> },
    SetCoordinators { addr: String },
    SetRandomness { addr: Option<String> },
    /// Coordinator-gated. Binds ZID keys and ticket signatures to this origin.
    SetDomain { domain: String, door_auth_pubkey: Option<HexBinary> },
    /// Principal admin (coordinator group or curator). Points the backend runtime key.
    SetServiceKey { addr: Option<String> },
    /// Principal admin. Lower-authority ushers may ConsumeTicket only.
    SetUsherGroup { addr: Option<String> },
    /// Principal admin. Circuit id; 0 is fail-closed.
    SetZkid { zkid: u64, event_id_fp: Option<HexBinary>, domain_fp: Option<HexBinary> },
    /// Principal admin. Register or rotate the admin FROST verifying key.
    SetGuestRootVk { vk: HexBinary },
    /// Broadcast by the backend. Authorized by a 2-of-3 admin FROST signature,
    /// not by the lab service key.
    UpdateGuestRoot {
        root: HexBinary,
        leaf_count: u32,
        epoch: u32,
        frost_signature: HexBinary,
    },
    /// Usher-only. Halo2 proof + RedPallas consent via zk-wasmvm.
    ConsumeTicket {
        proof: Binary,
        root: HexBinary,
        nullifier: HexBinary,
        event_id: HexBinary,
        domain: HexBinary,
        rk_x: HexBinary,
        rk_y: HexBinary,
        consent: Consent,
    },
    UpsertFaq { item: FaqItem },
    RemoveFaq { id: String },
    UpsertLineupSlot { slot: LineupSlot },
    RemoveLineupSlot { id: String },
    UpsertTimelineItem { item: TimelineItem },
    RemoveTimelineItem { id: String },
    UpsertSponsor { sponsor: Sponsor },
    RemoveSponsor { id: String },
    UpsertTier { tier: TicketTier },
    RemoveTier { id: String },
    RecordSale { tier_id: String, count: u32 },
    RegisterPaidLeaf { commitment: HexBinary },
    RegisterRafflePrize { prize: RafflePrize },
    CloseRaffle { id: String },
    RequestDraw { id: String },
    /// Accepted only from the configured randomness address.
    RandomnessReceive { job_id: String, randomness: Binary },
    /// Knowledge proof of the ticket secret for the winning leaf. Scaffold is pending.
    ClaimPrize {
        id: String,
        raffle_nullifier: HexBinary,
        proof: Binary,
    },
}

#[cw_serde]
pub struct Nip52Body {
    pub kind: u16,
    pub d_tag: String,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub start: Timestamp,
    pub end: Timestamp,
    pub timezone: String,
    pub location: String,
    pub geohash: Option<String>,
    pub image: Option<String>,
    pub tags: Vec<String>,
}

#[cw_serde]
pub enum Consent {
    /// Live phone-to-usher handshake. `sig` is over the door challenge under rk.
    Live { challenge: Binary, sig: Binary },
    /// Printed pre-authorized admit. The contract recomputes the message
    /// (`sezs-print-v2` ‖ event ‖ domain ‖ N ‖ door_auth_pubkey); the client sends only `sig`.
    Printed { sig: Binary },
}

#[cw_serde]
#[derive(cw_orch::QueryFns, QueryResponses)]
pub enum QueryMsg {
    #[returns(ApiVersionResponse)]
    ApiVersion {},
    /// One query: the full deterministic event view plus versioned schema.
    #[returns(EventView)]
    EventView {},
    #[returns(EventInfoResponse)]
    EventInfo {},
    #[returns(VenueView)]
    Venue {},
    #[returns(VenueView)]
    VenueForHolder {
        commitment: HexBinary,
        proof: Binary,
    },
    #[returns(LineupResponse)]
    Lineup {
        start_after: Option<String>,
        limit: Option<u32>,
    },
    #[returns(TimelineResponse)]
    Timeline {
        start_after: Option<String>,
        limit: Option<u32>,
    },
    #[returns(SponsorsResponse)]
    Sponsors {
        start_after: Option<String>,
        limit: Option<u32>,
    },
    #[returns(TiersResponse)]
    Tiers {},
    #[returns(RafflesResponse)]
    Raffles {
        start_after: Option<String>,
        limit: Option<u32>,
    },
    #[returns(RafflePrize)]
    Raffle { id: String },
    #[returns(FaqResponse)]
    Faq {},
    #[returns(PaidLeavesResponse)]
    PaidLeaves {
        start_after: Option<u32>,
        limit: Option<u32>,
    },
    #[returns(WinningLeafResponse)]
    WinningLeaf { id: String },
    #[returns(RolesResponse)]
    Roles {},
    #[returns(RootsResponse)]
    Roots {},
    #[returns(NullifierSpentResponse)]
    NullifierSpent { nullifier: HexBinary },
    #[returns(ConsumeConfigResponse)]
    ConsumeConfig {},
}

#[cw_serde]
pub struct ApiVersionResponse {
    pub api: u16,
    pub schema: String,
    pub cw_ave: Option<Addr>,
}

#[cw_serde]
pub struct EventInfoResponse {
    pub api: u16,
    pub schema: String,
    pub id: String,
    pub cw_ave: Option<Addr>,
    pub name: String,
    pub status: EventStatus,
    pub start: Timestamp,
    pub end: Timestamp,
    pub timezone: String,
    pub domain: String,
    pub door_auth_pubkey: HexBinary,
    pub kind: u16,
    pub d_tag: String,
    pub summary: String,
    pub content: String,
    pub location: String,
    pub geohash: String,
    pub image: String,
    pub tags: Vec<String>,
    pub metadata_uri: String,
    pub metadata_hash: HexBinary,
}

/// Full deterministic event document. The front end instantiates from this
/// plus chain config (contract address, LCD, chain id).
#[cw_serde]
pub struct EventView {
    pub api: u16,
    pub schema: String,
    pub event: EventInfoResponse,
    pub venue: VenueView,
    pub lineup: Vec<LineupSlot>,
    pub timeline: Vec<TimelineItem>,
    pub sponsors: Vec<Sponsor>,
    pub tiers: Vec<TicketTier>,
    pub raffles: Vec<RafflePrize>,
    pub faq: Vec<FaqItem>,
    pub roles: RolesResponse,
    pub consume: ConsumeConfigResponse,
    pub roots: Vec<RootRecord>,
}

#[cw_serde]
pub struct VenueView {
    pub api: u16,
    pub revealed: bool,
    pub label: Option<String>,
    pub note: String,
}

#[cw_serde]
pub struct LineupResponse {
    pub api: u16,
    pub items: Vec<LineupSlot>,
    pub total: u32,
}

#[cw_serde]
pub struct TimelineResponse {
    pub api: u16,
    pub items: Vec<TimelineItem>,
    pub total: u32,
}

#[cw_serde]
pub struct SponsorsResponse {
    pub api: u16,
    pub items: Vec<Sponsor>,
    pub total: u32,
}

#[cw_serde]
pub struct TiersResponse {
    pub api: u16,
    pub items: Vec<TicketTier>,
}

#[cw_serde]
pub struct RafflesResponse {
    pub api: u16,
    pub items: Vec<RafflePrize>,
    pub total: u32,
}

#[cw_serde]
pub struct FaqResponse {
    pub api: u16,
    pub items: Vec<FaqItem>,
    pub total: u32,
}

#[cw_serde]
pub struct PaidLeavesResponse {
    pub api: u16,
    pub items: Vec<HexBinary>,
    pub total: u32,
}

#[cw_serde]
pub struct WinningLeafResponse {
    pub api: u16,
    pub id: String,
    pub winner_index: Option<u32>,
    pub commitment: Option<HexBinary>,
}

#[cw_serde]
pub struct RolesResponse {
    pub api: u16,
    pub curators: Vec<String>,
    pub coordinators: Vec<String>,
    pub coordinators_group: String,
    pub ushers: Vec<String>,
    pub usher_group: Option<String>,
    pub service_key: Option<String>,
}

#[cw_serde]
pub struct RootsResponse {
    pub api: u16,
    pub current_root: HexBinary,
    pub current_epoch: u32,
    pub current_leaf_count: u32,
    pub items: Vec<RootRecord>,
}

#[cw_serde]
pub struct NullifierSpentResponse {
    pub spent: bool,
    pub height: Option<u64>,
}

#[cw_serde]
pub struct ConsumeConfigResponse {
    pub api: u16,
    pub schema: String,
    pub zkid: u64,
    pub event_id_fp: HexBinary,
    pub domain: String,
    pub domain_fp: HexBinary,
    pub guest_root: HexBinary,
    pub epoch: u32,
    pub leaf_count: u32,
    pub service_key: Option<String>,
    pub usher_group: Option<String>,
    pub door_auth_pubkey: HexBinary,
    /// `"zk-wasmvm"` once zkid is set; consume still fails closed when zkid is 0.
    pub verifier: String,
}

// Minimal cw4 query surface (cw420). No custom coordinator map.
#[cw_serde]
pub enum GroupQuery {
    Member {
        addr: String,
        at_height: Option<u64>,
    },
    ListMembers {
        start_after: Option<String>,
        limit: Option<u32>,
    },
}

#[cw_serde]
pub struct MemberResponse {
    pub weight: Option<u64>,
}

#[cw_serde]
pub struct Member {
    pub addr: String,
    pub weight: u64,
}

#[cw_serde]
pub struct MemberListResponse {
    pub members: Vec<Member>,
}
