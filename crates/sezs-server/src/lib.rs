//! SEZS backend server library.

pub mod app;
pub mod email;
pub mod secret_fields;
pub mod session;
pub mod ticketing;

pub use app::{spawn_sezs_http, SezsApp, SpawnedSezs};
pub use session::token::resolve_session_secret;
pub use session::{spawn_session_http, SessionHttpConfig, SpawnedServer};
