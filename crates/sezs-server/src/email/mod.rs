//! Email sign-in process (sezs-0012). Hidden on the public alpha by default.
pub mod service;
pub mod sink;
pub mod store;
pub mod token;

pub use service::{
    email_bind_message, email_hash_of, email_login_message, email_me_body, normalize_email,
    EmailAuth, EmailAuthConfig, HandlerOut,
};
pub use sink::{
    create_email_provider_from_env, resolve_email_from, EmailMessage, EmailProvider, FileSink,
    MemorySink, UnavailableSink, DEFAULT_EMAIL_FROM,
};
pub use store::EmailStore;
pub use token::{
    issue_pow_challenge, resolve_email_session_secret, sign_session_token, verify_pow_solution,
    verify_session_token,
};
