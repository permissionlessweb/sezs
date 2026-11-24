//! Loopback HTTP: ble-helper paths plus sezs-0021 desk routes.
use crate::store::GrantStore;
use crate::transport::{SimulatedTransport, Transport};
use crate::verify::{BleError, OpenRoles, RoleChecks};
use axum::extract::{Path, Request, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

pub struct OutpostConfig {
    pub host: String,
    pub port: u16,
    pub store: GrantStore,
    pub transport: SimulatedTransport,
    pub roles: Arc<dyn RoleChecks>,
    pub allow_non_loopback: bool,
}

impl OutpostConfig {
    pub fn loopback(port: u16, store: GrantStore) -> Self {
        Self {
            host: "127.0.0.1".into(),
            port,
            store,
            transport: SimulatedTransport::new(),
            roles: Arc::new(OpenRoles),
            allow_non_loopback: false,
        }
    }
}

#[derive(Clone)]
struct AppState {
    store: Arc<GrantStore>,
    transport: Arc<Mutex<SimulatedTransport>>,
    roles: Arc<dyn RoleChecks>,
}

pub struct SpawnedOutpost {
    pub local: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
}

impl Drop for SpawnedOutpost {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
    }
}

fn json_resp(status: u16, body: Value) -> Response {
    Response::builder()
        .status(StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR))
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .body(axum::body::Body::from(body.to_string()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn health() -> Response {
    json_resp(200, json!({"ok": true, "service": "sezs-ble-helper"}))
}

async fn devices(State(s): State<Arc<AppState>>) -> Response {
    let t = s.transport.lock().await;
    json_resp(
        200,
        json!({"ok": true, "devices": t.devices().iter().map(|d| d.to_json()).collect::<Vec<_>>()}),
    )
}

async fn read_json(req: Request) -> Result<Value, Response> {
    let bytes = axum::body::to_bytes(req.into_body(), 64 * 1024)
        .await
        .map_err(|_| json_resp(200, json!({"ok": false, "error": "bad_request"})))?;
    if bytes.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| json_resp(200, json!({"ok": false, "error": "bad_request"})))
}

async fn simulate(State(s): State<Arc<AppState>>, req: Request) -> Response {
    let body = match read_json(req).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let mut t = s.transport.lock().await;
    let n = t.devices().len() + 1;
    let id = body
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("sim-{n}"));
    let label = body
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or(&id)
        .to_string();
    let d = t.simulate(
        id,
        label,
        body.get("publicHex")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        body.get("noiseHex")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    );
    json_resp(200, json!({"ok": true, "device": d.to_json()}))
}

async fn connect(State(s): State<Arc<AppState>>, req: Request) -> Response {
    let body = match read_json(req).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let id = body.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let mut t = s.transport.lock().await;
    match t.connect(id) {
        Ok(d) => json_resp(200, json!({"ok": true, "device": d.to_json()})),
        Err(e) => json_resp(200, json!({"ok": false, "error": e})),
    }
}

async fn disconnect(State(s): State<Arc<AppState>>, req: Request) -> Response {
    let body = match read_json(req).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let id = body.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let mut t = s.transport.lock().await;
    let _ = t.disconnect(id);
    json_resp(200, json!({"ok": true}))
}

async fn ingest(State(s): State<Arc<AppState>>, req: Request) -> Response {
    let body = match read_json(req).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let id = body
        .get("id")
        .or_else(|| body.get("deviceId"))
        .and_then(|v| v.as_str());
    let frame = body.get("frame").cloned().unwrap_or(body.clone());
    let mut t = s.transport.lock().await;
    match t.ingest(
        id,
        frame,
        body.get("publicHex")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        body.get("noiseHex")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    ) {
        Ok(()) => json_resp(200, json!({"ok": true})),
        Err(e) => json_resp(200, json!({"ok": false, "error": e})),
    }
}

async fn next_frame(State(s): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    let mut t = s.transport.lock().await;
    match t.next(&id) {
        Some(frame) => json_resp(200, json!({"ok": true, "frame": frame})),
        None => json_resp(200, json!({"ok": true, "frame": null})),
    }
}

async fn ack() -> Response {
    json_resp(200, json!({"ok": true}))
}

// Desk routes (sezs-0021)
async fn grants(State(s): State<Arc<AppState>>) -> Response {
    json_resp(200, json!({"ok": true, "devices": s.store.list()}))
}

async fn grant_put(State(s): State<Arc<AppState>>, req: Request) -> Response {
    let body = match read_json(req).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let grant_text = body
        .get("grantText")
        .or_else(|| body.get("grant").and_then(|g| g.get("text")))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let admin_sig = body
        .get("adminSig")
        .or_else(|| body.get("auth"))
        .cloned()
        .unwrap_or(Value::Null);
    let admin = body
        .get("admin")
        .or_else(|| admin_sig.get("signer"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let label = body.get("label").and_then(|v| v.as_str());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    match s
        .store
        .put_grant(grant_text, &admin_sig, admin, label, s.roles.as_ref(), now)
    {
        Ok(g) => json_resp(200, json!({"ok": true, "grant": g})),
        Err(e) => json_resp(200, json!({"ok": false, "error": e.as_str()})),
    }
}

async fn grant_rename(State(s): State<Arc<AppState>>, req: Request) -> Response {
    let body = match read_json(req).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let hash = body
        .get("hash")
        .or_else(|| body.get("grantHash"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let label = body.get("label").and_then(|v| v.as_str()).unwrap_or("");
    match s.store.rename(hash, label) {
        Ok(g) => json_resp(200, json!({"ok": true, "grant": g})),
        Err(e) => json_resp(200, json!({"ok": false, "error": e.as_str()})),
    }
}

async fn grant_revoke(State(s): State<Arc<AppState>>, req: Request) -> Response {
    let body = match read_json(req).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let hash = body
        .get("hash")
        .or_else(|| body.get("grantHash"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    match s.store.revoke(hash) {
        Ok(g) => json_resp(200, json!({"ok": true, "deleted": true, "grant": g})),
        Err(e) => json_resp(200, json!({"ok": false, "error": e.as_str()})),
    }
}

async fn desk_ingest(State(s): State<Arc<AppState>>, req: Request) -> Response {
    let body = match read_json(req).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let frame_text = body
        .get("frameText")
        .or_else(|| body.get("frame").and_then(|f| f.get("text")))
        .and_then(|v| v.as_str());
    if frame_text.is_none() {
        return json_resp(200, json!({"ok": false, "error": "missing_frame"}));
    }
    s.store.queue_ingest(json!({
        "frameText": frame_text,
        "frameSig": body.get("frameSig").or_else(|| body.get("frame").and_then(|f| f.get("sig"))),
        "grantHash": body.get("grantHash").or_else(|| body.get("frame").and_then(|f| f.get("grantHash"))),
        "source": body.get("source").and_then(|v| v.as_str()).unwrap_or("helper"),
    }));
    json_resp(200, json!({"ok": true}))
}

async fn desk_next(State(s): State<Arc<AppState>>) -> Response {
    match s.store.take_ingest() {
        Some(frame) => json_resp(200, json!({"ok": true, "frame": frame})),
        None => json_resp(200, json!({"ok": true, "frame": null})),
    }
}

async fn desk_verify(State(s): State<Arc<AppState>>, req: Request) -> Response {
    let body = match read_json(req).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let frame_text = body
        .get("frameText")
        .or_else(|| body.get("frame").and_then(|f| f.get("text")))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let frame_sig = body
        .get("frameSig")
        .or_else(|| body.get("frame").and_then(|f| f.get("sig")))
        .or_else(|| body.get("auth").and_then(|a| a.get("frameSig")))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if frame_text.is_empty() || frame_sig.is_empty() {
        return json_resp(
            200,
            json!({"ok": false, "error": BleError::MissingFrame.as_str()}),
        );
    }
    let grant_hash = body
        .get("grantHash")
        .or_else(|| body.get("frame").and_then(|f| f.get("grantHash")))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            crate::messages::decode_frame(frame_text)
                .ok()
                .map(|f| f.grant_hash)
        });
    let Some(hash) = grant_hash else {
        return json_resp(200, json!({"ok": false, "error": "unknown_device"}));
    };
    let Some(rec) = s.store.get(&hash) else {
        return json_resp(200, json!({"ok": false, "error": "unknown_device"}));
    };
    let consume = body.get("consume").cloned().unwrap_or(body.clone());
    let auth = body.get("auth").cloned().unwrap_or(Value::Null);
    let consume_text = auth
        .get("message")
        .and_then(|v| v.as_str())
        .or_else(|| body.get("consumeAuthText").and_then(|v| v.as_str()))
        .unwrap_or("");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let expected = body
        .get("eventId")
        .and_then(|v| v.as_str())
        .or_else(|| rec.grant.get("eventId").and_then(|v| v.as_str()));
    let seen = s.store.used_set();
    match crate::verify::verify_device_chain(
        &rec.grant_text,
        &rec.admin_sig,
        &rec.admin,
        &rec.status,
        frame_text,
        frame_sig,
        rec.last_seq,
        &seen,
        &consume,
        consume_text,
        &auth,
        expected,
        now,
        s.roles.as_ref(),
    ) {
        Ok((grant, frame, _)) => {
            s.store.remember_seq(&grant.hash, frame.seq, frame.ts);
            s.store.forget_openings();
            json_resp(
                200,
                json!({
                    "ok": true,
                    "grant": {"hash": grant.hash, "usher": grant.usher},
                    "frame": {"seq": frame.seq, "hash": frame.hash},
                }),
            )
        }
        Err(e) => json_resp(200, json!({"ok": false, "error": e.as_str()})),
    }
}

fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/devices", get(devices))
        .route("/v1/simulate", post(simulate))
        .route("/v1/connect", post(connect))
        .route("/v1/disconnect", post(disconnect))
        .route("/v1/ingest", post(ingest))
        .route("/v1/devices/:id/next", get(next_frame))
        .route("/v1/devices/:id/ack", post(ack))
        .route("/sezs/v2/door/device/grants", get(grants))
        .route("/sezs/v2/door/device/grant", post(grant_put))
        .route("/sezs/v2/door/device/rename", post(grant_rename))
        .route("/sezs/v2/door/device/revoke", post(grant_revoke))
        .route("/sezs/v2/door/device/ingest", post(desk_ingest))
        .route("/sezs/v2/door/device/next", get(desk_next))
        .route("/sezs/v2/door/device/verify", post(desk_verify))
        .with_state(state)
}

pub async fn spawn_outpost_http(cfg: OutpostConfig) -> anyhow::Result<SpawnedOutpost> {
    if cfg.host != "127.0.0.1" && cfg.host != "::1" && !cfg.allow_non_loopback {
        anyhow::bail!("outpost_bind_not_loopback");
    }
    let state = Arc::new(AppState {
        store: Arc::new(cfg.store),
        transport: Arc::new(Mutex::new(cfg.transport)),
        roles: cfg.roles,
    });
    let app = router(state);
    let listener = tokio::net::TcpListener::bind((cfg.host.as_str(), cfg.port)).await?;
    let local = listener.local_addr()?;
    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async {
            let _ = rx.await;
        })
        .await;
    });
    Ok(SpawnedOutpost {
        local,
        shutdown: Some(tx),
    })
}
