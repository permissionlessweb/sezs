//! Fictional "Lantern Night" opening event used to curate a realistic first record.
//! Names, venue, and works are invented. No lorem / placeholder / mock guest-visible words.
//!
//! Messages are serde_json values so this crate can compile against the
//! cw-orch 0.30 / cosmwasm-std 4.1 fork without pulling the CosmWasm 2.2
//! contract packages. Shapes match the event-manifold wasm ABI.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Saturday 16 January 2027, 20:00–03:00 Africa/Dakar (UTC+0).
pub const START_UNIX: u64 = 1_797_120_000; // 2027-01-16T20:00:00Z
pub const END_UNIX: u64 = 1_797_145_200; // 2027-01-17T03:00:00Z
pub const DOMAIN: &str = "http://127.0.0.1:3051";

/// Public door-auth (32 ASCII bytes, hex). Not a private key.

/// Pasta-field encodings used by sezs-ticket-v2 (see circuit encode.rs).
/// event_id: UTF-8 zero-padded to 32, top two bits of byte 31 cleared.
/// domain: SHA-256("sezs-domain-v2\0" || utf8), same mask. Hex is 32-byte LE.
pub fn event_id_fp_hex(event_id: &str) -> anyhow::Result<String> {
    let src = event_id.as_bytes();
    if src.is_empty() || src.len() > 31 {
        anyhow::bail!("event id must be 1..=31 bytes, got {}", src.len());
    }
    let mut b = [0u8; 32];
    b[..src.len()].copy_from_slice(src);
    b[31] &= 0x3f;
    Ok(hex::encode(b))
}

pub fn domain_fp_hex(domain: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(b"sezs-domain-v2\0");
    h.update(domain.as_bytes());
    let mut b: [u8; 32] = h.finalize().into();
    b[31] &= 0x3f;
    hex::encode(b)
}

pub fn door_auth_hex() -> String {
    // Same 32-byte ASCII door key as the previous local deploy (`padEnd(32, "x")`).
    let mut s = "sezs-lab-door-auth-v2".to_string();
    while s.len() < 32 {
        s.push('x');
    }
    hex::encode(s.as_bytes())
}

fn nanos(secs: u64) -> String {
    format!("{secs}000000000")
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LanternNight {
    pub id: String,
    pub name: String,
    pub timezone: String,
    pub venue_label: String,
    pub domain: String,
    pub summary: String,
    pub content: String,
    pub location: String,
    pub d_tag: String,
    pub zkid: Option<u64>,
}

impl Default for LanternNight {
    fn default() -> Self {
        Self {
            id: "lantern-night-2027".into(),
            name: "Speak-Ez Sessions: Lantern Night".into(),
            timezone: "Africa/Dakar".into(),
            venue_label: "The Copper Lantern, Harbor Row".into(),
            domain: DOMAIN.into(),
            summary: "A winter session of live sets, printed works, and a late-night raffle under the copper dome.".into(),
            content: "Doors at eight. Four rooms, one night. Tickets are issued as a Speak-Ez Sessions pass; a booking is not a ticket.".into(),
            location: "The Copper Lantern, Harbor Row".into(),
            d_tag: "lantern-night-2027".into(),
            zkid: None,
        }
    }
}

impl LanternNight {
    /// Invented collaborators for the fictional Lantern Night record.
    /// `example` is for the front end only; it is not written on-chain.
    pub fn sponsors(&self) -> Vec<Value> {
        vec![
            json!({
                "id": "sp-copper-dome-press",
                "name": "Copper Dome Press",
                "tier": "presenting",
                "note": "Printed the night's poster and programmes.",
                "example": true
            }),
            json!({
                "id": "sp-harbor-row-collective",
                "name": "Harbor Row Collective",
                "tier": "community",
                "note": "Neighborhood support for the copper lantern.",
                "example": true
            }),
        ]
    }

    /// NIP-52 tags as JSON array strings, matching the working local instantiate ABI.
    pub fn nip52_tags(&self) -> Vec<String> {
        let tag = |xs: Vec<String>| serde_json::to_string(&xs).unwrap();
        let start = START_UNIX;
        let end = END_UNIX;
        let mut tags = vec![
            tag(vec!["d".into(), "lantern-night-2027".into()]),
            tag(vec!["title".into(), self.name.clone()]),
            tag(vec!["summary".into(), self.summary.clone()]),
            tag(vec!["location".into(), self.location.clone()]),
            tag(vec!["start".into(), start.to_string()]),
            tag(vec!["end".into(), end.to_string()]),
        ];
        let sets = [
            ("alcove", "Mirelle Voss", start, start + 3600, "dj", "set-alcove-mirelle"),
            ("alcove", "Pearl Radio", start + 3600, start + 7200, "dj", "set-alcove-pearl"),
            ("cellar", "The Night Palms", start, start + 45 * 60, "live", "set-cellar-palms"),
            ("cellar", "Hollow Finch", start + 45 * 60, start + 2 * 3600, "live", "set-cellar-finch"),
            ("cellar", "Red Kite Ensemble", start + 2 * 3600, start + 3 * 3600 + 1800, "live", "set-cellar-kite"),
            ("floor", "Juniper Vale", start + 1800, start + 2 * 3600, "dj", "set-floor-juniper"),
            ("floor", "Cassette Harbor", start + 2 * 3600, start + 4 * 3600, "dj", "set-floor-cassette"),
            ("yard", "Oat & Ember", start + 3600, start + 2 * 3600 + 1800, "flow", "set-yard-oat"),
            ("yard", "Vesper Quay", start + 3 * 3600, start + 5 * 3600, "live", "set-yard-vesper"),
            ("floor", "Lampblack", start + 4 * 3600, end, "dj", "set-floor-lampblack"),
        ];
        for (room, artist, a, b, kind, id) in sets {
            tags.push(tag(vec![
                "set".into(),
                room.into(),
                artist.into(),
                a.to_string(),
                b.to_string(),
                kind.into(),
                id.into(),
            ]));
        }
        let extra: &[&[&str]] = &[
            &["door-price", "5500", "uterp"],
            &["stage", "cellar", "Cellar"],
            &["stage", "floor", "Floor"],
            &["stage", "alcove", "Alcove"],
            &["stage", "yard", "Yard"],
            &["artist", "mirelle-voss", "Mirelle Voss", "", "Opening set in the Alcove. Soft percussion, long delay."],
            &["artist", "night-palms", "The Night Palms", "", "Five-piece from the lower docks. Brushed drums and two horns."],
            &["artist", "juniper-vale", "Juniper Vale", "", "Records under her own name; floor sets lean toward house."],
            &["artist", "cassette-harbor", "Cassette Harbor", "", "Edits and broken-tempo selections from a private tape library."],
            &["artist", "red-kite", "Red Kite Ensemble", "", "String quartet with a small amplifier, late cellar set."],
            &["artist", "hollow-finch", "Hollow Finch", "", "Songs written on the ferry. Voice and twelve-string."],
            &["artist", "pearl-radio", "Pearl Radio", "", "Alcove closer. Voice, drum machine, one light."],
            &["artist", "lampblack", "Lampblack", "", "Last records of the night on the Floor."],
            &["artist", "oat-ember", "Oat & Ember", "", "Movement in the Yard between kitchen service."],
            &["artist", "vesper-quay", "Vesper Quay", "", "Yard closer. Harmonium and a small choir of friends."],
            &["vendor", "salt-cinder", "Salt & Cinder", "Kitchen: hearth bread, late soup, citrus ices."],
            &["vendor", "glasswing", "Glasswing Coffee", "Coffee and a short list of infusions until last set."],
            &["vendor", "northferry", "Northferry Records", "Pressings and a listening table in the hall."],
            &["vendor", "loom-ribbon", "Loom & Ribbon", "Printed merch and lantern badges at the alcove stair."],
            &["gallery", "gw-copper-dome", "Under the Copper Dome", "Mirelle Voss", "2.5", "", "mirelle-voss", "Ink and wash of the lantern room, edition of thirty."],
            &["gallery", "gw-harbor-row", "Harbor Row at Nine", "The Night Palms", "1.8", "", "night-palms", "A linoleum print of the street outside the venue."],
            &["gallery", "gw-ferry-ticket", "Unused Ferry Ticket", "Hollow Finch", "0.9", "", "hollow-finch", "Small collage on board, one of a series of twelve."],
            &["prize", "rf-lithograph", "Harbor Lithograph", "A signed print held at the records table.", "80", "open"],
            &["prize", "rf-lantern-print", "Copper Lantern print", "Workshop print from the alcove stair.", "120", "open"],
            &["prize", "rf-listening", "After-hours listening pass", "A seat at the Northferry table after last set.", "60", "open"],
            &["sponsor", "sp-copper-dome-press", "Copper Dome Press", "", "", "presenting", "Printed the night's poster and programmes."],
            &["sponsor", "sp-harbor-row-collective", "Harbor Row Collective", "", "", "community", "Neighborhood support for the copper lantern."],
        ];
        for row in extra {
            tags.push(tag(row.iter().map(|s| (*s).to_string()).collect()));
        }
        tags
    }

    pub fn nip52_document(&self) -> Value {
        let tags: Vec<Value> = self
            .nip52_tags()
            .into_iter()
            .map(|s| serde_json::from_str(&s).unwrap_or(json!([s])))
            .collect();
        json!({
            "kind": 31923,
            "d": self.d_tag,
            "content": self.content,
            "tags": tags,
            "sponsors": self.sponsors(),
        })
    }

    /// Write the public NIP-52 document and return (uri, sha256 hex).
    pub fn write_metadata_file(&self, path: &Path) -> anyhow::Result<(String, String)> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(&self.nip52_document())?;
        let mut out = bytes;
        if !out.ends_with(b"\n") {
            out.push(b'\n');
        }
        std::fs::write(path, &out)?;
        let hash = hex::encode(Sha256::digest(&out));
        let uri = format!("{DOMAIN}/lantern-night-nip52.json");
        Ok((uri, hash))
    }

    pub fn instantiate_msg(
        &self,
        curator: String,
        coordinators: String,
        usher_group: Option<String>,
        service_key: Option<String>,
        randomness: Option<String>,
        metadata_uri: Option<String>,
        metadata_hash: Option<String>,
    ) -> Value {
        json!({
            "curator": curator,
            "coordinators": coordinators,
            "randomness": randomness,
            "id": self.id,
            "name": self.name,
            "status": "announced",
            "start": nanos(START_UNIX),
            "end": nanos(END_UNIX),
            "timezone": self.timezone,
            "venue_label": self.venue_label,
            "domain": self.domain,
            "door_auth_pubkey": door_auth_hex(),
            "kind": 31923,
            "d_tag": self.d_tag,
            "summary": self.summary,
            "content": self.content,
            "location": self.location,
            "tags": self.nip52_tags(),
            "metadata_uri": metadata_uri,
            "metadata_hash": metadata_hash,
            "service_key": service_key,
            "usher_group": usher_group,
            "zkid": self.zkid,
            "event_id_fp": event_id_fp_hex(&self.id).ok(),
            "domain_fp": Some(domain_fp_hex(&self.domain)),
        })
    }

    /// Execute messages that fill the on-chain EventView after instantiate.
    pub fn curate_msgs(
        &self,
        metadata_uri: Option<String>,
        metadata_hash: Option<String>,
    ) -> Vec<Value> {
        let tags = self.nip52_tags();
        let mut out = vec![
            json!({
                "set_nip52": {
                    "body": {
                        "kind": 31923,
                        "d_tag": self.d_tag,
                        "title": self.name,
                        "summary": self.summary,
                        "content": self.content,
                        "start": nanos(START_UNIX),
                        "end": nanos(END_UNIX),
                        "timezone": self.timezone,
                        "location": self.location,
                        "tags": tags,
                    }
                }
            }),
            json!({ "set_venue": { "label": self.venue_label } }),
        ];
        if let (Some(uri), Some(hash)) = (metadata_uri, metadata_hash) {
            out.push(json!({ "set_metadata": { "uri": uri, "content_hash": hash } }));
        }
        if let Some(zkid) = self.zkid {
            out.push(json!({
                "set_zkid": {
                    "zkid": zkid,
                    "event_id_fp": event_id_fp_hex(&self.id).expect("event id fits field"),
                    "domain_fp": domain_fp_hex(&self.domain),
                }
            }));
        }
        let lineup = [
            ("slot-01", 0, "host", "Door welcome", START_UNIX, 30, "yard"),
            ("slot-02", 1, "dj", "Mirelle Voss", START_UNIX, 60, "alcove"),
            ("slot-03", 2, "other", "The Night Palms", START_UNIX, 45, "cellar"),
            ("slot-04", 3, "dj", "Juniper Vale", START_UNIX + 1800, 90, "floor"),
            ("slot-05", 4, "other", "Hollow Finch", START_UNIX + 45 * 60, 75, "cellar"),
            ("slot-06", 5, "dj", "Pearl Radio", START_UNIX + 3600, 60, "alcove"),
            ("slot-07", 6, "flow", "Oat & Ember", START_UNIX + 3600, 90, "yard"),
            ("slot-08", 7, "other", "Red Kite Ensemble", START_UNIX + 2 * 3600, 90, "cellar"),
            ("slot-09", 8, "dj", "Cassette Harbor", START_UNIX + 2 * 3600, 120, "floor"),
            ("slot-10", 9, "other", "Vesper Quay", START_UNIX + 3 * 3600, 120, "yard"),
            ("slot-11", 10, "dj", "Lampblack", START_UNIX + 4 * 3600, 60, "floor"),
        ];
        for (id, index, role, handle, start, duration, lane) in lineup {
            out.push(json!({
                "upsert_lineup_slot": {
                    "slot": {
                        "id": id,
                        "index": index,
                        "role": role,
                        "handle": handle,
                        "start": nanos(start),
                        "duration_min": duration,
                        "lane": lane,
                    }
                }
            }));
        }
        for (id, label, cents, supply) in [
            ("gallery", "Gallery", 2500, 40),
            ("floor", "Floor", 4000, 120),
            ("door", "Door", 5500, 40),
        ] {
            out.push(json!({
                "upsert_tier": {
                    "tier": {
                        "id": id,
                        "label": label,
                        "guest_weight": 1,
                        "list_cents": cents,
                        "discounts_bps": [],
                        "supply": supply,
                        "sold": 0,
                        "rails": ["zec", "penumbra"],
                    }
                }
            }));
        }
        for (id, title, note, entries) in [
            (
                "rf-lithograph",
                "Harbor Lithograph",
                "A signed print held at the records table.",
                80,
            ),
            (
                "rf-lantern-print",
                "Copper Lantern print",
                "Workshop print from the alcove stair.",
                120,
            ),
            (
                "rf-listening",
                "After-hours listening pass",
                "A seat at the Northferry table after last set.",
                60,
            ),
        ] {
            out.push(json!({
                "register_raffle_prize": {
                    "prize": { "id": id, "title": title, "note": note, "entries": entries, "status": "open" }
                }
            }));
        }
        out.push(json!({
            "upsert_faq": {
                "item": {
                    "id": "faq-ticket",
                    "question": "Is a booking a ticket?",
                    "answer": "No. Entry is a Speak-Ez Sessions pass issued for this night. A booking alone is not enough at the door.",
                }
            }
        }));
        for sp in self.sponsors() {
            let id = sp.get("id").and_then(|v| v.as_str()).unwrap_or_default();
            let handle = sp.get("name").and_then(|v| v.as_str()).unwrap_or_default();
            let note = sp.get("note").and_then(|v| v.as_str()).unwrap_or("");
            out.push(json!({
                "upsert_sponsor": {
                    "sponsor": {
                        "id": id,
                        "handle": handle,
                        "note": note,
                    }
                }
            }));
        }
        out
    }

    /// Messages that update metadata and sponsors on an already-curated event.
    /// Does not retouch lineup, tiers, raffles, or FAQ.
    pub fn metadata_update_msgs(&self, metadata_uri: String, metadata_hash: String) -> Vec<Value> {
        let mut out = vec![json!({ "set_metadata": { "uri": metadata_uri, "content_hash": metadata_hash } })];
        for sp in self.sponsors() {
            let id = sp.get("id").and_then(|v| v.as_str()).unwrap_or_default();
            let handle = sp.get("name").and_then(|v| v.as_str()).unwrap_or_default();
            let note = sp.get("note").and_then(|v| v.as_str()).unwrap_or("");
            out.push(json!({
                "upsert_sponsor": {
                    "sponsor": {
                        "id": id,
                        "handle": handle,
                        "note": note,
                    }
                }
            }));
        }
        out
    }
}

/// Official drand quicknet (terp-beacon::networks::QUICKNET).
pub fn terp_beacon_instantiate(admin: &str) -> Value {
    json!({
        "admin": admin,
        "chain_hash": "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
        "pubkey": "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
        "genesis_time": "1692803367000000000",
        "period_seconds": 3,
        "scheme": "bls-unchained-g1-rfc9380",
    })
}


#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SponsorSpec {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub tier: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub example: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LineupSpec {
    pub id: String,
    #[serde(default)]
    pub index: u32,
    #[serde(default = "default_slot_role")]
    pub role: String,
    pub handle: String,
    pub start: u64,
    #[serde(default = "default_duration_min")]
    pub duration_min: u32,
    #[serde(default)]
    pub lane: String,
}

fn default_slot_role() -> String {
    "other".into()
}

fn default_duration_min() -> u32 {
    60
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TierSpec {
    pub id: String,
    pub label: String,
    #[serde(default = "default_guest_weight")]
    pub guest_weight: u32,
    pub list_cents: u64,
    #[serde(default)]
    pub supply: Option<u32>,
    #[serde(default = "default_rails")]
    pub rails: Vec<String>,
}

fn default_guest_weight() -> u32 {
    1
}

fn default_rails() -> Vec<String> {
    vec!["zec".into(), "penumbra".into()]
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RaffleSpec {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub note: String,
    #[serde(default = "default_entries")]
    pub entries: u32,
    #[serde(default = "default_raffle_status")]
    pub status: String,
}

fn default_entries() -> u32 {
    0
}

fn default_raffle_status() -> String {
    "open".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FaqSpec {
    pub id: String,
    pub question: String,
    pub answer: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EventSpec {
    pub id: String,
    pub name: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default = "default_start")]
    pub start: u64,
    #[serde(default = "default_end")]
    pub end: u64,
    #[serde(default = "default_tz")]
    pub timezone: String,
    #[serde(default)]
    pub venue_label: String,
    pub domain: String,
    #[serde(default)]
    pub door_auth_pubkey: Option<String>,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub d_tag: Option<String>,
    #[serde(default)]
    pub zkid: Option<u64>,
    #[serde(default)]
    pub metadata_uri: Option<String>,
    #[serde(default)]
    pub metadata_path: Option<String>,
    #[serde(default)]
    pub curator: Option<String>,
    #[serde(default)]
    pub service_key: Option<String>,
    #[serde(default)]
    pub coordinators: Vec<String>,
    #[serde(default)]
    pub ushers: Vec<String>,
    #[serde(default)]
    pub sponsors: Vec<SponsorSpec>,
    #[serde(default)]
    pub lineup: Vec<LineupSpec>,
    #[serde(default)]
    pub tiers: Vec<TierSpec>,
    #[serde(default)]
    pub raffles: Vec<RaffleSpec>,
    #[serde(default)]
    pub faq: Vec<FaqSpec>,
    #[serde(default)]
    pub extra_tags: Vec<Vec<String>>,
}

fn default_status() -> String {
    "announced".into()
}
fn default_start() -> u64 {
    START_UNIX
}
fn default_end() -> u64 {
    END_UNIX
}
fn default_tz() -> String {
    "Africa/Dakar".into()
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
enum EventSpecFile {
    Wrapped { events: Vec<EventSpec> },
    Many(Vec<EventSpec>),
    One(EventSpec),
}

impl From<&LanternNight> for EventSpec {
    fn from(ev: &LanternNight) -> Self {
        let mut s = Self {
            id: ev.id.clone(),
            name: ev.name.clone(),
            status: "announced".into(),
            start: START_UNIX,
            end: END_UNIX,
            timezone: ev.timezone.clone(),
            venue_label: ev.venue_label.clone(),
            domain: ev.domain.clone(),
            door_auth_pubkey: Some(door_auth_hex()),
            summary: ev.summary.clone(),
            content: ev.content.clone(),
            location: ev.location.clone(),
            d_tag: Some(ev.d_tag.clone()),
            zkid: ev.zkid,
            metadata_uri: Some(format!("{}/lantern-night-nip52.json", ev.domain.trim_end_matches('/'))),
            metadata_path: None,
            curator: None,
            service_key: None,
            coordinators: vec![],
            ushers: vec![],
            sponsors: vec![
                SponsorSpec {
                    id: "sp-copper-dome-press".into(),
                    name: "Copper Dome Press".into(),
                    tier: "presenting".into(),
                    note: "Printed the night's poster and programmes.".into(),
                    url: None,
                    example: true,
                },
                SponsorSpec {
                    id: "sp-harbor-row-collective".into(),
                    name: "Harbor Row Collective".into(),
                    tier: "community".into(),
                    note: "Neighborhood support for the copper lantern.".into(),
                    url: None,
                    example: true,
                },
            ],
            lineup: vec![
                LineupSpec { id: "slot-01".into(), index: 0, role: "host".into(), handle: "Door welcome".into(), start: START_UNIX, duration_min: 30, lane: "yard".into() },
                LineupSpec { id: "slot-02".into(), index: 1, role: "dj".into(), handle: "Mirelle Voss".into(), start: START_UNIX, duration_min: 60, lane: "alcove".into() },
                LineupSpec { id: "slot-03".into(), index: 2, role: "other".into(), handle: "The Night Palms".into(), start: START_UNIX, duration_min: 45, lane: "cellar".into() },
                LineupSpec { id: "slot-04".into(), index: 3, role: "dj".into(), handle: "Juniper Vale".into(), start: START_UNIX + 1800, duration_min: 90, lane: "floor".into() },
                LineupSpec { id: "slot-05".into(), index: 4, role: "other".into(), handle: "Hollow Finch".into(), start: START_UNIX + 45 * 60, duration_min: 75, lane: "cellar".into() },
                LineupSpec { id: "slot-06".into(), index: 5, role: "dj".into(), handle: "Pearl Radio".into(), start: START_UNIX + 3600, duration_min: 60, lane: "alcove".into() },
                LineupSpec { id: "slot-07".into(), index: 6, role: "flow".into(), handle: "Oat & Ember".into(), start: START_UNIX + 3600, duration_min: 90, lane: "yard".into() },
                LineupSpec { id: "slot-08".into(), index: 7, role: "other".into(), handle: "Red Kite Ensemble".into(), start: START_UNIX + 2 * 3600, duration_min: 90, lane: "cellar".into() },
                LineupSpec { id: "slot-09".into(), index: 8, role: "dj".into(), handle: "Cassette Harbor".into(), start: START_UNIX + 2 * 3600, duration_min: 120, lane: "floor".into() },
                LineupSpec { id: "slot-10".into(), index: 9, role: "other".into(), handle: "Vesper Quay".into(), start: START_UNIX + 3 * 3600, duration_min: 120, lane: "yard".into() },
                LineupSpec { id: "slot-11".into(), index: 10, role: "dj".into(), handle: "Lampblack".into(), start: START_UNIX + 4 * 3600, duration_min: 60, lane: "floor".into() },
            ],
            tiers: vec![
                TierSpec { id: "gallery".into(), label: "Gallery".into(), guest_weight: 1, list_cents: 2500, supply: Some(40), rails: default_rails() },
                TierSpec { id: "floor".into(), label: "Floor".into(), guest_weight: 1, list_cents: 4000, supply: Some(120), rails: default_rails() },
                TierSpec { id: "door".into(), label: "Door".into(), guest_weight: 1, list_cents: 5500, supply: Some(40), rails: default_rails() },
            ],
            raffles: vec![
                RaffleSpec { id: "rf-lithograph".into(), title: "Harbor Lithograph".into(), note: "A signed print held at the records table.".into(), entries: 80, status: "open".into() },
                RaffleSpec { id: "rf-lantern-print".into(), title: "Copper Lantern print".into(), note: "Workshop print from the alcove stair.".into(), entries: 120, status: "open".into() },
                RaffleSpec { id: "rf-listening".into(), title: "After-hours listening pass".into(), note: "A seat at the Northferry table after last set.".into(), entries: 60, status: "open".into() },
            ],
            faq: vec![
                FaqSpec {
                    id: "faq-ticket".into(),
                    question: "Is a booking a ticket?".into(),
                    answer: "No. Entry is a Speak-Ez Sessions pass issued for this night. A booking alone is not enough at the door.".into(),
                },
            ],
            extra_tags: vec![],
        };
        if s.id == "lantern-night-2027" && ev.domain == DOMAIN {
            s.extra_tags = ev.nip52_tags().into_iter().filter_map(|t| serde_json::from_str::<Vec<String>>(&t).ok()).filter(|v| {
                matches!(v.first().map(|x| x.as_str()), Some("door-price" | "stage" | "artist" | "vendor" | "gallery"))
            }).collect();
        }
        s
    }
}

impl EventSpec {
    pub fn load_many_from_path(path: &Path) -> anyhow::Result<Vec<Self>> {
        let raw = std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("read event spec {}: {e}", path.display()))?;
        Self::parse_many_str(&raw)
    }

    pub fn parse_many_str(raw: &str) -> anyhow::Result<Vec<Self>> {
        let parsed: EventSpecFile = serde_json::from_str(raw)?;
        let specs = match parsed {
            EventSpecFile::Wrapped { events } => events,
            EventSpecFile::Many(events) => events,
            EventSpecFile::One(event) => vec![event],
        };
        if specs.is_empty() {
            anyhow::bail!("event spec list is empty");
        }
        for s in &specs {
            let _ = event_id_fp_hex(&s.id)?;
            if s.end <= s.start {
                anyhow::bail!("event {} has end <= start", s.id);
            }
            let d = s.domain.trim();
            let d_low = d.to_ascii_lowercase();
            let rest = d_low
                .strip_prefix("https://")
                .or_else(|| d_low.strip_prefix("http://"))
                .ok_or_else(|| anyhow::anyhow!("event {} domain must start with http:// or https://", s.id))?;
            let hostport = rest.strip_suffix('/').unwrap_or(rest);
            if hostport.is_empty() || hostport.contains('/') {
                anyhow::bail!("event {} domain {} must be an origin without a path", s.id, s.domain);
            }
        }
        Ok(specs)
    }

    pub fn validate_for_remote(&self) -> anyhow::Result<()> {
        let d = self.domain.trim().to_ascii_lowercase();
        if d.contains("127.0.0.1") || d.contains("localhost") {
            anyhow::bail!("refusing remote deploy/curate with loopback domain {} on event {}", self.domain, self.id);
        }
        if self.sponsors.iter().any(|sp| sp.example) {
            anyhow::bail!("refusing remote deploy/curate with example=true sponsor on event {}", self.id);
        }
        if let Some(uri) = &self.metadata_uri {
            let u = uri.trim().to_ascii_lowercase();
            if u.contains("127.0.0.1") || u.contains("localhost") {
                anyhow::bail!("refusing remote deploy/curate with loopback metadata_uri {} on event {}", uri, self.id);
            }
        }
        Ok(())
    }

    pub fn resolved_d_tag(&self) -> &str {
        self.d_tag.as_deref().filter(|s| !s.is_empty()).unwrap_or(&self.id)
    }

    pub fn resolved_metadata_uri(&self) -> String {
        if let Some(uri) = self.metadata_uri.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            return uri.to_string();
        }
        format!("{}/{}-nip52.json", self.domain.trim_end_matches('/'), self.id)
    }

    pub fn nip52_tags(&self) -> Vec<String> {
        let tag = |xs: Vec<String>| serde_json::to_string(&xs).unwrap();
        let mut tags = vec![
            tag(vec!["d".into(), self.resolved_d_tag().into()]),
            tag(vec!["title".into(), self.name.clone()]),
            tag(vec!["summary".into(), self.summary.clone()]),
            tag(vec!["location".into(), self.location.clone()]),
            tag(vec!["start".into(), self.start.to_string()]),
            tag(vec!["end".into(), self.end.to_string()]),
        ];
        for s in &self.lineup {
            let end_ts = s.start + (s.duration_min as u64) * 60;
            tags.push(tag(vec![
                "set".into(),
                s.lane.clone(),
                s.handle.clone(),
                s.start.to_string(),
                end_ts.to_string(),
                s.role.clone(),
                s.id.clone(),
            ]));
        }
        for sp in &self.sponsors {
            tags.push(tag(vec![
                "sponsor".into(),
                sp.id.clone(),
                sp.name.clone(),
                String::new(),
                sp.url.clone().unwrap_or_default(),
                sp.tier.clone(),
                sp.note.clone(),
            ]));
        }
        for row in &self.extra_tags {
            if !row.is_empty() {
                tags.push(tag(row.clone()));
            }
        }
        tags
    }

    pub fn nip52_document(&self) -> Value {
        let tags: Vec<Value> = self
            .nip52_tags()
            .into_iter()
            .map(|s| serde_json::from_str(&s).unwrap_or(json!([s])))
            .collect();
        let sponsors: Vec<Value> = self
            .sponsors
            .iter()
            .map(|sp| {
                let mut obj = json!({
                    "id": sp.id,
                    "name": sp.name,
                    "tier": sp.tier,
                    "note": sp.note,
                });
                if let Some(url) = &sp.url {
                    obj["url"] = json!(url);
                }
                if sp.example {
                    obj["example"] = json!(true);
                }
                obj
            })
            .collect();
        json!({
            "kind": 31923,
            "d": self.resolved_d_tag(),
            "content": self.content,
            "tags": tags,
            "sponsors": sponsors,
        })
    }

    pub fn write_metadata_file(&self, path: &Path) -> anyhow::Result<(String, String)> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(&self.nip52_document())?;
        let mut out = bytes;
        if !out.ends_with(b"\n") {
            out.push(b'\n');
        }
        std::fs::write(path, &out)?;
        let hash = hex::encode(Sha256::digest(&out));
        Ok((self.resolved_metadata_uri(), hash))
    }

    pub fn instantiate_msg(
        &self,
        curator: String,
        coordinators: String,
        usher_group: Option<String>,
        service_key: Option<String>,
        randomness: Option<String>,
        metadata_uri: Option<String>,
        metadata_hash: Option<String>,
    ) -> Value {
        json!({
            "curator": curator,
            "coordinators": coordinators,
            "randomness": randomness,
            "id": self.id,
            "name": self.name,
            "status": self.status,
            "start": nanos(self.start),
            "end": nanos(self.end),
            "timezone": self.timezone,
            "venue_label": if self.venue_label.is_empty() { Value::Null } else { json!(self.venue_label) },
            "domain": self.domain,
            "door_auth_pubkey": self.door_auth_pubkey,
            "kind": 31923,
            "d_tag": self.resolved_d_tag(),
            "summary": self.summary,
            "content": self.content,
            "location": self.location,
            "tags": self.nip52_tags(),
            "metadata_uri": metadata_uri,
            "metadata_hash": metadata_hash,
            "service_key": service_key,
            "usher_group": usher_group,
            "zkid": self.zkid,
            "event_id_fp": event_id_fp_hex(&self.id).ok(),
            "domain_fp": Some(domain_fp_hex(&self.domain)),
        })
    }

    pub fn curate_msgs(
        &self,
        metadata_uri: Option<String>,
        metadata_hash: Option<String>,
    ) -> Vec<Value> {
        let tags = self.nip52_tags();
        let mut out = vec![json!({
            "set_nip52": {
                "body": {
                    "kind": 31923,
                    "d_tag": self.resolved_d_tag(),
                    "title": self.name,
                    "summary": self.summary,
                    "content": self.content,
                    "start": nanos(self.start),
                    "end": nanos(self.end),
                    "timezone": self.timezone,
                    "location": self.location,
                    "tags": tags,
                }
            }
        })];
        if !self.venue_label.is_empty() {
            out.push(json!({ "set_venue": { "label": self.venue_label } }));
        }
        if let (Some(uri), Some(hash)) = (metadata_uri, metadata_hash) {
            out.push(json!({ "set_metadata": { "uri": uri, "content_hash": hash } }));
        }
        if let Some(zkid) = self.zkid {
            out.push(json!({
                "set_zkid": {
                    "zkid": zkid,
                    "event_id_fp": event_id_fp_hex(&self.id).expect("event id fits field"),
                    "domain_fp": domain_fp_hex(&self.domain),
                }
            }));
        }
        for s in &self.lineup {
            out.push(json!({
                "upsert_lineup_slot": {
                    "slot": {
                        "id": s.id,
                        "index": s.index,
                        "role": s.role,
                        "handle": s.handle,
                        "start": nanos(s.start),
                        "duration_min": s.duration_min,
                        "lane": s.lane,
                    }
                }
            }));
        }
        for t in &self.tiers {
            out.push(json!({
                "upsert_tier": {
                    "tier": {
                        "id": t.id,
                        "label": t.label,
                        "guest_weight": t.guest_weight,
                        "list_cents": t.list_cents,
                        "discounts_bps": [],
                        "supply": t.supply,
                        "sold": 0,
                        "rails": t.rails,
                    }
                }
            }));
        }
        for p in &self.raffles {
            out.push(json!({
                "register_raffle_prize": {
                    "prize": {
                        "id": p.id,
                        "title": p.title,
                        "note": p.note,
                        "entries": p.entries,
                        "status": p.status,
                    }
                }
            }));
        }
        for f in &self.faq {
            out.push(json!({
                "upsert_faq": {
                    "item": {
                        "id": f.id,
                        "question": f.question,
                        "answer": f.answer,
                    }
                }
            }));
        }
        for sp in &self.sponsors {
            out.push(json!({
                "upsert_sponsor": {
                    "sponsor": {
                        "id": sp.id,
                        "handle": sp.name,
                        "note": sp.note,
                    }
                }
            }));
        }
        out
    }

    pub fn metadata_update_msgs(&self, metadata_uri: String, metadata_hash: String) -> Vec<Value> {
        let mut out = vec![json!({ "set_metadata": { "uri": metadata_uri, "content_hash": metadata_hash } })];
        for sp in &self.sponsors {
            out.push(json!({
                "upsert_sponsor": {
                    "sponsor": {
                        "id": sp.id,
                        "handle": sp.name,
                        "note": sp.note,
                    }
                }
            }));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lantern_night_instantiate_mentions_the_night() {
        let ev = LanternNight::default();
        let msg = ev.instantiate_msg(
            "terp1curator".into(),
            "terp1coordinators".into(),
            Some("terp1ushers".into()),
            Some("terp1service".into()),
            None,
            None,
            None,
        );
        let name = msg["name"].as_str().unwrap_or_default();
        assert!(name.contains("Lantern Night"), "name {name}");
        assert_eq!(msg["timezone"], "Africa/Dakar");
        let curate = ev.curate_msgs(None, None);
        let dump = serde_json::to_string(&curate).unwrap();
        assert!(dump.contains("Mirelle Voss"));
        assert!(dump.contains("The Night Palms"));
        assert!(dump.contains("upsert_sponsor"));
        assert!(dump.contains("Copper Dome Press"));
        assert!(dump.contains("Harbor Row Collective"));
        assert!(!dump.to_lowercase().contains("lorem"));
        assert!(!dump.to_lowercase().contains("placeholder"));
        let doc = ev.nip52_document();
        let sponsors = doc.get("sponsors").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        assert_eq!(sponsors.len(), 2);
        assert_eq!(sponsors[0]["example"], true);
        let update = ev.metadata_update_msgs(
            "http://127.0.0.1:3051/lantern-night-nip52.json".into(),
            "ab".repeat(32),
        );
        let update_dump = serde_json::to_string(&update).unwrap();
        assert!(update_dump.contains("set_metadata"));
        assert!(update_dump.contains("upsert_sponsor"));
        assert!(!update_dump.contains("upsert_lineup_slot"));
    }

    #[test]
    fn fingerprints_match_ticket_v2_encodings() {
        assert_eq!(
            event_id_fp_hex("lantern-night-2027").unwrap(),
            "6c616e7465726e2d6e696768742d323032370000000000000000000000000000"
        );
        assert_eq!(
            domain_fp_hex("http://127.0.0.1:3051"),
            "03a6fff6676e91187bf0c344d73effe0dbe81c2efeb5dd77f499a08bf5b90533"
        );
    }

    #[test]
    fn reject_domain_with_path() {
        let json = r#"{
            "events": [{
                "id": "e1",
                "name": "Alpha",
                "domain": "https://permissionless.money/alpha/sezs"
            }]
        }"#;
        let err = EventSpec::parse_many_str(json).unwrap_err();
        assert!(format!("{err:#}").contains("origin without a path"));
    }

    #[test]
    fn event_spec_parses_array_and_rejects_example_or_loopback_on_remote() {
        let raw = r#"{
          "events": [
            {
              "id": "alpha-night-1",
              "name": "Alpha Night One",
              "start": 1800000000,
              "end": 1800018000,
              "domain": "https://permissionless.money",
              "sponsors": [{ "id": "sp-1", "name": "Real Co", "tier": "presenting", "note": "Live", "example": false }]
            },
            {
              "id": "alpha-night-2",
              "name": "Alpha Night Two",
              "start": 1800086400,
              "end": 1800104400,
              "domain": "http://127.0.0.1:3051",
              "sponsors": [{ "id": "sp-2", "name": "Mock Co", "example": true }]
            }
          ]
        }"#;
        let specs = EventSpec::parse_many_str(raw).unwrap();
        assert_eq!(specs.len(), 2);
        assert!(specs[0].validate_for_remote().is_ok());
        assert_eq!(
            specs[0].resolved_metadata_uri(),
            "https://permissionless.money/alpha-night-1-nip52.json"
        );
        assert!(specs[1].validate_for_remote().is_err());
    }
}

