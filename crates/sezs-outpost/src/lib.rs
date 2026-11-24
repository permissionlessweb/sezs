//! First Rust Bluetooth outpost (sezs-0020 messages, sezs-0021 HTTP).
//!
//! Loopback HTTP only. Radio is behind a `Transport` trait; the first
//! version ships a simulated transport so tests run without BLE hardware.
//! Replaces `apps/sezs/dev/ble-helper`.

pub mod http;
pub mod messages;
pub mod store;
pub mod transport;
pub mod verify;

pub use http::{spawn_outpost_http, OutpostConfig, SpawnedOutpost};
pub use messages::{
    decode_consume_device, decode_frame, decode_grant, decode_usher_reg, encode_consume_device,
    encode_frame, encode_grant, encode_usher_reg, event_tag_hex, is_terp_addr, verify_frame_sig,
    CAP_SCAN_TICKET, CONSUME_DEVICE_DOMAIN, FRAME_DOMAIN, GRANT_DOMAIN, USHER_REG_DOMAIN,
};
pub use store::GrantStore;
pub use transport::{PublicDevice, SimulatedTransport, Transport};
pub use verify::{verify_device_chain, BleError, OpenRoles, RoleChecks};
