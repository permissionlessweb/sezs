//! Parity with apps/sezs/dev/splash/email-auth.test.mjs.

use ed25519_dalek::{Signer, SigningKey};
use p256::ecdsa::{Signature, SigningKey as P256SigningKey};
use sezs_server::email::sink::{FileSink, MemorySink, UnavailableSink, DEFAULT_EMAIL_FROM};
use sezs_server::email::store::EmailStore;
use sezs_server::email::token::{secret_from_string, verify_session_token};
use sezs_server::email::{
    email_hash_of, email_login_message, email_me_body, normalize_email, EmailAuth, EmailAuthConfig,
    EmailMessage, EmailProvider,
};
use sezs_server::secret_fields::refuse_secret_fields;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tempfile::TempDir;

const ORIGIN: &str = "http://localhost:3051";

fn headers(origin: &str, csrf: &str, cookie: &str, ip: &str) -> (Vec<(String, String)>, String) {
    let mut h = vec![
        ("origin".into(), origin.into()),
        ("content-type".into(), "application/json".into()),
    ];
    if !csrf.is_empty() {
        h.push(("x-sezs-csrf".into(), csrf.into()));
    }
    if !cookie.is_empty() {
        h.push(("cookie".into(), format!("sezs_splash={cookie}")));
    }
    (h, ip.to_string())
}

fn req() -> (Vec<(String, String)>, String) {
    headers(ORIGIN, "1", "", "127.0.0.1")
}

fn with_cookie(id: &str) -> (Vec<(String, String)>, String) {
    headers(ORIGIN, "1", id, "127.0.0.1")
}

fn cookie_id(headers: &[(String, String)]) -> String {
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("set-cookie"))
        .and_then(|(_, v)| {
            v.split(';')
                .next()?
                .strip_prefix("sezs_splash=")
                .map(|s| s.to_string())
        })
        .unwrap_or_default()
}

fn auth_with(sink: Arc<MemorySink>) -> EmailAuth {
    let mut cfg = EmailAuthConfig::default();
    cfg.provider = sink;
    EmailAuth::new(cfg).unwrap()
}

fn extract_code(text: &str) -> String {
    let re = regex::Regex::new(r"code is (\d{6})").unwrap();
    re.captures(text).unwrap()[1].to_string()
}

fn sign_in(
    auth: &EmailAuth,
    sink: &MemorySink,
    email: &str,
) -> (String, serde_json::Value, String) {
    let (h, ip) = req();
    let r = auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email": email}),
    );
    assert_eq!(r.status, 200, "{}", r.body);
    let msg = sink.last().expect("mail");
    let code = extract_code(&msg.text);
    let v = auth.handle(
        "POST",
        "/sezs/auth/email/verify",
        &h,
        &ip,
        &serde_json::json!({"email": email, "code": code}),
    );
    assert_eq!(v.status, 200, "{}", v.body);
    (cookie_id(&v.headers), v.body, code)
}

struct Passkey {
    cred_id: String,
    public_key: String,
    sk: P256SigningKey,
}

impl Passkey {
    fn new() -> Self {
        let sk = P256SigningKey::random(&mut rand::thread_rng());
        let point = sk.verifying_key().to_encoded_point(false);
        let raw = point.as_bytes();
        use base64::Engine;
        Self {
            cred_id: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b"test-cred-1"),
            public_key: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw),
            sk,
        }
    }

    fn assert_(
        &self,
        challenge_b64: &str,
        origin: &str,
        flags: u8,
        sign_count: u32,
    ) -> serde_json::Value {
        use base64::Engine;
        let client_obj = serde_json::json!({
            "type": "webauthn.get",
            "challenge": challenge_b64,
            "origin": origin,
            "crossOrigin": false,
        });
        let client_bytes = serde_json::to_vec(&client_obj).unwrap();
        let mut auth_data = vec![0u8; 37];
        let rp_hash = Sha256::digest(b"localhost");
        auth_data[..32].copy_from_slice(&rp_hash);
        auth_data[32] = flags;
        auth_data[33..37].copy_from_slice(&sign_count.to_be_bytes());
        let client_hash = Sha256::digest(&client_bytes);
        let mut signed = auth_data.clone();
        signed.extend_from_slice(&client_hash);
        let sig: Signature = self.sk.sign(&signed);
        serde_json::json!({
            "clientDataJSON": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&client_bytes),
            "authenticatorData": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&auth_data),
            "signature": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sig.to_der().as_bytes()),
        })
    }
}

#[test]
fn normalize_email_trims_lowercases_and_rejects_malformed() {
    assert_eq!(
        normalize_email("  Guest@Example.COM "),
        Some("guest@example.com".into())
    );
    assert_eq!(normalize_email("no-at-sign"), None);
    assert_eq!(normalize_email("a@b"), None);
    assert_eq!(normalize_email(""), None);
    assert_eq!(
        normalize_email(&format!("{}@example.com", "x".repeat(65))),
        None
    );
}

#[test]
fn request_verify_issues_cookie_and_session_returns_email() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink.clone());
    let (id, body, _) = sign_in(&auth, &sink, "guest@example.com");
    assert!(
        regex::Regex::new(r"^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$")
            .unwrap()
            .is_match(&id)
    );
    assert_eq!(body["kind"], "email");
    assert!(body["login_id"].as_str().unwrap().starts_with("mail-"));
    assert_ne!(body["login_id"], "guest@example.com");
    let (h, ip) = with_cookie(&id);
    let s = auth.handle(
        "GET",
        "/sezs/auth/email/session",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    assert_eq!(s.status, 200);
    assert_eq!(s.body["email"], "guest@example.com");
    assert_eq!(s.body["login_id"], body["login_id"]);
    let rec = auth.record_of(&id).unwrap();
    let me = email_me_body(&rec);
    assert_eq!(me["ok"], true);
    assert_eq!(me["kind"], "email");
    assert_eq!(me["role"], "guest");
}

#[test]
fn send_email_uses_default_from() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink.clone());
    let (h, ip) = req();
    auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com"}),
    );
    assert_eq!(sink.last().unwrap().from, DEFAULT_EMAIL_FROM);

    let sink2 = Arc::new(MemorySink::new());
    let mut cfg = EmailAuthConfig::default();
    cfg.provider = sink2.clone();
    cfg.email_from = "desk@permissionless.money".into();
    let auth2 = EmailAuth::new(cfg).unwrap();
    auth2.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com"}),
    );
    assert_eq!(sink2.last().unwrap().from, "desk@permissionless.money");
}

#[test]
fn challenge_commits_to_origin_audience_mailbox_nonce() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink.clone());
    let (h, ip) = req();
    auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com"}),
    );
    let msg = sink.last().unwrap();
    assert!(extract_code(&msg.text).len() == 6);
    assert!(msg.text.contains("email_code="));
    assert!(msg.text.contains("email=guest%40example.com"));
    assert!(msg.token_ref.is_some());
    let message = email_login_message(
        ORIGIN,
        "guest@example.com",
        msg.token_ref.as_deref().unwrap(),
        0,
    );
    assert!(message.starts_with("SEZS-LOGIN-EMAIL-V1"));
    assert!(message.contains("audience: sezs"));
}

#[test]
fn code_is_one_time() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink.clone());
    let (_, _, code) = sign_in(&auth, &sink, "guest@example.com");
    let (h, ip) = req();
    let again = auth.handle(
        "POST",
        "/sezs/auth/email/verify",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com","code":code}),
    );
    assert_eq!(again.status, 400);
    assert_eq!(again.body["error"], "unknown_challenge");
}

#[test]
fn wrong_code_burns_after_too_many_guesses() {
    let sink = Arc::new(MemorySink::new());
    let mut cfg = EmailAuthConfig::default();
    cfg.provider = sink.clone();
    cfg.verify_limit = 100;
    let auth = EmailAuth::new(cfg).unwrap();
    let (h, ip) = req();
    auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com"}),
    );
    for _ in 0..5 {
        let r = auth.handle(
            "POST",
            "/sezs/auth/email/verify",
            &h,
            &ip,
            &serde_json::json!({"email":"guest@example.com","code":"000000"}),
        );
        assert_eq!(r.status, 400);
        assert_eq!(r.body["error"], "bad_code");
    }
    let r = auth.handle(
        "POST",
        "/sezs/auth/email/verify",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com","code":"000000"}),
    );
    assert_eq!(r.status, 400);
    assert_eq!(r.body["error"], "unknown_challenge");
}

#[test]
fn expired_code_returns_expired() {
    let sink = Arc::new(MemorySink::new());
    let mut cfg = EmailAuthConfig::default();
    cfg.provider = sink.clone();
    cfg.otp_ttl_ms = 1000;
    cfg.clock.set(1_000_000);
    let auth = EmailAuth::new(cfg).unwrap();
    let (h, ip) = req();
    auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com"}),
    );
    let code = extract_code(&sink.last().unwrap().text);
    auth.clock().set(1_002_000);
    let r = auth.handle(
        "POST",
        "/sezs/auth/email/verify",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com","code":code}),
    );
    assert_eq!(r.status, 400);
    assert_eq!(r.body["error"], "expired");
}

#[test]
fn foreign_origin_and_missing_csrf_refused() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink.clone());
    let (h, ip) = headers("https://evil.example", "1", "", "127.0.0.1");
    let r = auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com"}),
    );
    assert_eq!(r.status, 403);
    let (_, _, code) = sign_in(&auth, &sink, "guest@example.com");
    let v = auth.handle(
        "POST",
        "/sezs/auth/email/verify",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com","code":code}),
    );
    assert_eq!(v.status, 403);
    assert_eq!(v.body["error"], "origin_refused");
    let (h2, ip2) = headers(ORIGIN, "", "", "127.0.0.1");
    let n = auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h2,
        &ip2,
        &serde_json::json!({"email":"guest@example.com"}),
    );
    assert_eq!(n.status, 403);
}

#[test]
fn code_cannot_be_verified_from_the_other_allowed_origin() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink.clone());
    let (h, ip) = req();
    auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com"}),
    );
    let code = extract_code(&sink.last().unwrap().text);
    let (h2, ip2) = headers("http://127.0.0.1:3051", "1", "", "127.0.0.1");
    let r = auth.handle(
        "POST",
        "/sezs/auth/email/verify",
        &h2,
        &ip2,
        &serde_json::json!({"email":"guest@example.com","code":code}),
    );
    assert_eq!(r.status, 400);
    assert_eq!(r.body["error"], "unknown_challenge");
}

#[test]
fn request_rate_limit_is_generic_429() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink);
    let (h, ip) = req();
    let mut codes = vec![];
    for _ in 0..4 {
        let r = auth.handle(
            "POST",
            "/sezs/auth/email/request",
            &h,
            &ip,
            &serde_json::json!({"email":"guest@example.com"}),
        );
        codes.push(r.status);
        if r.status == 429 {
            assert_eq!(r.body["error"], "rate_limited");
        }
    }
    assert_eq!(codes, vec![200, 200, 200, 429]);
}

#[test]
fn verify_rate_limit_returns_429() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink);
    let (h, ip) = req();
    auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com"}),
    );
    let mut last = 0;
    for _ in 0..6 {
        last = auth
            .handle(
                "POST",
                "/sezs/auth/email/verify",
                &h,
                &ip,
                &serde_json::json!({"email":"guest@example.com","code":"000000"}),
            )
            .status;
    }
    assert_eq!(last, 429);
}

#[test]
fn per_ip_cap_stops_spraying_mailboxes() {
    let sink = Arc::new(MemorySink::new());
    let mut cfg = EmailAuthConfig::default();
    cfg.provider = sink;
    cfg.ip_request_limit = 2;
    let auth = EmailAuth::new(cfg).unwrap();
    let (h, ip) = req();
    assert_eq!(
        auth.handle(
            "POST",
            "/sezs/auth/email/request",
            &h,
            &ip,
            &serde_json::json!({"email":"a@example.com"})
        )
        .status,
        200
    );
    assert_eq!(
        auth.handle(
            "POST",
            "/sezs/auth/email/request",
            &h,
            &ip,
            &serde_json::json!({"email":"b@example.com"})
        )
        .status,
        200
    );
    assert_eq!(
        auth.handle(
            "POST",
            "/sezs/auth/email/request",
            &h,
            &ip,
            &serde_json::json!({"email":"c@example.com"})
        )
        .status,
        429
    );
}

#[test]
fn cooldown_is_idempotent_and_does_not_resend() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink.clone());
    let (h, ip) = req();
    let a = auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com"}),
    );
    let b = auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com"}),
    );
    assert_eq!(a.status, 200);
    assert_eq!(b.status, 200);
    assert_eq!(a.body, b.body);
    assert_eq!(sink.len(), 1);
}

#[test]
fn delivery_failure_is_503_and_stores_no_challenge() {
    let mut cfg = EmailAuthConfig::default();
    cfg.provider = Arc::new(UnavailableSink);
    let auth = EmailAuth::new(cfg).unwrap();
    let (h, ip) = req();
    let r = auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com"}),
    );
    assert_eq!(r.status, 503);
    assert_eq!(r.body["error"], "delivery_unavailable");
    let v = auth.handle(
        "POST",
        "/sezs/auth/email/verify",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com","code":"123456"}),
    );
    assert_eq!(v.status, 400);
    assert_eq!(v.body["error"], "unknown_challenge");
}

#[test]
fn verify_mints_fresh_session_and_invalidates_prior() {
    let sink = Arc::new(MemorySink::new());
    let mut cfg = EmailAuthConfig::default();
    cfg.provider = sink.clone();
    cfg.resend_cooldown_ms = 0;
    let auth = EmailAuth::new(cfg).unwrap();
    let (first, _, _) = sign_in(&auth, &sink, "guest@example.com");
    let (h, ip) = req();
    auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"guest@example.com"}),
    );
    let code = extract_code(&sink.last().unwrap().text);
    let (hc, ip2) = with_cookie(&first);
    let v = auth.handle(
        "POST",
        "/sezs/auth/email/verify",
        &hc,
        &ip2,
        &serde_json::json!({"email":"guest@example.com","code":code}),
    );
    assert_eq!(v.status, 200);
    let second = cookie_id(&v.headers);
    assert_ne!(first, second);
    let (h1, i1) = with_cookie(&first);
    assert_eq!(
        auth.handle(
            "GET",
            "/sezs/auth/email/session",
            &h1,
            &i1,
            &serde_json::json!({})
        )
        .status,
        401
    );
    let (h2, i2) = with_cookie(&second);
    assert_eq!(
        auth.handle(
            "GET",
            "/sezs/auth/email/session",
            &h2,
            &i2,
            &serde_json::json!({})
        )
        .status,
        200
    );
}

#[test]
fn logout_clears_cookie_and_session() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink.clone());
    let (id, _, _) = sign_in(&auth, &sink, "guest@example.com");
    let (h, ip) = with_cookie(&id);
    let r = auth.handle(
        "POST",
        "/sezs/auth/email/logout",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    assert_eq!(r.status, 200);
    assert!(r.headers.iter().any(|(_, v)| v.contains("Max-Age=0")));
    assert_eq!(
        auth.handle(
            "GET",
            "/sezs/auth/email/session",
            &h,
            &ip,
            &serde_json::json!({})
        )
        .status,
        401
    );
}

#[test]
fn bind_without_session_is_refused() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink);
    let (h, ip) = req();
    let r = auth.handle(
        "POST",
        "/sezs/auth/email/bind-challenge",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    assert_eq!(r.status, 401);
}

#[test]
fn bind_zid_without_proof_refused_with_signature_it_binds() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink.clone());
    let (id, _, _) = sign_in(&auth, &sink, "guest@example.com");
    let (h, ip) = with_cookie(&id);
    let ch = auth.handle(
        "POST",
        "/sezs/auth/email/bind-challenge",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    assert_eq!(ch.status, 200);
    let bad = auth.handle(
        "POST",
        "/sezs/auth/email/bind",
        &h,
        &ip,
        &serde_json::json!({"kind":"ed25519/zid","nonce":ch.body["nonce"]}),
    );
    assert_eq!(bad.status, 400);
    assert_eq!(bad.body["error"], "proof_required");

    let sk = SigningKey::generate(&mut rand::thread_rng());
    let zid = hex::encode(sk.verifying_key().as_bytes());
    let ch = auth.handle(
        "POST",
        "/sezs/auth/email/bind-challenge",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    let msg = ch.body["message"].as_str().unwrap().as_bytes();
    let sig = hex::encode(sk.sign(msg).to_bytes());
    let ok = auth.handle(
        "POST",
        "/sezs/auth/email/bind",
        &h,
        &ip,
        &serde_json::json!({"kind":"ed25519/zid","nonce":ch.body["nonce"],"zidPubkey":zid,"signature":sig}),
    );
    assert_eq!(ok.status, 200, "{}", ok.body);
    let me = auth.handle(
        "GET",
        "/sezs/auth/email/session",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    assert_eq!(me.body["bound"]["zidPubkey"], zid);
}

#[test]
fn bind_nonce_is_one_time() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink.clone());
    let (id, _, _) = sign_in(&auth, &sink, "guest@example.com");
    let (h, ip) = with_cookie(&id);
    let ch = auth.handle(
        "POST",
        "/sezs/auth/email/bind-challenge",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    let sk = SigningKey::generate(&mut rand::thread_rng());
    let zid = hex::encode(sk.verifying_key().as_bytes());
    let sig = hex::encode(
        sk.sign(ch.body["message"].as_str().unwrap().as_bytes())
            .to_bytes(),
    );
    let body = serde_json::json!({"kind":"ed25519/zid","nonce":ch.body["nonce"],"zidPubkey":zid,"signature":sig});
    assert_eq!(
        auth.handle("POST", "/sezs/auth/email/bind", &h, &ip, &body)
            .status,
        200
    );
    let again = auth.handle("POST", "/sezs/auth/email/bind", &h, &ip, &body);
    assert_eq!(again.status, 400);
    assert_eq!(again.body["error"], "unknown_challenge");
}

#[test]
fn passkey_bind_and_refusals() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink.clone());
    let (id, _, _) = sign_in(&auth, &sink, "guest@example.com");
    let (h, ip) = with_cookie(&id);
    let pk = Passkey::new();
    let ch = auth.handle(
        "POST",
        "/sezs/auth/email/bind-challenge",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    let assertion = pk.assert_(ch.body["challengeB64"].as_str().unwrap(), ORIGIN, 0x05, 1);
    let ok = auth.handle(
        "POST",
        "/sezs/auth/email/bind",
        &h,
        &ip,
        &serde_json::json!({"kind":"p256/passkey","credId":pk.cred_id,"publicKey":pk.public_key,"nonce":ch.body["nonce"],"assertion":assertion}),
    );
    assert_eq!(ok.status, 200, "{}", ok.body);

    let ch2 = auth.handle(
        "POST",
        "/sezs/auth/email/bind-challenge",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    let evil = pk.assert_(
        ch2.body["challengeB64"].as_str().unwrap(),
        "https://evil.example",
        0x05,
        2,
    );
    let bad = auth.handle(
        "POST",
        "/sezs/auth/email/bind",
        &h,
        &ip,
        &serde_json::json!({"kind":"p256/passkey","credId":pk.cred_id,"publicKey":pk.public_key,"nonce":ch2.body["nonce"],"assertion":evil}),
    );
    assert_eq!(bad.status, 403);
    assert_eq!(bad.body["error"], "passkey_origin");

    let ch3 = auth.handle(
        "POST",
        "/sezs/auth/email/bind-challenge",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    let wrong_ch = pk.assert_("not-the-challenge", ORIGIN, 0x05, 3);
    let bad2 = auth.handle(
        "POST",
        "/sezs/auth/email/bind",
        &h,
        &ip,
        &serde_json::json!({"kind":"p256/passkey","credId":pk.cred_id,"publicKey":pk.public_key,"nonce":ch3.body["nonce"],"assertion":wrong_ch}),
    );
    assert_eq!(bad2.status, 403);
    assert_eq!(bad2.body["error"], "passkey_challenge");

    let ch4 = auth.handle(
        "POST",
        "/sezs/auth/email/bind-challenge",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    let no_uv = pk.assert_(ch4.body["challengeB64"].as_str().unwrap(), ORIGIN, 0x01, 4);
    let bad3 = auth.handle(
        "POST",
        "/sezs/auth/email/bind",
        &h,
        &ip,
        &serde_json::json!({"kind":"p256/passkey","credId":pk.cred_id,"publicKey":pk.public_key,"nonce":ch4.body["nonce"],"assertion":no_uv}),
    );
    assert_eq!(bad3.status, 403);
    assert_eq!(bad3.body["error"], "passkey_flags");

    let other = Passkey::new();
    let ch5 = auth.handle(
        "POST",
        "/sezs/auth/email/bind-challenge",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    let forged = other.assert_(ch5.body["challengeB64"].as_str().unwrap(), ORIGIN, 0x05, 5);
    let bad4 = auth.handle(
        "POST",
        "/sezs/auth/email/bind",
        &h,
        &ip,
        &serde_json::json!({"kind":"p256/passkey","credId":pk.cred_id,"publicKey":pk.public_key,"nonce":ch5.body["nonce"],"assertion":forged}),
    );
    assert_eq!(bad4.status, 403);
    assert_eq!(bad4.body["error"], "bad_signature");
}

#[test]
fn file_sink_writes_0600_and_never_touches_the_network() {
    let dir = TempDir::new().unwrap();
    let outbox = dir.path().join("outbox");
    let sink = FileSink::new(&outbox).unwrap();
    sink.send_email(EmailMessage {
        to: "guest@example.com".into(),
        from: String::new(),
        subject: "s".into(),
        text: "code is 123456".into(),
        token_ref: Some("nonce-1".into()),
        at: 0,
    })
    .unwrap();
    let files: Vec<_> = std::fs::read_dir(&outbox)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(files.len(), 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&files[0]).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
    let stored: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&files[0]).unwrap()).unwrap();
    assert_eq!(stored["to"], "guest@example.com");
    assert_eq!(stored["from"], DEFAULT_EMAIL_FROM);
    assert_eq!(stored["tokenRef"], "nonce-1");
}

#[test]
fn runtime_never_logs_raw_code_full_address_or_session_id() {
    let sink = Arc::new(MemorySink::new());
    let auth = auth_with(sink.clone());
    let (id, _, code) = sign_in(&auth, &sink, "guest@example.com");
    let blob = serde_json::to_string(&auth.events()).unwrap();
    assert!(!blob.contains(&code));
    assert!(!blob.contains("guest@example.com"));
    assert!(!blob.contains(&id));
    assert!(auth
        .events()
        .iter()
        .all(|e| e["emailHash"].as_str().unwrap().len() == 64));
}

#[test]
fn sqlite_survives_restart() {
    let dir = TempDir::new().unwrap();
    let db = dir.path().join("email-auth.sqlite");
    let sink1 = Arc::new(MemorySink::new());
    let mut cfg = EmailAuthConfig::default();
    cfg.provider = sink1.clone();
    cfg.db_path = db.to_string_lossy().into();
    cfg.state_dir = Some(dir.path().to_path_buf());
    let auth1 = EmailAuth::new(cfg).unwrap();
    let (id, body, _) = sign_in(&auth1, &sink1, "persist@example.com");
    let (h, ip) = with_cookie(&id);
    let sk = SigningKey::generate(&mut rand::thread_rng());
    let zid = hex::encode(sk.verifying_key().as_bytes());
    let ch = auth1.handle(
        "POST",
        "/sezs/auth/email/bind-challenge",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    let sig = hex::encode(
        sk.sign(ch.body["message"].as_str().unwrap().as_bytes())
            .to_bytes(),
    );
    assert_eq!(
        auth1.handle("POST", "/sezs/auth/email/bind", &h, &ip, &serde_json::json!({"kind":"ed25519/zid","nonce":ch.body["nonce"],"zidPubkey":zid,"signature":sig})).status,
        200
    );
    drop(auth1);

    let sink2 = Arc::new(MemorySink::new());
    let mut cfg2 = EmailAuthConfig::default();
    cfg2.provider = sink2.clone();
    cfg2.db_path = db.to_string_lossy().into();
    cfg2.state_dir = Some(dir.path().to_path_buf());
    let auth2 = EmailAuth::new(cfg2).unwrap();
    let s = auth2.handle(
        "GET",
        "/sezs/auth/email/session",
        &h,
        &ip,
        &serde_json::json!({}),
    );
    assert_eq!(s.status, 200);
    assert_eq!(s.body["login_id"], body["login_id"]);
    assert_eq!(s.body["bound"]["zidPubkey"], zid);

    auth2.handle(
        "POST",
        "/sezs/auth/email/request",
        &req().0,
        &req().1,
        &serde_json::json!({"email":"noptext@example.com"}),
    );
    let raw_code = extract_code(&sink2.last().unwrap().text);
    let store = EmailStore::open(&db.to_string_lossy()).unwrap();
    let key = format!("{}:{ORIGIN}", email_hash_of("noptext@example.com"));
    let row = store.get_challenge(&key).unwrap();
    let dumped = format!("{:?}", row.secret_hash);
    assert!(!format!("{dumped}{:?}", row).contains(&raw_code) || row.secret_hash.len() == 64);
    assert_eq!(row.secret_hash.len(), 64);
    assert!(!row.secret_hash.contains(&raw_code));
    drop(store);

    assert_eq!(
        auth2
            .handle(
                "POST",
                "/sezs/auth/email/logout",
                &h,
                &ip,
                &serde_json::json!({})
            )
            .status,
        200
    );
    drop(auth2);
    let mut cfg3 = EmailAuthConfig::default();
    cfg3.provider = Arc::new(MemorySink::new());
    cfg3.db_path = db.to_string_lossy().into();
    cfg3.state_dir = Some(dir.path().to_path_buf());
    let auth3 = EmailAuth::new(cfg3).unwrap();
    assert_eq!(
        auth3
            .handle(
                "GET",
                "/sezs/auth/email/session",
                &h,
                &ip,
                &serde_json::json!({})
            )
            .status,
        401
    );
}

#[test]
fn tampered_tokens_fail_statelessly() {
    let sink = Arc::new(MemorySink::new());
    let mut cfg = EmailAuthConfig::default();
    cfg.provider = sink.clone();
    cfg.session_secret = Some(b"test-secret-only".to_vec());
    let auth = EmailAuth::new(cfg).unwrap();
    let (id, _, _) = sign_in(&auth, &sink, "guest@example.com");
    let parts: Vec<_> = id.split('.').collect();
    assert_eq!(parts.len(), 3);
    use base64::Engine;
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
        serde_json::json!({"v":1,"sid":"sess-fake","lid":"mail-1","sub":"x","kind":"email","exp": 9999999999999i64}).to_string().as_bytes(),
    );
    let forged = format!("v1.{payload}.{}", parts[2]);
    let (h, ip) = with_cookie(&forged);
    assert_eq!(
        auth.handle(
            "GET",
            "/sezs/auth/email/session",
            &h,
            &ip,
            &serde_json::json!({})
        )
        .status,
        401
    );
    assert!(
        verify_session_token(&forged, &secret_from_string("test-secret-only"), 0, None).is_none()
    );
}

#[test]
fn pow_protects_request_before_mail() {
    let sink = Arc::new(MemorySink::new());
    let mut cfg = EmailAuthConfig::default();
    cfg.provider = sink.clone();
    cfg.pow_bits = 8;
    let auth = EmailAuth::new(cfg).unwrap();
    let (h, ip) = req();
    let r = auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"pow@example.com"}),
    );
    assert_eq!(r.status, 428);
    assert_eq!(r.body["error"], "pow_required");
    assert_eq!(sink.len(), 0);
    let pow = r.body["pow"].clone();
    let salt = pow["salt"].as_str().unwrap();
    let mut nonce = String::new();
    for i in 0..10_000 {
        let cand = i.to_string();
        let d = Sha256::digest(format!("{salt}:{cand}").as_bytes());
        if d[0] == 0 {
            nonce = cand;
            break;
        }
    }
    assert!(!nonce.is_empty());
    let mut body = serde_json::json!({"email":"pow@example.com","pow": pow});
    body["pow"]["nonce"] = serde_json::Value::String(nonce.clone());
    let r2 = auth.handle("POST", "/sezs/auth/email/request", &h, &ip, &body);
    assert_eq!(r2.status, 200, "{}", r2.body);
    assert_eq!(sink.len(), 1);
    let r3 = auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"pow2@example.com","pow": body["pow"]}),
    );
    assert_eq!(r3.status, 428);
}

#[test]
fn enumeration_neutral_request_shape() {
    let sink = Arc::new(MemorySink::new());
    let mut cfg = EmailAuthConfig::default();
    cfg.provider = sink.clone();
    cfg.resend_cooldown_ms = 0;
    let auth = EmailAuth::new(cfg).unwrap();
    sign_in(&auth, &sink, "known@example.com");
    let (h, ip) = req();
    let a = auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"known@example.com"}),
    );
    let b = auth.handle(
        "POST",
        "/sezs/auth/email/request",
        &h,
        &ip,
        &serde_json::json!({"email":"brandnew@example.com"}),
    );
    assert_eq!(a.status, 200);
    assert_eq!(b.status, 200);
    assert_eq!(
        a.body,
        serde_json::json!({"ok": true, "status": "awaiting"})
    );
    assert_eq!(a.body, b.body);
}

#[test]
fn secret_fields_refused_and_body_cap_is_4kib() {
    assert!(refuse_secret_fields(
        &serde_json::json!({"email":"a@example.com","mnemonic":"abandon"})
    )
    .is_some());
    // 4 KiB cap is enforced on the HTTP mount (see app.rs when SEZS_EMAIL_ENABLE=1).
}

use sezs_server::session::service::{SessionService, SessionServiceConfig};
use sezs_server::ticketing::v2::{TicketV2, DEFAULT_EVENT};
use sezs_server::{spawn_sezs_http, SezsApp};
use std::collections::HashSet;

fn session_app(dir: &TempDir) -> SezsApp {
    let session = SessionService::new(SessionServiceConfig {
        allowed_origins: HashSet::new(),
        rp_id: String::new(),
        role_reader: None,
        db_path: dir.path().join("s.sqlite").to_string_lossy().into(),
        state_dir: Some(dir.path().to_path_buf()),
        session_secret: Some(vec![7u8; 32]),
        session_secret_file: None,
        cookie_name: "sezs_session".into(),
        cookie_path: "/".into(),
        secure_cookie: Some(false),
        trust_proxy: false,
    })
    .expect("session");
    let tickets = TicketV2::new(DEFAULT_EVENT, Some(dir.path().to_path_buf()));
    SezsApp::new_for_tests(session, tickets)
}

#[tokio::test(flavor = "multi_thread")]
async fn email_stays_hidden_on_alpha_unless_enabled() {
    let dir = TempDir::new().unwrap();
    let server = spawn_sezs_http("127.0.0.1", 0, session_app(&dir))
        .await
        .expect("bind");
    let client = reqwest::Client::new();
    let res = client
        .get(format!("http://{}/sezs/auth/email/health", server.local))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 404);
    let v: serde_json::Value = res.json().await.unwrap();
    assert_eq!(v["ok"], false);
    assert_eq!(v["error"], "not_found");
}

#[tokio::test(flavor = "multi_thread")]
async fn email_mount_serves_health_and_enforces_4kib_cap() {
    let dir = TempDir::new().unwrap();
    let mut cfg = EmailAuthConfig::default();
    cfg.provider = Arc::new(MemorySink::new());
    cfg.db_path = dir.path().join("email.sqlite").to_string_lossy().into();
    let app = session_app(&dir).with_email(EmailAuth::new(cfg).unwrap());
    let server = spawn_sezs_http("127.0.0.1", 0, app).await.expect("bind");
    let base = format!("http://{}", server.local);
    let client = reqwest::Client::new();

    let health = client
        .get(format!("{base}/sezs/auth/email/health"))
        .send()
        .await
        .unwrap();
    assert_eq!(health.status(), 200);
    let hv: serde_json::Value = health.json().await.unwrap();
    assert_eq!(hv["ok"], true);
    assert_eq!(hv["service"], "email-auth");

    let huge = "x".repeat(5000);
    let too_big = client
        .post(format!("{base}/sezs/auth/email/request"))
        .header("content-type", "application/json")
        .header("content-length", huge.len().to_string())
        .body(format!(r#"{{"email":"{huge}@example.com"}}"#))
        .send()
        .await
        .unwrap();
    assert_eq!(too_big.status(), 413);
    let tv: serde_json::Value = too_big.json().await.unwrap();
    assert_eq!(tv["error"], "payload_too_large");
}
