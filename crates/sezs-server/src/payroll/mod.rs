//! Event payroll desk (`/sezs/payroll/*`) plus the hash-market FROST inbox
//! policy, re-exported under the historical `itl_frost` name.
//!
//! Ceremony crypto is `sezs-frost-payroll` (in-process). The one-bind server
//! does not start a second frost-inbox listener.

pub mod service;
pub mod store;

pub use service::{share_urls, PayrollService, PayrollServiceConfig};
pub use store::{
    accept_signature, batch_digest, create_invite, execute_batch, generate_registration_key,
    hash_key, is_registration_key, list_public, load_payroll, mark_signing, propose_batch,
    register_with_key, save_payroll, set_amounts, truncate_addr, PayrollState, BATCH_STATUSES,
    KEY_PREFIX, ROLES,
};

/// hash-market `onboard_authz::sezs_frost`, historically `itl_frost`.
/// Domain strings still use the `itl-frost-` prefix (see sezs-0022).
pub use hash_market::onboard_authz::sezs_frost as itl_frost;
