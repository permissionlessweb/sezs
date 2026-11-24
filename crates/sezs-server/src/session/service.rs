//! Production session handlers (ZID, passkey, ADR-036, /me, logout, roles).

use super::adr036::verify_adr036;
use super::passkey::{
    from_b64_any_pub, resolve_rp_id_for_origin, to_b64url, verify_passkey_assertion,
};
use super::roles::MainnetRoleReader;
use super::store::SessionStore;
use super::token::{
    process_env, resolve_session_secret, sign_session_token, verify_session_token, SessionClaims,
};
use rand::RngCore;
use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_ORIGINS: &[&str] = &["http://127.0.0.1:3051", "http://localhost:3051"];
const CHALLENGE_TTL_MS: i64 = 2 * 60 * 1000;
const SESSION_TTL_MS: i64 = 12 * 60 * 60 * 1000;
const WINDOW_MS: i64 = 15 * 60 * 1000;
const MAX_FAST_BUCKETS: usize = 10_000;
const CRED_ID_RE: &str = r"^[A-Za-z0-9_-]{16,512}$";

#[derive(Clone)]
pub struct HandlerResult {
    pub status: u16,
    pub body: serde_json::Value,
    pub headers: Vec<(String, String)>,
}

pub struct SessionService {
    origins: HashSet<String>,
    rp_id: String,
    role_reader: Option<MainnetRoleReader>,
    store: SessionStore,
    secret: [u8; 32],
    cookie_name: String,
    cookie_path: String,
    secure_cookie: Option<bool>,
    trust_proxy: bool,
    challenge_ttl_ms: i64,
    session_ttl_ms: i64,
    window_ms: i64,
    ip_challenge_limit: usize,
    ip_verify_limit: usize,
    ip_roles_limit: usize,
    fast_buckets: Mutex<std::collections::HashMap<String, VecDeque<i64>>>,
}

pub struct SessionServiceConfig {
    pub allowed_origins: HashSet<String>,
    pub rp_id: String,
    pub role_reader: Option<MainnetRoleReader>,
    pub db_path: String,
    pub state_dir: Option<PathBuf>,
    pub session_secret: Option<Vec<u8>>,
    pub session_secret_file: Option<String>,
    pub cookie_name: String,
    pub cookie_path: String,
    pub secure_cookie: Option<bool>,
    pub trust_proxy: bool,
}

impl Default for SessionServiceConfig {
    fn default() -> Self {
        Self {
            allowed_origins: parse_allowed_origins(None),
            rp_id: String::new(),
            role_reader: None,
            db_path: ":memory:".into(),
            state_dir: None,
            session_secret: None,
            session_secret_file: None,
            cookie_name: "sezs_session".into(),
            cookie_path: "/".into(),
            secure_cookie: None,
            trust_proxy: false,
        }
    }
}

pub fn parse_allowed_origins(raw: Option<&str>) -> HashSet<String> {
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

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn hex_id(prefix: &str, n: usize) -> String {
    let mut bytes = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("{prefix}{}", hex::encode(bytes))
}

pub fn login_message(origin: &str, address: &str, nonce: &str, ts: i64) -> String {
    format!("SEZS-LOGIN-V1\norigin: {origin}\naddress: {address}\nnonce: {nonce}\nts: {ts}")
}

pub fn zid_login_message(origin: &str, nonce: &str, ts: i64) -> String {
    format!("SEZS-LOGIN-ZID-V1\norigin: {origin}\naudience: sezs\nnonce: {nonce}\nts: {ts}")
}

pub fn zid_challenge_hex(message: &str) -> String {
    hex::encode(message.as_bytes())
}

fn verify_zid(public_key_hex: &str, message: &str, signature_hex: &str) -> bool {
    let pub_bytes = hex::decode(public_key_hex.trim_start_matches("0x")).ok();
    let sig_bytes = hex::decode(signature_hex.trim_start_matches("0x")).ok();
    let (Some(pub_bytes), Some(sig_bytes)) = (pub_bytes, sig_bytes) else {
        return false;
    };
    if pub_bytes.len() != 32 || sig_bytes.len() != 64 {
        return false;
    }
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let Ok(vk) =
        VerifyingKey::from_bytes(pub_bytes.as_slice().try_into().ok().unwrap_or(&[0u8; 32]))
    else {
        return false;
    };
    let Ok(sig) = Signature::from_slice(&sig_bytes) else {
        return false;
    };
    vk.verify(message.as_bytes(), &sig).is_ok()
}

impl SessionService {
    pub fn new(cfg: SessionServiceConfig) -> anyhow::Result<Self> {
        let env = process_env();
        let secret = resolve_session_secret(
            cfg.session_secret.as_deref(),
            cfg.session_secret_file.as_deref(),
            cfg.state_dir.as_deref().map(Path::new),
            &env,
        )?;
        let store = SessionStore::open(&cfg.db_path)?;
        let cookie_path = if cfg.cookie_path.starts_with('/') {
            cfg.cookie_path
        } else {
            format!("/{}", cfg.cookie_path)
        };
        Ok(Self {
            origins: cfg.allowed_origins,
            rp_id: cfg.rp_id,
            role_reader: cfg.role_reader,
            store,
            secret,
            cookie_name: cfg.cookie_name,
            cookie_path,
            secure_cookie: cfg.secure_cookie,
            trust_proxy: cfg.trust_proxy,
            challenge_ttl_ms: CHALLENGE_TTL_MS,
            session_ttl_ms: SESSION_TTL_MS,
            window_ms: WINDOW_MS,
            ip_challenge_limit: 30,
            ip_verify_limit: 60,
            ip_roles_limit: 120,
            fast_buckets: Mutex::new(std::collections::HashMap::new()),
        })
    }

    fn prune_fast(&self) {
        let t = now_ms();
        if let Ok(mut buckets) = self.fast_buckets.lock() {
            buckets.retain(|_, v| {
                v.retain(|ts| t - *ts < self.window_ms);
                !v.is_empty()
            });
        }
        self.store.prune(t);
    }

    fn fast_hit(&self, key: &str, limit: usize) -> bool {
        let t = now_ms();
        let Ok(mut buckets) = self.fast_buckets.lock() else {
            return false;
        };
        let mut arr = buckets.get(key).cloned().unwrap_or_default();
        arr.retain(|ts| t - *ts < self.window_ms);
        if arr.len() >= limit {
            buckets.insert(key.to_string(), arr);
            return false;
        }
        if !buckets.contains_key(key) && buckets.len() >= MAX_FAST_BUCKETS {
            if let Some(oldest) = buckets.keys().next().cloned() {
                buckets.remove(&oldest);
            }
        }
        arr.push_back(t);
        buckets.insert(key.to_string(), arr);
        true
    }

    fn hit(&self, key: &str, limit: usize) -> bool {
        if !self.fast_hit(key, limit) {
            return false;
        }
        self.store
            .hit_rate_limit(key, limit, self.window_ms, now_ms())
    }

    fn ip_of(&self, headers: &[(String, String)], remote: &str) -> String {
        if self.trust_proxy {
            if let Some(fwd) = header(headers, "x-forwarded-for") {
                let first = fwd.split(',').next().unwrap_or("").trim();
                if !first.is_empty() {
                    return first.to_string();
                }
            }
            if let Some(real) = header(headers, "x-real-ip") {
                let t = real.trim();
                if !t.is_empty() {
                    return t.to_string();
                }
            }
        }
        if remote.is_empty() {
            "local".into()
        } else {
            remote.to_string()
        }
    }

    fn request_origin(
        &self,
        headers: &[(String, String)],
        body_origin: Option<&str>,
    ) -> Option<String> {
        let hdr = header(headers, "origin").unwrap_or_default();
        let body_org = body_origin.unwrap_or("").trim().to_string();
        if !hdr.is_empty() && !self.origins.contains(&hdr) {
            return None;
        }
        if !body_org.is_empty() && !self.origins.contains(&body_org) {
            return None;
        }
        if !hdr.is_empty() && !body_org.is_empty() && hdr != body_org {
            return None;
        }
        let chosen = if !hdr.is_empty() { hdr } else { body_org };
        if !chosen.is_empty() && self.origins.contains(&chosen) {
            Some(chosen)
        } else {
            None
        }
    }

    fn csrf_ok(&self, headers: &[(String, String)]) -> bool {
        header(headers, "x-sezs-frost")
            .or_else(|| header(headers, "x-sezs-csrf"))
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    }

    fn cookie_of(&self, headers: &[(String, String)]) -> Option<String> {
        let cookie = header(headers, "cookie")?;
        let re = regex::Regex::new(&format!(
            r"(?:^|;\s*){}=([A-Za-z0-9._-]{{1,640}})",
            regex::escape(&self.cookie_name)
        ))
        .ok()?;
        re.captures(&cookie)
            .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
    }

    fn use_secure(&self, origin: &str) -> bool {
        self.secure_cookie
            .unwrap_or_else(|| origin.starts_with("https://"))
    }

    fn cookie_attrs(&self, origin: &str) -> String {
        let mut s = format!("Path={}; HttpOnly; SameSite=Strict", self.cookie_path);
        if self.use_secure(origin) {
            s.push_str("; Secure");
        }
        s
    }

    fn set_cookie_header(&self, token: &str, origin: &str) -> String {
        format!(
            "{}={}; Max-Age={}; {}",
            self.cookie_name,
            token,
            self.session_ttl_ms / 1000,
            self.cookie_attrs(origin)
        )
    }

    fn clear_cookie_header(&self, origin: &str) -> String {
        format!(
            "{}=; Max-Age=0; {}",
            self.cookie_name,
            self.cookie_attrs(origin)
        )
    }

    fn json_ok(&self, status: u16, body: serde_json::Value) -> HandlerResult {
        HandlerResult {
            status,
            body,
            headers: vec![],
        }
    }

    fn json_hdr(
        &self,
        status: u16,
        body: serde_json::Value,
        headers: Vec<(String, String)>,
    ) -> HandlerResult {
        HandlerResult {
            status,
            body,
            headers,
        }
    }

    pub fn health(&self) -> HandlerResult {
        self.json_ok(
            200,
            serde_json::json!({"ok": true, "service": "sezs-session", "live": true}),
        )
    }

    pub fn challenge(
        &self,
        headers: &[(String, String)],
        remote: &str,
        body: &serde_json::Value,
    ) -> HandlerResult {
        self.prune_fast();
        if !self.csrf_ok(headers) {
            return self.json_ok(
                403,
                serde_json::json!({"ok": false, "error": "csrf_required"}),
            );
        }
        let origin = match self.request_origin(headers, body.get("origin").and_then(|v| v.as_str()))
        {
            Some(o) => o,
            None => {
                return self.json_ok(
                    403,
                    serde_json::json!({"ok": false, "error": "origin_refused"}),
                )
            }
        };
        let ip = self.ip_of(headers, remote);
        if !self.hit(&format!("ch:ip:{ip}"), self.ip_challenge_limit) {
            return self.json_hdr(
                429,
                serde_json::json!({"ok": false, "error": "rate_limited"}),
                vec![("retry-after".into(), "60".into())],
            );
        }
        let kind = body
            .get("kind")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                if body.get("artist_id").is_some() || body.get("address").is_some() {
                    "adr036".into()
                } else {
                    "zid".into()
                }
            });
        let mut nonce_bytes = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = hex::encode(nonce_bytes);
        let ts = now_ms();
        let exp = ts + self.challenge_ttl_ms;

        match kind.as_str() {
            "zid" => {
                let message = zid_login_message(&origin, &nonce, ts);
                let challenge_hex = zid_challenge_hex(&message);
                let _ = self.store.put_challenge(
                    &nonce,
                    "zid",
                    &origin,
                    None,
                    None,
                    Some(&message),
                    ts,
                    exp,
                );
                self.json_ok(
                    200,
                    serde_json::json!({
                        "ok": true,
                        "nonce": nonce,
                        "ts": ts,
                        "message": message,
                        "challengeHex": challenge_hex,
                        "statement": format!("Sign in to {origin}"),
                    }),
                )
            }
            "passkey" => {
                let resolved = match resolve_rp_id_for_origin(
                    &origin,
                    if self.rp_id.is_empty() {
                        None
                    } else {
                        Some(&self.rp_id)
                    },
                ) {
                    Some(r) => r,
                    None => {
                        return self.json_ok(
                            400,
                            serde_json::json!({"ok": false, "error": "passkey_invalid_rp_id"}),
                        )
                    }
                };
                let mut ch = [0u8; 32];
                rand::thread_rng().fill_bytes(&mut ch);
                let challenge_b64 = to_b64url(&ch);
                let _ = self.store.put_challenge(
                    &nonce,
                    "passkey",
                    &origin,
                    None,
                    Some(&challenge_b64),
                    None,
                    ts,
                    exp,
                );
                self.json_ok(
                    200,
                    serde_json::json!({
                        "ok": true,
                        "nonce": nonce,
                        "ts": ts,
                        "challengeB64": challenge_b64,
                        "rpId": resolved,
                    }),
                )
            }
            "adr036" => {
                let address = body
                    .get("artist_id")
                    .or_else(|| body.get("address"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !regex::Regex::new(r"^terp1[a-z0-9]{20,}$")
                    .unwrap()
                    .is_match(&address)
                {
                    return self.json_ok(
                        400,
                        serde_json::json!({"ok": false, "error": "bad_address"}),
                    );
                }
                let message = login_message(&origin, &address, &nonce, ts);
                let _ = self.store.put_challenge(
                    &nonce,
                    "adr036",
                    &origin,
                    Some(&address),
                    None,
                    Some(&message),
                    ts,
                    exp,
                );
                self.json_ok(
                    200,
                    serde_json::json!({"ok": true, "nonce": nonce, "ts": ts, "message": message}),
                )
            }
            _ => self.json_ok(400, serde_json::json!({"ok": false, "error": "bad_kind"})),
        }
    }

    pub async fn verify(
        &self,
        headers: &[(String, String)],
        remote: &str,
        body: &serde_json::Value,
    ) -> HandlerResult {
        self.prune_fast();
        if !self.csrf_ok(headers) {
            return self.json_ok(
                403,
                serde_json::json!({"ok": false, "error": "csrf_required"}),
            );
        }
        let origin = match self.request_origin(headers, body.get("origin").and_then(|v| v.as_str()))
        {
            Some(o) => o,
            None => {
                return self.json_ok(
                    403,
                    serde_json::json!({"ok": false, "error": "origin_refused"}),
                )
            }
        };
        let ip = self.ip_of(headers, remote);
        if !self.hit(&format!("vf:ip:{ip}"), self.ip_verify_limit) {
            return self.json_hdr(
                429,
                serde_json::json!({"ok": false, "error": "rate_limited"}),
                vec![("retry-after".into(), "60".into())],
            );
        }
        let nonce = body.get("nonce").and_then(|v| v.as_str()).unwrap_or("");
        if !regex::Regex::new(r"^[0-9a-f]{32}$")
            .unwrap()
            .is_match(nonce)
        {
            return self.json_ok(
                400,
                serde_json::json!({"ok": false, "error": "unknown_challenge"}),
            );
        }
        let ch = match self.store.take_challenge(nonce, now_ms()) {
            Some(c) => c,
            None => {
                return self.json_ok(
                    400,
                    serde_json::json!({"ok": false, "error": "unknown_challenge"}),
                )
            }
        };
        if ch.expired {
            return self.json_ok(400, serde_json::json!({"ok": false, "error": "expired"}));
        }
        if ch.origin != origin {
            return self.json_ok(
                403,
                serde_json::json!({"ok": false, "error": "challenge_mismatch"}),
            );
        }
        let method = body
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or(&ch.kind)
            .to_string();
        let prev_token = self.cookie_of(headers);
        let prev_claims = prev_token
            .as_deref()
            .and_then(|t| verify_session_token(t, &self.secret, now_ms(), None));
        let revoke_session_id = prev_claims.as_ref().map(|c| c.sid.as_str());

        if method == "zid" && ch.kind == "zid" {
            let public_key = body
                .get("publicKey")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_lowercase();
            let signature = body
                .get("signature")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if !verify_zid(&public_key, &ch.message, signature) {
                return self.json_ok(
                    403,
                    serde_json::json!({"ok": false, "error": "bad_signature"}),
                );
            }
            return self.issue_session(
                "ed25519/zid",
                &public_key,
                &origin,
                revoke_session_id,
                serde_json::json!({
                    "ok": true,
                    "role": "guest",
                    "login_id": public_key,
                    "kind": "ed25519/zid",
                    "source": "session",
                    "live": self.role_reader.is_some(),
                }),
            );
        }

        if method == "passkey" && ch.kind == "passkey" {
            let cred_id = body
                .get("credId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if !regex::Regex::new(CRED_ID_RE).unwrap().is_match(cred_id) {
                return self.json_ok(
                    400,
                    serde_json::json!({"ok": false, "error": "bad_cred_id"}),
                );
            }
            let existing = self.store.get_passkey(cred_id);
            let provided = body
                .get("publicKey")
                .and_then(|v| v.as_str())
                .and_then(from_b64_any_pub);
            let provided_norm = provided.as_ref().map(|b| to_b64url(b)).unwrap_or_default();
            if let Some(ex) = &existing {
                if !provided_norm.is_empty() && ex.public_key != provided_norm {
                    return self.json_ok(
                        403,
                        serde_json::json!({"ok": false, "error": "passkey_key_mismatch"}),
                    );
                }
            }
            let pub_for_check = existing
                .as_ref()
                .map(|e| e.public_key.clone())
                .filter(|s| !s.is_empty())
                .unwrap_or(provided_norm);
            if pub_for_check.is_empty() {
                return self.json_ok(
                    400,
                    serde_json::json!({"ok": false, "error": "proof_required"}),
                );
            }
            let expected_rp = existing
                .as_ref()
                .map(|e| e.rp_id.clone())
                .unwrap_or_else(|| {
                    resolve_rp_id_for_origin(
                        &origin,
                        if self.rp_id.is_empty() {
                            None
                        } else {
                            Some(&self.rp_id)
                        },
                    )
                    .unwrap_or_default()
                });
            let assertion = body.get("assertion");
            let check = verify_passkey_assertion(
                &origin,
                Some(&expected_rp),
                &ch.challenge_b64,
                &pub_for_check,
                assertion
                    .and_then(|a| a.get("clientDataJSON"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(""),
                assertion
                    .and_then(|a| a.get("authenticatorData"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(""),
                assertion
                    .and_then(|a| a.get("signature"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(""),
                existing.as_ref().map(|e| e.sign_count as u32).unwrap_or(0),
            );
            let pk = match check {
                Ok(p) => p,
                Err(e) => return self.json_ok(403, serde_json::json!({"ok": false, "error": e})),
            };
            if let Err(e) = self.store.record_passkey_use(
                cred_id,
                &pk.normalized_public_key,
                &pk.rp_id,
                pk.sign_count as i64,
                now_ms(),
            ) {
                return self.json_ok(403, serde_json::json!({"ok": false, "error": e}));
            }
            return self.issue_session(
                "p256/passkey",
                cred_id,
                &origin,
                revoke_session_id,
                serde_json::json!({
                    "ok": true,
                    "role": "guest",
                    "login_id": cred_id,
                    "kind": "p256/passkey",
                    "source": "session",
                    "live": self.role_reader.is_some(),
                }),
            );
        }

        if method == "adr036" && ch.kind == "adr036" {
            let address = body
                .get("artist_id")
                .or_else(|| body.get("address"))
                .or_else(|| body.get("login_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if ch.address.to_lowercase() != address.to_lowercase() {
                return self.json_ok(
                    403,
                    serde_json::json!({"ok": false, "error": "challenge_mismatch"}),
                );
            }
            let pub_key = body.get("pub_key");
            let (pk_type, pk_value) = if pub_key.and_then(|v| v.get("type")).is_some() {
                (
                    pub_key
                        .and_then(|v| v.get("type"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(""),
                    pub_key
                        .and_then(|v| v.get("value"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(""),
                )
            } else {
                (
                    "tendermint/PubKeySecp256k1",
                    pub_key.and_then(|v| v.as_str()).unwrap_or(""),
                )
            };
            let signature = body.get("signature").and_then(|v| v.as_str()).unwrap_or("");
            if !verify_adr036(
                "terp",
                &address,
                ch.message.as_bytes(),
                pk_type,
                pk_value,
                signature,
            ) {
                return self.json_ok(
                    403,
                    serde_json::json!({"ok": false, "error": "bad_signature"}),
                );
            }
            let mut role = "guest".to_string();
            let mut source = "session".to_string();
            let mut live = false;
            if let Some(reader) = &self.role_reader {
                let r = reader.resolve_address_role(&address, "").await;
                if r.error.is_some() {
                    return self.json_ok(
                        503,
                        serde_json::json!({"ok": false, "error": "role_query_failed"}),
                    );
                }
                role = r.role.unwrap_or_else(|| "guest".into());
                source = r.source;
                live = r.live;
            }
            return self.issue_session(
                "terp-bech32",
                &address,
                &origin,
                revoke_session_id,
                serde_json::json!({
                    "ok": true,
                    "role": role,
                    "login_id": address,
                    "kind": "terp-bech32",
                    "source": source,
                    "live": live,
                }),
            );
        }

        self.json_ok(400, serde_json::json!({"ok": false, "error": "method"}))
    }

    fn issue_session(
        &self,
        kind: &str,
        subject: &str,
        origin: &str,
        revoke_session_id: Option<&str>,
        body: serde_json::Value,
    ) -> HandlerResult {
        let t = now_ms();
        let exp = t + self.session_ttl_ms;
        let sid = hex_id("sess-", 16);
        let _ = self
            .store
            .create_session(&sid, kind, subject, origin, t, exp, revoke_session_id);
        let claims = SessionClaims {
            v: 1,
            sid: sid.clone(),
            lid: subject.to_string(),
            sub: subject.to_string(),
            kind: kind.to_string(),
            org: origin.to_string(),
            iat: t,
            exp,
        };
        let token = match sign_session_token(&claims, &self.secret) {
            Ok(t) => t,
            Err(_) => return self.json_ok(500, serde_json::json!({"ok": false, "error": "error"})),
        };
        self.json_hdr(
            200,
            body,
            vec![("set-cookie".into(), self.set_cookie_header(&token, origin))],
        )
    }

    pub async fn me(&self, headers: &[(String, String)], url: &str) -> HandlerResult {
        let token = match self.cookie_of(headers) {
            Some(t) => t,
            None => {
                return self.json_ok(200, serde_json::json!({"ok": false, "error": "no_session"}))
            }
        };
        let claims = match verify_session_token(&token, &self.secret, now_ms(), None) {
            Some(c) if self.origins.contains(&c.org) => c,
            _ => return self.json_ok(200, serde_json::json!({"ok": false, "error": "no_session"})),
        };
        let sess = match self.store.get_active_session(&claims.sid, now_ms()) {
            Some(s) => s,
            None => {
                return self.json_ok(200, serde_json::json!({"ok": false, "error": "no_session"}))
            }
        };
        let mut role = "guest".to_string();
        let mut source = "session".to_string();
        let mut live = self.role_reader.is_some();
        if sess.kind == "terp-bech32" {
            if let Some(reader) = &self.role_reader {
                let contract = query_param(url, "contract").unwrap_or_default();
                let r = reader.resolve_address_role(&sess.subject, &contract).await;
                if let Some(rr) = r.role {
                    role = rr;
                }
                if !r.source.is_empty() {
                    source = r.source;
                }
                live = r.live;
            }
        }
        self.json_ok(
            200,
            serde_json::json!({
                "ok": true,
                "role": role,
                "login_id": sess.subject,
                "kind": sess.kind,
                "source": source,
                "live": live,
            }),
        )
    }

    pub fn logout(&self, headers: &[(String, String)]) -> HandlerResult {
        if !self.csrf_ok(headers) {
            return self.json_ok(
                403,
                serde_json::json!({"ok": false, "error": "csrf_required"}),
            );
        }
        let hdr_origin = header(headers, "origin").unwrap_or_default();
        if !hdr_origin.is_empty() && !self.origins.contains(&hdr_origin) {
            return self.json_ok(
                403,
                serde_json::json!({"ok": false, "error": "origin_refused"}),
            );
        }
        let token = self.cookie_of(headers);
        let mut cookie_origin = if !hdr_origin.is_empty() {
            hdr_origin
        } else {
            self.origins.iter().next().cloned().unwrap_or_default()
        };
        if let Some(token) = token {
            if let Some(claims) = verify_session_token(&token, &self.secret, now_ms(), None) {
                self.store.revoke_session(&claims.sid, now_ms());
                if !claims.org.is_empty() {
                    cookie_origin = claims.org;
                }
            }
        }
        self.json_hdr(
            200,
            serde_json::json!({"ok": true}),
            vec![(
                "set-cookie".into(),
                self.clear_cookie_header(&cookie_origin),
            )],
        )
    }

    pub async fn event_roles(
        &self,
        headers: &[(String, String)],
        remote: &str,
        url: &str,
    ) -> HandlerResult {
        let ip = self.ip_of(headers, remote);
        if !self.hit(&format!("rl:ip:{ip}"), self.ip_roles_limit) {
            return self.json_hdr(
                429,
                serde_json::json!({"ok": false, "error": "rate_limited"}),
                vec![("retry-after".into(), "60".into())],
            );
        }
        let Some(reader) = &self.role_reader else {
            return self.json_ok(
                200,
                serde_json::json!({"ok": false, "error": "no_event_contract"}),
            );
        };
        let requested = query_param(url, "contract").unwrap_or_default();
        match reader.get_event_roles(&requested).await {
            Ok(v) => self.json_ok(200, v),
            Err((code, v)) => self.json_ok(code, v),
        }
    }
}

fn header(headers: &[(String, String)], name: &str) -> Option<String> {
    let n = name.to_ascii_lowercase();
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(&n))
        .map(|(_, v)| v.trim().to_string())
        .filter(|s| !s.is_empty() || name.eq_ignore_ascii_case("origin"))
}

fn query_param(url: &str, key: &str) -> Option<String> {
    let parsed = url::Url::parse(url)
        .ok()
        .or_else(|| url::Url::parse(&format!("http://127.0.0.1{url}")).ok())?;
    parsed
        .query_pairs()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.to_string())
}
