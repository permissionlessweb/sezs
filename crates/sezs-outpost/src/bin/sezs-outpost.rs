//! Loopback-only Bluetooth outpost. Default bind 127.0.0.1:3061.
use sezs_outpost::{spawn_outpost_http, GrantStore, OutpostConfig};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let host = std::env::var("SEZS_OUTPOST_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = std::env::var("SEZS_BLE_HELPER_PORT")
        .or_else(|_| std::env::var("SEZS_OUTPOST_PORT"))
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3061);
    if host != "127.0.0.1"
        && host != "::1"
        && std::env::var("SEZS_ALLOW_NON_LOOPBACK").ok().as_deref() != Some("1")
    {
        anyhow::bail!("outpost HTTP must bind 127.0.0.1");
    }
    let store = GrantStore::open(std::env::var("SEZS_OUTPOST_STORE").ok().map(PathBuf::from));
    let mut cfg = OutpostConfig::loopback(port, store);
    cfg.host = host.clone();
    let spawned = spawn_outpost_http(cfg).await?;
    eprintln!("sezs-outpost listening on http://{}", spawned.local);
    tokio::signal::ctrl_c().await?;
    Ok(())
}
