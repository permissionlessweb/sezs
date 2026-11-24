//! One-bind SEZS backend. Currently serves the session process only.
//! Ticketing, email, and payroll will nest on this same listener.

use sezs_server::{spawn_session_http, SessionHttpConfig};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cfg = SessionHttpConfig::from_env();
    if sezs_server::session::http::refuse_non_loopback(&cfg.host) {
        eprintln!("sezs-session: refusing non-loopback bind without SEZS_ALLOW_NON_LOOPBACK=1");
        std::process::exit(2);
    }
    let server = spawn_session_http(cfg).await?;
    println!(
        "sezs-session: listening on {}:{}",
        server.local.ip(),
        server.local.port()
    );
    tokio::signal::ctrl_c().await?;
    server.close().await;
    Ok(())
}
