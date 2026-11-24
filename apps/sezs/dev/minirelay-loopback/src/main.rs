//! Lab / e2e wrapper around Zafu minirelay.
//! Always binds 127.0.0.1 (or ::1). Refuses any other bind address.
//! Sweep interval is configurable so retention can be exercised without waiting a minute.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use minirelay::config::Config;
use minirelay::server::{app, AppState};
use minirelay::store::Store;
use minirelay::strategy;

fn loopback_bind(port: u16) -> Result<SocketAddr, String> {
    let raw = std::env::var("MINIRELAY_BIND").unwrap_or_else(|_| "127.0.0.1".to_string());
    let host = raw.trim();
    match host {
        "127.0.0.1" | "localhost" => Ok(SocketAddr::from(([127, 0, 0, 1], port))),
        "::1" => Ok(SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port))),
        _ => Err(format!(
            "sezs-minirelay-loopback: refusing bind {host:?}; test/dev may only bind 127.0.0.1 or ::1"
        )),
    }
}

#[tokio::main]
async fn main() {
    let config = Config::from_env();
    let addr = match loopback_bind(config.port) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };

    let store = match Store::open(
        &config.db_path,
        config.max_entries_per_coord,
        config.retention_seconds,
        config.scope_retention.clone(),
    ) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            eprintln!("minirelay: cannot open {}: {e}", config.db_path);
            std::process::exit(1);
        }
    };

    let sweep_ms: u64 = std::env::var("MINIRELAY_SWEEP_INTERVAL_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(60_000)
        .clamp(50, 3_600_000);

    let gc_store = Arc::clone(&store);
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(sweep_ms));
        loop {
            ticker.tick().await;
            match gc_store.gc() {
                Ok(0) => {}
                Ok(n) => eprintln!("minirelay: retention dropped {n} entries"),
                Err(e) => eprintln!("minirelay: retention failed: {e}"),
            }
        }
    });

    let (service, enforced) = strategy::build(&config, store);
    eprintln!(
        "minirelay: policy {:?} (entries/put {}, entries/coordinate {}, retention {}s, sweep {}ms)",
        enforced.layers,
        enforced.max_entries_per_put,
        enforced.max_entries_per_coord,
        enforced.retention_seconds,
        sweep_ms
    );

    let router = app(AppState {
        service,
        max_entries_per_put: config.max_entries_per_put,
        max_body_bytes: config.max_body_bytes,
    });

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("minirelay: cannot bind {addr}: {e}");
            std::process::exit(1);
        }
    };
    eprintln!(
        "minirelay: listening on {addr} (db {}, retention {}s)",
        config.db_path, config.retention_seconds
    );

    if let Err(e) = axum::serve(
        listener,
        router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
    {
        eprintln!("minirelay: server error: {e}");
        std::process::exit(1);
    }
}
