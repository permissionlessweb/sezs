//! Email sign-in runtime: request, verify, session, bind.

use super::sink::{EmailMessage, EmailProvider, DEFAULT_EMAIL_FROM};
use super::store::{BindChallenge, Challenge, EmailStore, Mailbox, VerifyOutcome};
use super::token::{
    issue_pow_challenge, sign_session_token, verify_pow_solution, verify_session_token,
};
use crate::session::passkey::{to_b64url, verify_passkey_assertion};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

const DEFAULT_ORIGINS: &[&str] = &["http://127.0.0.1:3051", "http://localhost:3051"];
const OTP_TTL_MS: i64 = 10 * 60 * 1000;
const BIND_TTL_MS: i64 = 2 * 60 * 1000;
const SESSION_TTL_MS: i64 = 12 * 60 * 60 * 1000;
const WINDOW_MS: i64 = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS: i64 = 30 * 1000;
const MAX_CODE_ATTEMPTS: i64 = 5;
const MAX_FAST_BUCKETS: usize = 10_000;
const MAX_USED_POW: usize = 10_000;

#[derive(Clone)]
pub struct Clock {
    inner: Arc<Mutex<Option<i64>>>,
}

impl Clock {
    pub fn system() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }
    pub fn set(&self, t: i64) {
        *self.inner.lock().unwrap() = Some(t);
    }
    pub fn now(&self) -> i64 {
        self.inner.lock().unwrap().unwrap_or_else(super_now)
    }
}

fn super_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn normalize_email(raw: &str) -> Option<String> {
    let email = raw.trim().to_lowercase();
    if email.is_empty() || email.len() > 254 {
        return None;
    }
    if !email.contains('@') || email.contains(' ') {
        return None;
    }
    let re = regex::Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").unwrap();
    if !re.is_match(&email) {
        return None;
    }
    let local = email.split('@').next().unwrap_or("");
    if local.len() > 64 {
        return None;
    }
    Some(email)
}

pub fn email_hash_of(email: &str) -> String {
    hex::encode(Sha256::digest(format!("sezs-email-v1\n{email}").as_bytes()))
}

pub fn email_login_message(origin: &str, email: &str, nonce: &str, ts: i64) -> String {
    format!(
        "SEZS-LOGIN-EMAIL-V1\norigin: {origin}\naudience: sezs\nemail: {email}\nnonce: {nonce}\nts: {ts}"
    )
}

pub fn email_bind_message(origin: &str, nonce: &str, ts: i64) -> String {
    format!("SEZS-EMAIL-BIND-V1\norigin: {origin}\naudience: sezs\nnonce: {nonce}\nts: {ts}")
}

pub fn email_me_body(record: &Value) -> Value {
    json!({
        "ok": true,
        "role": record.get("role"),
        "login_id": record.get("address"),
        "kind": record.get("kind"),
        "source": record.get("source"),
        "live": record.get("live"),
        "bound": record.get("bound"),
    })
}

pub fn parse_allowed_origins(raw: Option<&str>) -> std::collections::HashSet<String> {
    let list: Vec<String> = raw
        .unwrap_or("")
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if list.is_empty() {
        DEFAULT_ORIGINS.iter().map(|s| s.to_string()).collect()
    } else {
        list.into_iter().collect()
    }
}

#[derive(Clone, Default)]
pub struct HandlerOut {
    pub status: u16,
    pub body: Value,
    pub headers: Vec<(String, String)>,
}

pub struct EmailAuthConfig {
    pub allowed_origins: std::collections::HashSet<String>,
    pub provider: Arc<dyn EmailProvider>,
    pub email_from: String,
    pub db_path: String,
    pub state_dir: Option<PathBuf>,
    pub session_secret: Option<Vec<u8>>,
    pub cookie_name: String,
    pub clock: Clock,
    pub otp_ttl_ms: i64,
    pub bind_ttl_ms: i64,
    pub session_ttl_ms: i64,
    pub window_ms: i64,
    pub request_limit: usize,
    pub verify_limit: usize,
    pub ip_request_limit: usize,
    pub ip_verify_limit: usize,
    pub bind_limit: usize,
    pub resend_cooldown_ms: i64,
    pub max_code_attempts: i64,
    pub pow_bits: u32,
    pub adaptive_pow_threshold: usize,
    pub trust_proxy: bool,
    pub events: Arc<Mutex<Vec<Value>>>,
}

impl Default for EmailAuthConfig {
    fn default() -> Self {
        Self {
            allowed_origins: parse_allowed_origins(None),
            provider: Arc::new(super::sink::UnavailableSink),
            email_from: DEFAULT_EMAIL_FROM.into(),
            db_path: ":memory:".into(),
            state_dir: None,
            session_secret: None,
            cookie_name: "sezs_splash".into(),
            clock: Clock::system(),
            otp_ttl_ms: OTP_TTL_MS,
            bind_ttl_ms: BIND_TTL_MS,
            session_ttl_ms: SESSION_TTL_MS,
            window_ms: WINDOW_MS,
            request_limit: 3,
            verify_limit: 5,
            ip_request_limit: 30,
            ip_verify_limit: 60,
            bind_limit: 5,
            resend_cooldown_ms: RESEND_COOLDOWN_MS,
            max_code_attempts: MAX_CODE_ATTEMPTS,
            pow_bits: 0,
            adaptive_pow_threshold: 0,
            trust_proxy: false,
            events: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

pub struct EmailAuth {
    cfg: EmailAuthConfig,
    store: EmailStore,
    secret: Vec<u8>,
    fast: Mutex<HashMap<String, VecDeque<i64>>>,
    used_pow: Mutex<HashMap<String, i64>>,
}

impl EmailAuth {
    pub fn new(mut cfg: EmailAuthConfig) -> anyhow::Result<Self> {
        if cfg.allowed_origins.is_empty() {
            cfg.allowed_origins = parse_allowed_origins(None);
        }
        let secret = if let Some(s) = cfg.session_secret.clone() {
            if s.len() == 32 && !s.iter().all(|b| b.is_ascii()) {
                s
            } else {
                // Node hashes a string secret; we also hash bytes via sha256 unless already a digest.
                // Tests pass utf-8 "test-secret-only".
                Sha256::digest(&s).to_vec()
            }
        } else {
            super::token::resolve_email_session_secret(None, cfg.state_dir.as_deref(), &[])?
        };
        let store = EmailStore::open(&cfg.db_path)?;
        Ok(Self {
            cfg,
            store,
            secret,
            fast: Mutex::new(HashMap::new()),
            used_pow: Mutex::new(HashMap::new()),
        })
    }

    pub fn with_memory_provider(provider: Arc<dyn EmailProvider>) -> anyhow::Result<Self> {
        let mut cfg = EmailAuthConfig::default();
        cfg.provider = provider;
        Self::new(cfg)
    }

    pub fn clock(&self) -> &Clock {
        &self.cfg.clock
    }

    pub fn events(&self) -> Vec<Value> {
        self.cfg.events.lock().unwrap().clone()
    }

    pub fn record_of(&self, token: &str) -> Option<Value> {
        let claims = verify_session_token(token, &self.secret, self.cfg.clock.now(), None)?;
        let active = self
            .store
            .get_active_session(&claims.sid, self.cfg.clock.now())?;
        Some(json!({
            "address": active.mailbox.login_id,
            "kind": "email",
            "role": "guest",
            "source": "session",
            "live": false,
            "exp": active.exp,
            "bound": public_bound(&active.mailbox),
        }))
    }

    pub fn handle(
        &self,
        method: &str,
        path: &str,
        headers: &[(String, String)],
        remote: &str,
        body: &Value,
    ) -> HandlerOut {
        match (method, path) {
            ("GET", "/sezs/auth/email/health") => self.health(),
            ("POST", "/sezs/auth/email/request") => self.request(headers, remote, body),
            ("POST", "/sezs/auth/email/verify") => self.verify(headers, remote, body),
            ("GET", "/sezs/auth/email/session") => self.session(headers, remote),
            ("POST", "/sezs/auth/email/logout") => self.logout(headers, remote),
            ("POST", "/sezs/auth/email/bind-challenge") => self.bind_challenge(headers, remote),
            ("POST", "/sezs/auth/email/bind") => self.bind(headers, remote, body),
            _ => out(404, json!({"ok": false, "error": "not_found"}), vec![]),
        }
    }

    fn health(&self) -> HandlerOut {
        out(
            200,
            json!({"ok": true, "service": "email-auth", "store": "sqlite", "powBits": self.cfg.pow_bits}),
            vec![],
        )
    }

    fn emit(&self, e: Value) {
        self.cfg.events.lock().unwrap().push(e);
    }

    fn prune_fast(&self, now: i64) {
        let window = self.cfg.window_ms;
        let mut g = self.fast.lock().unwrap();
        g.retain(|_, v| {
            v.retain(|ts| now - *ts < window);
            !v.is_empty()
        });
        let mut pow = self.used_pow.lock().unwrap();
        pow.retain(|_, exp| *exp > now);
        self.store.prune(now);
    }

    fn fast_peek_count(&self, key: &str, now: i64) -> usize {
        self.fast
            .lock()
            .unwrap()
            .get(key)
            .map(|v| {
                v.iter()
                    .filter(|ts| now - **ts < self.cfg.window_ms)
                    .count()
            })
            .unwrap_or(0)
    }

    fn fast_hit(&self, key: &str, limit: usize, now: i64) -> bool {
        let mut g = self.fast.lock().unwrap();
        let mut arr = g.get(key).cloned().unwrap_or_default();
        arr.retain(|ts| now - *ts < self.cfg.window_ms);
        if arr.len() >= limit {
            g.insert(key.into(), arr);
            return false;
        }
        if !g.contains_key(key) && g.len() >= MAX_FAST_BUCKETS {
            if let Some(oldest) = g.keys().next().cloned() {
                g.remove(&oldest);
            }
        }
        arr.push_back(now);
        g.insert(key.into(), arr);
        true
    }

    fn hit(&self, key: &str, limit: usize, now: i64) -> bool {
        if !self.fast_hit(key, limit, now) {
            return false;
        }
        self.store
            .hit_rate_limit(key, limit, self.cfg.window_ms, now)
    }

    fn origin_of(&self, headers: &[(String, String)]) -> Option<String> {
        let origin = header(headers, "origin")?;
        self.cfg.allowed_origins.contains(&origin).then_some(origin)
    }

    fn csrf_ok(&self, headers: &[(String, String)]) -> bool {
        header(headers, "x-sezs-csrf")
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    }

    fn ip_of(&self, headers: &[(String, String)], remote: &str) -> String {
        if self.cfg.trust_proxy {
            if let Some(fwd) = header(headers, "x-forwarded-for") {
                let first = fwd.split(',').next().unwrap_or("").trim();
                if !first.is_empty() {
                    return first.to_string();
                }
            }
            if let Some(real) = header(headers, "x-real-ip") {
                if !real.trim().is_empty() {
                    return real;
                }
            }
        }
        if remote.is_empty() {
            "local".into()
        } else {
            remote.to_string()
        }
    }

    fn cookie_of(&self, headers: &[(String, String)]) -> Option<String> {
        let cookie = header(headers, "cookie")?;
        let prefix = format!("{}=", self.cfg.cookie_name);
        for part in cookie.split(';') {
            let p = part.trim();
            if let Some(rest) = p.strip_prefix(&prefix) {
                if !rest.is_empty() && rest.len() <= 640 {
                    return Some(rest.to_string());
                }
            }
        }
        None
    }

    fn cookie_header(&self, token: &str, origin: &str, clear: bool) -> (String, String) {
        let secure = if origin.starts_with("https://") {
            "; Secure"
        } else {
            ""
        };
        let attrs = format!("Path=/; HttpOnly; SameSite=Strict{secure}");
        let val = if clear {
            format!("{}=; Max-Age=0; {attrs}", self.cfg.cookie_name)
        } else {
            format!("{}={token}; {attrs}", self.cfg.cookie_name)
        };
        ("set-cookie".into(), val)
    }

    fn request(&self, headers: &[(String, String)], remote: &str, body: &Value) -> HandlerOut {
        let now = self.cfg.clock.now();
        self.prune_fast(now);
        let Some(origin) = self.origin_of(headers) else {
            return out(403, json!({"ok": false, "error": "origin_refused"}), vec![]);
        };
        if !self.csrf_ok(headers) {
            return out(403, json!({"ok": false, "error": "csrf_required"}), vec![]);
        }
        let Some(email) = body
            .get("email")
            .and_then(|v| v.as_str())
            .and_then(normalize_email)
        else {
            return out(400, json!({"ok": false, "error": "bad_email"}), vec![]);
        };
        let hash = email_hash_of(&email);
        let ip = self.ip_of(headers, remote);
        let ip_hash = hex::encode(&Sha256::digest(format!("ip:{ip}").as_bytes())[..12]);

        if !self.hit(&format!("ipreq:{ip}"), self.cfg.ip_request_limit, now) {
            return out(429, json!({"ok": false, "error": "rate_limited"}), vec![]);
        }
        if !self.hit(&format!("req:{hash}:{origin}"), self.cfg.request_limit, now) {
            return out(429, json!({"ok": false, "error": "rate_limited"}), vec![]);
        }

        let need_bits = if self.cfg.pow_bits > 0 {
            self.cfg.pow_bits
        } else if self.cfg.adaptive_pow_threshold > 0
            && self.fast_peek_count(&format!("ipreq:{ip}"), now) > self.cfg.adaptive_pow_threshold
        {
            12
        } else {
            0
        };
        if need_bits > 0 {
            let pow = body.get("pow");
            let mut used = self.used_pow.lock().unwrap();
            let ok = pow
                .map(|p| {
                    let salt = p.get("salt").and_then(|v| v.as_str()).unwrap_or("");
                    !used.contains_key(salt)
                        && verify_pow_solution(p, &origin, &ip_hash, need_bits, now, &self.secret)
                })
                .unwrap_or(false);
            if !ok {
                let ch =
                    issue_pow_challenge(&origin, &ip_hash, need_bits, now, 120_000, &self.secret);
                return out(
                    428,
                    json!({"ok": false, "error": "pow_required", "pow": ch}),
                    vec![],
                );
            }
            if let Some(p) = pow {
                if used.len() >= MAX_USED_POW {
                    if let Some(first) = used.keys().next().cloned() {
                        used.remove(&first);
                    }
                }
                let salt = p.get("salt").and_then(|v| v.as_str()).unwrap_or("");
                let exp = p.get("exp").and_then(|v| v.as_i64()).unwrap_or(0);
                used.insert(salt.to_string(), exp);
            }
        }

        let key = format!("{hash}:{origin}");
        if let Some(prior) = self.store.get_challenge(&key) {
            if now - prior.issued_at < self.cfg.resend_cooldown_ms {
                return out(200, json!({"ok": true, "status": "awaiting"}), vec![]);
            }
        }

        let mut nonce_bytes = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = hex::encode(nonce_bytes);
        let ts = now;
        let message = email_login_message(&origin, &email, &nonce, ts);
        let code = format!("{:06}", rand::thread_rng().gen_range(0..1_000_000u32));
        let secret_hash = hex::encode(Sha256::digest(
            format!("{message}\ncode: {code}").as_bytes(),
        ));
        let minutes = (self.cfg.otp_ttl_ms as f64 / 60_000.0).round() as i64;
        let text = format!(
            "Your SEZS sign-in code is {code}. It expires in {minutes} minutes and works once.\n\nOr open this link on the same device: {origin}/?email_code={code}&email={}\n\nIf you did not request this, ignore this message.",
            urlencoding(&email)
        );
        let send = self.cfg.provider.send_email(EmailMessage {
            to: email.clone(),
            from: self.cfg.email_from.clone(),
            subject: "Your SEZS sign-in code".into(),
            text,
            token_ref: Some(nonce.clone()),
            at: 0,
        });
        if send.is_err() {
            self.emit(json!({"kind":"request","emailHash":hash,"origin":origin,"ok":false}));
            return out(
                503,
                json!({"ok": false, "error": "delivery_unavailable"}),
                vec![],
            );
        }
        self.store.put_challenge(&Challenge {
            key,
            email_hash: hash.clone(),
            origin: origin.clone(),
            nonce,
            ts,
            issued_at: now,
            exp: now + self.cfg.otp_ttl_ms,
            attempts: 0,
            secret_hash,
        });
        self.emit(json!({"kind":"request","emailHash":hash,"origin":origin,"ok":true}));
        out(200, json!({"ok": true, "status": "awaiting"}), vec![])
    }

    fn verify(&self, headers: &[(String, String)], remote: &str, body: &Value) -> HandlerOut {
        let now = self.cfg.clock.now();
        let Some(origin) = self.origin_of(headers) else {
            return out(403, json!({"ok": false, "error": "origin_refused"}), vec![]);
        };
        if !self.csrf_ok(headers) {
            return out(403, json!({"ok": false, "error": "csrf_required"}), vec![]);
        }
        let Some(email) = body
            .get("email")
            .and_then(|v| v.as_str())
            .and_then(normalize_email)
        else {
            return out(400, json!({"ok": false, "error": "bad_email"}), vec![]);
        };
        let code = body
            .get("code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if !regex::Regex::new(r"^\d{6}$").unwrap().is_match(&code) {
            return out(400, json!({"ok": false, "error": "bad_code"}), vec![]);
        }
        let hash = email_hash_of(&email);
        let ip = self.ip_of(headers, remote);
        if !self.hit(&format!("ipver:{ip}"), self.cfg.ip_verify_limit, now) {
            return out(429, json!({"ok": false, "error": "rate_limited"}), vec![]);
        }
        if !self.hit(&format!("ver:{hash}:{origin}"), self.cfg.verify_limit, now) {
            return out(429, json!({"ok": false, "error": "rate_limited"}), vec![]);
        }
        let key = format!("{hash}:{origin}");
        let email_for_check = email.clone();
        let outcome = self
            .store
            .verify_and_consume(&key, now, self.cfg.max_code_attempts, |ch| {
                let message = email_login_message(&ch.origin, &email_for_check, &ch.nonce, ch.ts);
                let candidate = Sha256::digest(format!("{message}\ncode: {code}").as_bytes());
                let Ok(expected) = hex::decode(&ch.secret_hash) else {
                    return false;
                };
                expected.len() == candidate.len()
                    && subtle::ConstantTimeEq::ct_eq(expected.as_slice(), candidate.as_slice())
                        .unwrap_u8()
                        == 1
            });
        self.store.prune(now);
        match outcome {
            VerifyOutcome::Unknown => out(
                400,
                json!({"ok": false, "error": "unknown_challenge"}),
                vec![],
            ),
            VerifyOutcome::Expired => out(400, json!({"ok": false, "error": "expired"}), vec![]),
            VerifyOutcome::BadCode { .. } => {
                self.emit(json!({"kind":"verify","emailHash":hash,"origin":origin,"ok":false}));
                out(400, json!({"ok": false, "error": "bad_code"}), vec![])
            }
            VerifyOutcome::Ok(_) => {
                let login_id = new_id("mail-", 8);
                let mailbox = self
                    .store
                    .get_or_create_mailbox(&hash, &email, &login_id, now);
                let prior = self
                    .cookie_of(headers)
                    .and_then(|t| verify_session_token(&t, &self.secret, now, None));
                let sid = new_id("sess-", 16);
                let exp = now + self.cfg.session_ttl_ms;
                self.store.create_session(
                    &sid,
                    &mailbox.email_hash,
                    &origin,
                    now,
                    exp,
                    prior.as_ref().map(|c| c.sid.as_str()),
                );
                let token = sign_session_token(
                    &sid,
                    &mailbox.login_id,
                    &mailbox.email_hash,
                    &origin,
                    now,
                    exp,
                    &self.secret,
                );
                self.emit(json!({"kind":"verify","emailHash":hash,"origin":origin,"ok":true}));
                out(
                    200,
                    json!({"ok": true, "email": email, "login_id": mailbox.login_id, "kind": "email", "bound": public_bound(&mailbox)}),
                    vec![self.cookie_header(&token, &origin, false)],
                )
            }
        }
    }

    fn session(&self, headers: &[(String, String)], _remote: &str) -> HandlerOut {
        let now = self.cfg.clock.now();
        self.store.prune(now);
        let Some(token) = self.cookie_of(headers) else {
            return out(401, json!({"ok": false, "error": "no_session"}), vec![]);
        };
        let Some(claims) = verify_session_token(&token, &self.secret, now, None) else {
            return out(401, json!({"ok": false, "error": "no_session"}), vec![]);
        };
        let Some(active) = self.store.get_active_session(&claims.sid, now) else {
            return out(401, json!({"ok": false, "error": "no_session"}), vec![]);
        };
        out(
            200,
            json!({
                "ok": true,
                "email": active.mailbox.email,
                "login_id": active.mailbox.login_id,
                "kind": "email",
                "bound": public_bound(&active.mailbox),
            }),
            vec![],
        )
    }

    fn logout(&self, headers: &[(String, String)], _remote: &str) -> HandlerOut {
        let now = self.cfg.clock.now();
        self.store.prune(now);
        let Some(origin) = self.origin_of(headers) else {
            return out(403, json!({"ok": false, "error": "origin_refused"}), vec![]);
        };
        if !self.csrf_ok(headers) {
            return out(403, json!({"ok": false, "error": "csrf_required"}), vec![]);
        }
        if let Some(token) = self.cookie_of(headers) {
            if let Some(claims) = verify_session_token(&token, &self.secret, now, None) {
                self.store.revoke_session(&claims.sid, now);
            }
        }
        out(
            200,
            json!({"ok": true}),
            vec![self.cookie_header("", &origin, true)],
        )
    }

    fn bind_challenge(&self, headers: &[(String, String)], _remote: &str) -> HandlerOut {
        let now = self.cfg.clock.now();
        self.store.prune(now);
        let Some(origin) = self.origin_of(headers) else {
            return out(403, json!({"ok": false, "error": "origin_refused"}), vec![]);
        };
        if !self.csrf_ok(headers) {
            return out(403, json!({"ok": false, "error": "csrf_required"}), vec![]);
        }
        let Some(active) = self.active_of(headers, now) else {
            return out(401, json!({"ok": false, "error": "no_session"}), vec![]);
        };
        if !self.hit(&format!("bind:{}", active.id), self.cfg.bind_limit, now) {
            return out(429, json!({"ok": false, "error": "rate_limited"}), vec![]);
        }
        let mut nonce_bytes = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = hex::encode(nonce_bytes);
        let ts = now;
        let message = email_bind_message(&origin, &nonce, ts);
        let challenge_hex = hex::encode(message.as_bytes());
        let challenge_b64 = to_b64url(message.as_bytes());
        self.store.put_bind_challenge(&BindChallenge {
            nonce: nonce.clone(),
            session_id: active.id,
            origin,
            ts,
            exp: ts + self.cfg.bind_ttl_ms,
            message: message.clone(),
        });
        out(
            200,
            json!({"ok": true, "nonce": nonce, "ts": ts, "message": message, "challengeHex": challenge_hex, "challengeB64": challenge_b64}),
            vec![],
        )
    }

    fn bind(&self, headers: &[(String, String)], _remote: &str, body: &Value) -> HandlerOut {
        let now = self.cfg.clock.now();
        self.store.prune(now);
        let Some(origin) = self.origin_of(headers) else {
            return out(403, json!({"ok": false, "error": "origin_refused"}), vec![]);
        };
        if !self.csrf_ok(headers) {
            return out(403, json!({"ok": false, "error": "csrf_required"}), vec![]);
        }
        let Some(active) = self.active_of(headers, now) else {
            return out(401, json!({"ok": false, "error": "no_session"}), vec![]);
        };
        let kind = body.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if kind != "ed25519/zid" && kind != "p256/passkey" {
            return out(400, json!({"ok": false, "error": "bad_kind"}), vec![]);
        }
        let nonce = body.get("nonce").and_then(|v| v.as_str()).unwrap_or("");
        if nonce.is_empty() {
            return out(400, json!({"ok": false, "error": "proof_required"}), vec![]);
        }
        let Some(ch) = self.store.take_bind_challenge(nonce) else {
            return out(
                400,
                json!({"ok": false, "error": "unknown_challenge"}),
                vec![],
            );
        };
        if ch.exp <= now {
            return out(400, json!({"ok": false, "error": "expired"}), vec![]);
        }
        if ch.session_id != active.id || ch.origin != origin {
            return out(
                403,
                json!({"ok": false, "error": "challenge_mismatch"}),
                vec![],
            );
        }
        let mailbox = active.mailbox;
        let updated = if kind == "ed25519/zid" {
            let zid = body
                .get("zidPubkey")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let sig = body
                .get("signature")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if zid.is_empty() || sig.is_empty() {
                return out(400, json!({"ok": false, "error": "proof_required"}), vec![]);
            }
            if !verify_zid(zid, &ch.message, sig) {
                return out(403, json!({"ok": false, "error": "bad_signature"}), vec![]);
            }
            self.store.bind_zid(&mailbox.email_hash, zid, now)
        } else {
            let cred_id = body
                .get("credId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let public_key = body
                .get("publicKey")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let assertion = body.get("assertion");
            if cred_id.is_empty() || public_key.is_empty() || assertion.is_none() {
                return out(400, json!({"ok": false, "error": "proof_required"}), vec![]);
            }
            let Some(cred_bytes) = crate::session::passkey::from_b64_any_pub(cred_id) else {
                return out(400, json!({"ok": false, "error": "proof_required"}), vec![]);
            };
            if cred_bytes.len() > 1024 {
                return out(400, json!({"ok": false, "error": "proof_required"}), vec![]);
            }
            let prev = mailbox.passkey.as_ref();
            let prev_count = if prev.map(|p| p.cred_id.as_str()) == Some(cred_id) {
                prev.map(|p| p.sign_count).unwrap_or(0)
            } else {
                0
            };
            let assertion = assertion.unwrap();
            let client = assertion
                .get("clientDataJSON")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let auth = assertion
                .get("authenticatorData")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let sig = assertion
                .get("signature")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let challenge_b64 = to_b64url(ch.message.as_bytes());
            match verify_passkey_assertion(
                &origin,
                None,
                &challenge_b64,
                public_key,
                client,
                auth,
                sig,
                prev_count,
            ) {
                Ok(ok) => self.store.bind_passkey(
                    &mailbox.email_hash,
                    cred_id,
                    public_key,
                    &ok.rp_id,
                    ok.sign_count,
                    now,
                ),
                Err(e) => {
                    let e = if e == "passkey_invalid_rp_id" {
                        "passkey_needs_localhost"
                    } else {
                        e
                    };
                    return out(403, json!({"ok": false, "error": e}), vec![]);
                }
            }
        };
        self.emit(json!({"kind":"bind","emailHash":mailbox.email_hash,"origin":origin,"ok":true}));
        out(
            200,
            json!({"ok": true, "kind": kind, "bound": public_bound(&updated)}),
            vec![],
        )
    }

    fn active_of(
        &self,
        headers: &[(String, String)],
        now: i64,
    ) -> Option<super::store::ActiveSession> {
        let token = self.cookie_of(headers)?;
        let claims = verify_session_token(&token, &self.secret, now, None)?;
        self.store.get_active_session(&claims.sid, now)
    }
}

fn verify_zid(public_key_hex: &str, message: &str, signature_hex: &str) -> bool {
    let Ok(pub_bytes) = hex::decode(public_key_hex.trim_start_matches("0x")) else {
        return false;
    };
    let Ok(sig_bytes) = hex::decode(signature_hex.trim_start_matches("0x")) else {
        return false;
    };
    if pub_bytes.len() != 32 || sig_bytes.len() != 64 {
        return false;
    }
    let Ok(vk) = VerifyingKey::from_bytes(pub_bytes.as_slice().try_into().unwrap()) else {
        return false;
    };
    let Ok(sig) = Signature::from_slice(&sig_bytes) else {
        return false;
    };
    vk.verify(message.as_bytes(), &sig).is_ok()
}

fn public_bound(mailbox: &Mailbox) -> Value {
    let mut out = serde_json::Map::new();
    if let Some(z) = &mailbox.zid_pubkey {
        out.insert("zidPubkey".into(), json!(z));
    }
    if let Some(p) = &mailbox.passkey {
        out.insert("passkeyCredId".into(), json!(p.cred_id));
    }
    Value::Object(out)
}

fn new_id(prefix: &str, bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut b);
    format!("{prefix}{}", hex::encode(b))
}

fn urlencoding(s: &str) -> String {
    s.bytes()
        .flat_map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                vec![b as char]
            } else {
                format!("%{b:02X}").chars().collect()
            }
        })
        .collect()
}

fn header(headers: &[(String, String)], name: &str) -> Option<String> {
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.clone())
}

fn out(status: u16, body: Value, headers: Vec<(String, String)>) -> HandlerOut {
    HandlerOut {
        status,
        body,
        headers,
    }
}

// RngCore + gen_range
use rand::Rng;
