//! SezsService implementation: session + ticketing on one router.

use crate::secret_fields::refuse_secret_fields;
use crate::session::http::refuse_non_loopback;
use crate::session::roles::{parse_contracts, MainnetRoleReader};
use crate::session::service::{parse_allowed_origins, SessionService, SessionServiceConfig};
use crate::ticketing::door::Door;
use crate::ticketing::v2::{now_ms, TicketV2, DEFAULT_EVENT};
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use hash_market::sezs::{nest_sezs, SezsService};
use serde_json::Value;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

const MAX_BODY: usize = 8192;

pub struct SezsApp {
    session: Arc<SessionService>,
    tickets: Arc<TicketV2>,
    door: Arc<Door>,
}

impl SezsApp {
    pub fn from_env(state_dir: PathBuf) -> anyhow::Result<Self> {
        let contracts = parse_contracts(
            &std::env::var("SEZS_EVENT_CONTRACTS")
                .or_else(|_| std::env::var("SEZS_EVENT_CONTRACT"))
                .unwrap_or_default(),
        );
        let lcd = std::env::var("SEZS_EVENT_LCD")
            .or_else(|_| std::env::var("SEZS_LCD"))
            .unwrap_or_else(|_| "https://api.terp.network".into());
        let role_reader = if contracts.is_empty() {
            None
        } else {
            Some(MainnetRoleReader::new(lcd, contracts))
        };
        let session = SessionService::new(SessionServiceConfig {
            allowed_origins: parse_allowed_origins(
                std::env::var("SEZS_ALLOWED_ORIGINS").ok().as_deref(),
            ),
            rp_id: std::env::var("SEZS_WEBAUTHN_RP_ID").unwrap_or_default(),
            role_reader,
            db_path: std::env::var("SEZS_SESSION_DB")
                .unwrap_or_else(|_| state_dir.join("sessions.sqlite").to_string_lossy().into()),
            state_dir: Some(state_dir.clone()),
            session_secret: std::env::var("SEZS_SESSION_SECRET")
                .ok()
                .map(|s| s.into_bytes()),
            session_secret_file: std::env::var("SEZS_SESSION_SECRET_FILE").ok(),
            cookie_name: std::env::var("SEZS_COOKIE_NAME")
                .unwrap_or_else(|_| "sezs_session".into()),
            cookie_path: std::env::var("SEZS_COOKIE_PATH").unwrap_or_else(|_| "/".into()),
            secure_cookie: match std::env::var("SEZS_COOKIE_SECURE").ok().as_deref() {
                Some("1") => Some(true),
                Some("0") => Some(false),
                _ => None,
            },
            trust_proxy: std::env::var("SEZS_TRUST_PROXY").ok().as_deref() == Some("1"),
        })?;
        let tickets = TicketV2::new(
            &std::env::var("SEZS_EVENT_ID").unwrap_or_else(|_| DEFAULT_EVENT.into()),
            Some(state_dir),
        );
        Ok(Self {
            session: Arc::new(session),
            tickets: Arc::new(tickets),
            door: Arc::new(Door::new()),
        })
    }

    pub fn new_for_tests(session: SessionService, tickets: TicketV2) -> Self {
        Self {
            session: Arc::new(session),
            tickets: Arc::new(tickets),
            door: Arc::new(Door::new()),
        }
    }

    pub fn door(&self) -> Arc<Door> {
        self.door.clone()
    }

    pub fn tickets(&self) -> Arc<TicketV2> {
        self.tickets.clone()
    }
}

impl SezsService for SezsApp {
    fn routes(&self) -> Router {
        let state = Arc::new(self.clone_handles());
        Router::new()
            .route(
                "/session/health",
                get(session_dispatch).options(session_dispatch),
            )
            .route(
                "/session/challenge",
                post(session_dispatch).options(session_dispatch),
            )
            .route(
                "/session/verify",
                post(session_dispatch).options(session_dispatch),
            )
            .route(
                "/session/me",
                get(session_dispatch).options(session_dispatch),
            )
            .route(
                "/session/logout",
                post(session_dispatch).options(session_dispatch),
            )
            .route("/v2/event/roles", get(session_dispatch))
            .route("/v2/invoice", post(ticket_dispatch))
            .route("/v2/leaves", get(ticket_dispatch))
            .route("/v2/envelope", get(ticket_dispatch).post(ticket_dispatch))
            .route("/v2/paid", get(ticket_dispatch).post(ticket_dispatch))
            .route("/v2/seen", post(ticket_dispatch))
            .route("/v2/cancel", post(ticket_dispatch))
            .route("/v2/refund", post(ticket_dispatch))
            .route("/v2/door/consume", post(ticket_dispatch))
            .route("/v2/door/config", get(ticket_dispatch))
            .route("/door/consume", post(ticket_dispatch))
            .route("/pay/health", get(pay_dispatch))
            .route("/pay/quote", get(pay_dispatch))
            .route("/pay/instruct", get(pay_dispatch))
            .route("/pay/poll", get(pay_dispatch))
            .route("/pay/ticket", get(pay_dispatch).post(pay_dispatch))
            .route("/pay/watch", post(pay_dispatch))
            .with_state(state)
    }
}

struct Handles {
    session: Arc<SessionService>,
    tickets: Arc<TicketV2>,
    door: Arc<Door>,
}

impl SezsApp {
    fn clone_handles(&self) -> Handles {
        Handles {
            session: self.session.clone(),
            tickets: self.tickets.clone(),
            door: self.door.clone(),
        }
    }
}

fn headers_of(map: &HeaderMap) -> Vec<(String, String)> {
    map.iter()
        .filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string())))
        .collect()
}

fn json_response(status: u16, body: Value, extra: Vec<(String, String)>) -> Response {
    let mut builder = Response::builder()
        .status(StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR))
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store");
    for (k, v) in extra {
        builder = builder.header(k, v);
    }
    builder
        .body(axum::body::Body::from(body.to_string()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn session_dispatch(State(h): State<Arc<Handles>>, req: Request) -> Response {
    let method = req.method().as_str().to_string();
    let path = req.uri().path().to_string();
    let url = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| path.clone());
    let headers = headers_of(req.headers());
    let mut body = Value::Null;
    if method == "POST" {
        match read_json(req).await {
            Ok(v) => body = v,
            Err(resp) => return resp,
        }
    }
    let remote = "local";
    let full = if path.starts_with("/sezs/") {
        path.clone()
    } else {
        format!("/sezs{path}")
    };
    let result = match (method.as_str(), full.as_str()) {
        ("GET", "/sezs/session/health") => h.session.health(),
        ("POST", "/sezs/session/challenge") => h.session.challenge(&headers, remote, &body),
        ("POST", "/sezs/session/verify") => h.session.verify(&headers, remote, &body).await,
        ("GET", "/sezs/session/me") => h.session.me(&headers, &url).await,
        ("POST", "/sezs/session/logout") => h.session.logout(&headers),
        ("GET", "/sezs/v2/event/roles") => h.session.event_roles(&headers, remote, &url).await,
        _ => {
            return json_response(
                404,
                serde_json::json!({"ok": false, "error": "not_found"}),
                vec![],
            )
        }
    };
    json_response(result.status, result.body, result.headers)
}

async fn ticket_dispatch(State(h): State<Arc<Handles>>, req: Request) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let headers = headers_of(req.headers());
    let path = uri.path().to_string();
    let query = uri.query().unwrap_or("").to_string();
    let mut body = serde_json::json!({});
    if method == Method::POST {
        match read_json(req).await {
            Ok(v) => body = v,
            Err(resp) => return resp,
        }
        if let Some(refused) = refuse_secret_fields(&body) {
            return json_response(400, refused, vec![]);
        }
    }
    let full = if path.starts_with("/sezs/") {
        path.clone()
    } else {
        format!("/sezs{path}")
    };
    let now = now_ms();
    let role = cookie_role(&headers);
    let out = match (method.as_str(), full.as_str()) {
        ("POST", "/sezs/v2/invoice") => {
            let r = h.tickets.issue_invoice(&body, now);
            if r.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                if let Some(c) = r
                    .get("invoice")
                    .and_then(|i| i.get("commitment"))
                    .and_then(|v| v.as_str())
                {
                    h.door.on_invoice_issued(c);
                }
            }
            r
        }
        ("GET", "/sezs/v2/leaves") => h.tickets.leaves(),
        ("GET", "/sezs/v2/envelope") => {
            let id = query
                .split('&')
                .find_map(|p| p.strip_prefix("invoice="))
                .unwrap_or("");
            h.tickets.get_envelopes(id)
        }
        ("POST", "/sezs/v2/envelope") => h.tickets.put_envelope(&body, now),
        ("GET", "/sezs/v2/paid") => {
            let c = query
                .split('&')
                .find_map(|p| p.strip_prefix("commitment="))
                .unwrap_or("");
            match h.tickets.invoice_by_commitment(c) {
                Some(inv) => {
                    serde_json::json!({"ok": true, "status": inv.status, "commitment": inv.commitment})
                }
                None => serde_json::json!({"ok": false, "error": "unknown_invoice"}),
            }
        }
        ("POST", "/sezs/v2/paid") | ("POST", "/sezs/v2/seen") if full.ends_with("/seen") => {
            let c = body
                .get("commitment")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            h.tickets.mark_seen(
                c,
                body.get("txid").and_then(|v| v.as_str()),
                body.get("rail").and_then(|v| v.as_str()),
                now,
            )
        }
        ("POST", "/sezs/v2/paid") => {
            let r = h.tickets.ingest_paid_leaf(&body, now);
            if r.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                if let Some(c) = body.get("commitment").and_then(|v| v.as_str()) {
                    h.door.on_paid(c);
                }
            }
            r
        }
        ("POST", "/sezs/v2/cancel") => {
            let c = body
                .get("commitment")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match h.door.cancel(c) {
                Ok(()) => {
                    if let Some(inv) = h.tickets.invoice_by_commitment(c) {
                        let _ = h.tickets.void_invoice(&inv.id);
                    }
                    serde_json::json!({"ok": true, "cancelled": true, "p3": h.door.p3()})
                }
                Err(e) => serde_json::json!({"ok": false, "error": e}),
            }
        }
        ("POST", "/sezs/v2/refund") => {
            let c = body
                .get("commitment")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match h.door.refund(c) {
                Ok(()) => {
                    if let Some(inv) = h.tickets.invoice_by_commitment(c) {
                        let _ = h.tickets.void_invoice(&inv.id);
                    }
                    serde_json::json!({"ok": true, "refunded": true, "p3": h.door.p3()})
                }
                Err(e) => serde_json::json!({"ok": false, "error": e}),
            }
        }
        ("POST", "/sezs/v2/door/consume") | ("POST", "/sezs/door/consume") => {
            let c = body
                .get("commitment")
                .or_else(|| body.get("ticket"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match h.door.consume(c, &role) {
                Ok(()) => serde_json::json!({"ok": true, "admitted": true, "p1": h.door.p1()}),
                Err(e) => serde_json::json!({"ok": false, "error": e}),
            }
        }
        ("GET", "/sezs/v2/door/config") => serde_json::json!({
            "ok": true,
            "service": "sezs-ticketing",
            "suite": crate::ticketing::SUITE,
        }),
        _ => serde_json::json!({"ok": false, "error": "not_found"}),
    };
    let status = if out.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        200
    } else if out.get("error").and_then(|v| v.as_str()) == Some("not_found") {
        404
    } else if matches!(
        out.get("error").and_then(|v| v.as_str()),
        Some("not_usher") | Some("usher_cannot_issue") | Some("usher_cannot_forge")
    ) {
        403
    } else {
        400
    };
    json_response(status, out, vec![])
}

async fn pay_dispatch(req: Request) -> Response {
    let method = req.method().as_str().to_string();
    let path = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| req.uri().path().to_string());
    let full = if path.starts_with("/sezs/") {
        path
    } else if path.starts_with("/pay") {
        format!("/sezs{path}")
    } else {
        format!("/sezs/pay{path}")
    };
    let body = if method == "POST" {
        match read_json(req).await {
            Ok(v) => v.to_string(),
            Err(resp) => return resp,
        }
    } else {
        String::new()
    };
    match hash_market::onboard_authz::sezs_pay::try_handle(&method, &full, &body) {
        Some(r) => json_response(
            r.status,
            serde_json::from_str(&r.body).unwrap_or(serde_json::json!({"raw": r.body})),
            vec![],
        ),
        None => json_response(
            404,
            serde_json::json!({"ok": false, "error": "not_found"}),
            vec![],
        ),
    }
}

fn cookie_role(headers: &[(String, String)]) -> String {
    // Minimal: x-sezs-role or staff cookie role used by tests.
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("x-sezs-role"))
        .map(|(_, v)| v.clone())
        .unwrap_or_else(|| "guest".into())
}

async fn read_json(req: Request) -> Result<Value, Response> {
    if let Some(len) = req
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok())
    {
        if len > MAX_BODY {
            return Err(json_response(
                413,
                serde_json::json!({"ok": false, "error": "payload_too_large"}),
                vec![("connection".into(), "close".into())],
            ));
        }
    }
    let bytes = axum::body::to_bytes(req.into_body(), MAX_BODY)
        .await
        .map_err(|_| {
            json_response(
                413,
                serde_json::json!({"ok": false, "error": "payload_too_large"}),
                vec![("connection".into(), "close".into())],
            )
        })?;
    if bytes.is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_slice(&bytes).map_err(|_| {
        json_response(
            400,
            serde_json::json!({"ok": false, "error": "bad_json"}),
            vec![],
        )
    })
}

/// One-bind SEZS process: `/sezs` + `/itl` alias, no second frost listener.
pub async fn spawn_sezs_http(host: &str, port: u16, app: SezsApp) -> anyhow::Result<SpawnedSezs> {
    if refuse_non_loopback(host) {
        anyhow::bail!("sezs-server: refusing non-loopback bind without SEZS_ALLOW_NON_LOOPBACK=1");
    }
    let svc: Arc<dyn SezsService> = Arc::new(app);
    let router = nest_sezs(Router::new(), svc);
    let addr: SocketAddr = format!("{host}:{port}").parse()?;
    let listener = TcpListener::bind(addr).await?;
    let local = listener.local_addr()?;
    let (tx, rx) = oneshot::channel::<()>();
    let join = tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await;
    });
    Ok(SpawnedSezs {
        local,
        shutdown: Some(tx),
        join: Some(join),
    })
}

pub struct SpawnedSezs {
    pub local: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    join: Option<tokio::task::JoinHandle<()>>,
}

impl SpawnedSezs {
    pub async fn close(mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(join) = self.join.take() {
            let _ = join.await;
        }
    }
}
