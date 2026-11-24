use cosmwasm_schema::cw_serde;
use cosmwasm_std::{Addr, HexBinary, Timestamp};
use cw_storage_plus::{Item, Map};

/// Numeric API version returned on every query.
pub const API_VERSION: u16 = 2;
/// Versioned schema id for the full EventView document.
pub const SCHEMA: &str = "sezs-event-v2";

pub const CONFIG: Item<Config> = Item::new("c");
pub const LINEUP: Map<&str, LineupSlot> = Map::new("lu");
pub const TIMELINE: Map<&str, TimelineItem> = Map::new("tl");
pub const SPONSORS: Map<&str, Sponsor> = Map::new("sp");
pub const TIERS: Map<&str, TicketTier> = Map::new("ti");
pub const RAFFLES: Map<&str, RafflePrize> = Map::new("rf");
pub const FAQ: Map<&str, FaqItem> = Map::new("fq");
/// Ordered paid commitments (1 ticket = 1 raffle entry). No identities.
pub const PAID_LEAVES: Map<u32, HexBinary> = Map::new("pl");
pub const PAID_NEXT: Item<u32> = Item::new("pn");
/// Historical guest-list roots. Key is the 32-byte root. Older roots stay valid.
pub const ROOTS: Map<&[u8], RootRecord> = Map::new("rt");
/// Spent nullifiers. Key is the 32-byte N.
pub const NULLIFIERS: Map<&[u8], NullifierRecord> = Map::new("nf");

/// NIP-52 calendar kinds used by the Calendar DAO module.
pub const KIND_DATE_BASED: u16 = 31922;
pub const KIND_TIME_BASED: u16 = 31923;
pub const KIND_CALENDAR: u16 = 31924;
pub const KIND_RSVP: u16 = 31925; // commitment only; never consume/attendance

#[cw_serde]
pub struct Config {
    pub curator: Addr,
    pub cw_ave: Option<Addr>,
    /// cw420 (cw4) group. Principal admin / FROST coordinator set.
    pub coordinators: Addr,
    /// Pluggable randomness contract. Pending until the user points at theirs.
    pub randomness: Option<Addr>,
    pub id: String,
    pub name: String,
    pub status: EventStatus,
    pub start: Timestamp,
    pub end: Timestamp,
    pub timezone: String,
    pub venue_label: String,
    /// Origin URL that site-scoped ZID keys and ticket signatures bind to.
    pub domain: String,
    /// Ed25519 raw public key (32 bytes) of the event door-auth key. May be empty until set.
    pub door_auth_pubkey: HexBinary,
    /// NIP-52 kind. Lab nights are time-based (31923).
    pub kind: u16,
    /// Calendar `d` tag. Defaults to `id`.
    pub d_tag: String,
    pub summary: String,
    pub content: String,
    pub location: String,
    pub geohash: String,
    pub image: String,
    pub tags: Vec<String>,
    /// Optional off-chain metadata URI. On-chain fields remain authoritative.
    pub metadata_uri: String,
    /// SHA-256 of the bytes at `metadata_uri`. Empty if unset.
    pub metadata_hash: HexBinary,
    /// Optional backend runtime key (legacy). Guest-root publish is authorized by guest_root_vk.
    pub service_key: Option<Addr>,
    /// Lower-authority usher cw420. Members may ConsumeTicket only.
    pub usher_group: Option<Addr>,
    /// Circuit id for zk-wasmvm verify. 0 is fail-closed.
    pub zkid: u64,
    /// 32-byte event id field element used as a public input. Empty until set.
    pub event_id_fp: HexBinary,
    /// 32-byte domain field element used as a public input. Empty until set.
    pub domain_fp: HexBinary,
    pub guest_root: HexBinary,
    pub leaf_count: u32,
    pub epoch: u32,
    /// 32-byte verifying key of the session admin FROST set (2-of-3).
    pub guest_root_vk: Option<HexBinary>,
}

#[cw_serde]
pub struct FaqItem {
    pub id: String,
    pub question: String,
    pub answer: String,
}

#[cw_serde]
pub struct RootRecord {
    pub root: HexBinary,
    pub epoch: u32,
    pub leaf_count: u32,
    pub time: Timestamp,
}

#[cw_serde]
pub struct NullifierRecord {
    pub height: u64,
    pub time: Timestamp,
}

#[cw_serde]
pub enum EventStatus {
    Draft,
    Announced,
    Onsale,
    Live,
    Closed,
    Settled,
}

#[cw_serde]
pub enum SlotRole {
    Dj,
    Vj,
    Flow,
    Vendor,
    Host,
    Other,
}

#[cw_serde]
pub struct LineupSlot {
    pub id: String,
    pub index: u32,
    pub role: SlotRole,
    pub handle: String,
    pub reference: Option<String>,
    pub start: Timestamp,
    pub duration_min: u32,
    pub lane: String,
}

#[cw_serde]
pub struct TimelineItem {
    pub id: String,
    pub start: Timestamp,
    pub end: Option<Timestamp>,
    pub label: String,
    pub lane: Option<String>,
    pub slot_id: Option<String>,
    pub untimed: bool,
}

#[cw_serde]
pub struct Sponsor {
    pub id: String,
    pub handle: String,
    pub note: Option<String>,
    pub href: Option<String>,
}

#[cw_serde]
pub enum Rail {
    Zec,
    Penumbra,
    /// Kept in the enum so historical records decode. Rejected on write in v2.
    Eth,
    /// Kept in the enum so historical records decode. Rejected on write in v2.
    Base,
}

impl Rail {
    pub fn allowed_for_sale(&self) -> bool {
        matches!(self, Rail::Zec | Rail::Penumbra)
    }
}

#[cw_serde]
pub struct TicketTier {
    pub id: String,
    pub label: String,
    pub guest_weight: Option<u64>,
    pub list_cents: u32,
    pub discounts_bps: Vec<(Rail, u16)>,
    pub supply: u32,
    pub sold: u32,
    pub rails: Vec<Rail>,
}

#[cw_serde]
pub enum RaffleStatus {
    Open,
    Closed,
    Drawn,
}

#[cw_serde]
pub struct RaffleDraw {
    pub job_id: String,
    pub winner_index: Option<u32>,
    pub proof_href: Option<String>,
    pub oracle: String,
    pub randomness: Option<String>,
}

#[cw_serde]
pub struct RafflePrize {
    pub id: String,
    pub title: String,
    pub note: Option<String>,
    pub entries: u32,
    pub status: RaffleStatus,
    pub draw: Option<RaffleDraw>,
}

pub fn page_limit(limit: Option<u32>) -> u32 {
    limit.unwrap_or(30).clamp(1, 100)
}

pub fn paid_count(storage: &dyn cosmwasm_std::Storage) -> u32 {
    PAID_NEXT.may_load(storage).ok().flatten().unwrap_or(0)
}

pub fn valid_kind(kind: u16) -> bool {
    matches!(kind, KIND_DATE_BASED | KIND_TIME_BASED | KIND_CALENDAR)
}
