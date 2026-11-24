//! Loopback HTTP server for the production session service.

use super::roles::{parse_contracts, MainnetRoleReader};
use super::service::{parse_allowed_origins, HandlerResult, SessionService, SessionServiceConfig};
use crate::secret_fields::refuse_secret_fields;
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

pub const MAX_BODY_BYTES: usize = 8192;
pub const BODY_TIMEOUT_MS: u64 = 5000;

pub struct SessionHttpConfig {
    pub host: String,
    pub port: u16,
    pub state_dir: PathBuf,
    pub db_path: Option<String>,
    pub allowed_origins: Option<String>,
    pub rp_id: String,
    pub cookie_name: String,
    pub cookie_path: String,
    pub secure_cookie: Option<bool>,
    pub trust_proxy: bool,
    pub session_secret: Option<Vec<u8>>,
    pub session_secret_file: Option<String>,
    pub lcd: String,
    pub contracts: String,
}

impl SessionHttpConfig {
    pub fn from_env() -> Self {
        let state_dir = std::env::var("SEZS_STATE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(".session-state"));
        let secure = match std::env::var("SEZS_COOKIE_SECURE").ok().as_deref() {
            Some("1") => Some(true),
            Some("0") => Some(false),
            _ => None,
        };
        Self {
            host: std::env::var("SEZS_SESSION_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            port: std::env::var("SEZS_SESSION_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(3058),
            state_dir,
            db_path: std::env::var("SEZS_SESSION_DB").ok(),
            allowed_origins: std::env::var("SEZS_ALLOWED_ORIGINS").ok(),
            rp_id: std::env::var("SEZS_WEBAUTHN_RP_ID").unwrap_or_default(),
            cookie_name: std::env::var("SEZS_COOKIE_NAME")
                .unwrap_or_else(|_| "sezs_session".into()),
            cookie_path: std::env::var("SEZS_COOKIE_PATH").unwrap_or_else(|_| "/".into()),
            secure_cookie: secure,
            trust_proxy: std::env::var("SEZS_TRUST_PROXY").ok().as_deref() == Some("1"),
            session_secret: std::env::var("SEZS_SESSION_SECRET")
                .ok()
                .map(|s| s.into_bytes()),
            session_secret_file: std::env::var("SEZS_SESSION_SECRET_FILE").ok(),
            lcd: std::env::var("SEZS_EVENT_LCD")
                .or_else(|_| std::env::var("SEZS_LCD"))
                .unwrap_or_else(|_| "https://api.terp.network".into()),
            contracts: std::env::var("SEZS_EVENT_CONTRACTS")
                .or_else(|_| std::env::var("SEZS_EVENT_CONTRACT"))
                .unwrap_or_default(),
        }
    }
}

/// Bind and serve in the background until `close` is called.
pub async fn spawn_session_http(cfg: SessionHttpConfig) -> anyhow::Result<SpawnedServer> {
    let host = cfg.host.clone();
    let port = cfg.port;
    let contracts = parse_contracts(&cfg.contracts);
    let role_reader = if contracts.is_empty() {
        None
    } else {
        Some(MainnetRoleReader::new(cfg.lcd.clone(), contracts))
    };
    let db_path = cfg.db_path.clone().unwrap_or_else(|| {
        cfg.state_dir
            .join("sessions.sqlite")
            .to_string_lossy()
            .into_owned()
    });
    let service = Arc::new(SessionService::new(SessionServiceConfig {
        allowed_origins: parse_allowed_origins(cfg.allowed_origins.as_deref()),
        rp_id: cfg.rp_id,
        role_reader,
        db_path,
        state_dir: Some(cfg.state_dir.clone()),
        session_secret: cfg.session_secret,
        session_secret_file: cfg.session_secret_file,
        cookie_name: cfg.cookie_name,
        cookie_path: cfg.cookie_path,
        secure_cookie: cfg.secure_cookie,
        trust_proxy: cfg.trust_proxy,
    })?);
    let addr: SocketAddr = format!("{host}:{port}").parse()?;
    let listener = TcpListener::bind(addr).await?;
    let local = listener.local_addr()?;
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let svc = service.clone();
    let join = tokio::spawn(async move {
        serve_loop(listener, svc, shutdown_rx).await;
    });
    Ok(SpawnedServer {
        local,
        shutdown: Some(shutdown_tx),
        join: Some(join),
    })
}

pub struct SpawnedServer {
    pub local: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    join: Option<tokio::task::JoinHandle<()>>,
}

impl SpawnedServer {
    pub async fn close(mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(join) = self.join.take() {
            let _ = join.await;
        }
    }
}

async fn serve_loop(
    listener: TcpListener,
    service: Arc<SessionService>,
    mut shutdown: oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            acc = listener.accept() => {
                let Ok((stream, remote)) = acc else { continue };
                let service = service.clone();
                tokio::spawn(async move {
                    let io = TokioIo::new(stream);
                    let svc = service_fn(move |req| {
                        let service = service.clone();
                        async move { handle(service, req, remote).await }
                    });
                    let _ = http1::Builder::new().keep_alive(true).serve_connection(io, svc).await;
                });
            }
        }
    }
}

async fn handle(
    service: Arc<SessionService>,
    req: Request<Incoming>,
    remote: SocketAddr,
) -> Result<Response<Full<Bytes>>, std::convert::Infallible> {
    Ok(handle_inner(service, req, remote).await)
}

async fn handle_inner(
    service: Arc<SessionService>,
    req: Request<Incoming>,
    remote: SocketAddr,
) -> Response<Full<Bytes>> {
    let method = req.method().as_str().to_string();
    let raw_url = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| req.uri().path().to_string());
    let path = {
        let p = raw_url.split('?').next().unwrap_or("/");
        let trimmed = p.trim_end_matches('/');
        if trimmed.is_empty() {
            "/".to_string()
        } else {
            trimmed.to_string()
        }
    };
    let headers: Vec<(String, String)> = req
        .headers()
        .iter()
        .filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string())))
        .collect();
    let content_len = req
        .headers()
        .get(hyper::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    if content_len > MAX_BODY_BYTES {
        return json_resp(
            413,
            serde_json::json!({"ok": false, "error": "payload_too_large"}),
            vec![("connection".into(), "close".into())],
        );
    }

    let mut body = serde_json::json!({});
    if method == "POST" {
        match read_bounded_json(req.into_body()).await {
            Ok(v) => body = v,
            Err((status, msg)) => {
                let extra = if status == 413 || status == 408 {
                    vec![("connection".into(), "close".into())]
                } else {
                    vec![]
                };
                return json_resp(
                    status,
                    serde_json::json!({"ok": false, "error": msg}),
                    extra,
                );
            }
        }
        if let Some(refused) = refuse_secret_fields(&body) {
            return json_resp(400, refused, vec![]);
        }
    }

    let remote_ip = remote.ip().to_string();
    let result: HandlerResult = match (method.as_str(), path.as_str()) {
        ("GET", "/sezs/session/health") => service.health(),
        ("POST", "/sezs/session/challenge") => service.challenge(&headers, &remote_ip, &body),
        ("POST", "/sezs/session/verify") => service.verify(&headers, &remote_ip, &body).await,
        ("GET", "/sezs/session/me") => service.me(&headers, &raw_url).await,
        ("POST", "/sezs/session/logout") => service.logout(&headers),
        ("GET", "/sezs/v2/event/roles") => {
            service.event_roles(&headers, &remote_ip, &raw_url).await
        }
        _ => HandlerResult {
            status: 404,
            body: serde_json::json!({"ok": false, "error": "not_found"}),
            headers: vec![],
        },
    };
    json_resp(result.status, result.body, result.headers)
}

async fn read_bounded_json(body: Incoming) -> Result<serde_json::Value, (u16, &'static str)> {
    let collected =
        tokio::time::timeout(std::time::Duration::from_millis(BODY_TIMEOUT_MS), async {
            let mut data = Vec::new();
            let mut incoming = body;
            while let Some(frame) = incoming.frame().await {
                let frame = frame.map_err(|_| (400, "bad_request"))?;
                if let Some(chunk) = frame.data_ref() {
                    if data.len().saturating_add(chunk.len()) > MAX_BODY_BYTES {
                        return Err((413, "payload_too_large"));
                    }
                    data.extend_from_slice(chunk);
                }
            }
            Ok::<Vec<u8>, (u16, &'static str)>(data)
        })
        .await
        .map_err(|_| (408, "body_timeout"))??;
    let raw = String::from_utf8_lossy(&collected).trim().to_string();
    if raw.is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(&raw).map_err(|_| (400, "bad_json"))
}

fn json_resp(
    status: u16,
    body: serde_json::Value,
    extra: Vec<(String, String)>,
) -> Response<Full<Bytes>> {
    let mut builder = Response::builder()
        .status(StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR))
        .header("content-type", "application/json")
        .header("cache-control", "no-store");
    for (k, v) in extra {
        builder = builder.header(k, v);
    }
    let bytes = serde_json::to_vec(&body).unwrap_or_else(|_| b"{\"ok\":false}".to_vec());
    builder
        .body(Full::new(Bytes::from(bytes)))
        .unwrap_or_else(|_| Response::new(Full::new(Bytes::from_static(b"{\"ok\":false}"))))
}

pub fn refuse_non_loopback(host: &str) -> bool {
    host != "127.0.0.1"
        && host != "::1"
        && std::env::var("SEZS_ALLOW_NON_LOOPBACK").ok().as_deref() != Some("1")
}

#[allow(dead_code)]
fn _keep_path(_: &Path) {}
