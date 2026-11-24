//! One-bind SEZS backend: session + ticketing mounted at /sezs (and /itl).
//! Does not start a second frost inbox listener (that was a bind clash risk).

use sezs_server::{spawn_sezs_http, SezsApp};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let host = std::env::var("SEZS_SESSION_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = std::env::var("SEZS_BIND")
        .ok()
        .and_then(|s| s.parse().ok())
        .or_else(|| {
            std::env::var("SEZS_SESSION_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
        })
        .unwrap_or(3058);
    let state_dir = std::env::var("SEZS_STATE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(".session-state"));
    let app = SezsApp::from_env(state_dir)?;
    let server = spawn_sezs_http(&host, port, app).await?;
    println!(
        "sezs-server: listening on {}:{} (session + ticketing, one bind)",
        server.local.ip(),
        server.local.port()
    );
    tokio::signal::ctrl_c().await?;
    server.close().await;
    Ok(())
}
