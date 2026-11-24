//! Parity tests against the former Node session tests (removed after the Rust port).

use ed25519_dalek::{Signer, SigningKey};
use p256::ecdsa::{Signature, SigningKey as P256SigningKey};
use sezs_server::session::adr036::{new_admin, sign_adr036};
use sezs_server::session::http::SessionHttpConfig;
use sezs_server::session::token::resolve_session_secret;
use sezs_server::spawn_session_http;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use tempfile::TempDir;

const BALTIMORE: &str = "terp1qf4plkes8hmtpdjp06qmggdd69z067gt2jz6ffgymunxmwcj5p6s60vkyz";
const CHICAGO: &str = "terp1tz0setr8vkh9udp8xyxgpqc89ns27k4d0jx2h942hr0ax63yjhmqx7ajem";
const PHILA: &str = "terp1dyxlfhc3gtlvcerlrsag75vqfx2hukea4723ffqvygu6ta2j98eqct2jsl";
const UNKNOWN_CONTRACT: &str = "terp1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq29z9u7";
const ORIGIN: &str = "https://permissionless.money";

struct Passkey {
    cred_id: String,
    public_key_b64: String,
    sk: P256SigningKey,
}

impl Passkey {
    fn new(cred_id: &str) -> Self {
        let sk = P256SigningKey::random(&mut rand::thread_rng());
        let point = sk.verifying_key().to_encoded_point(false);
        let raw = point.as_bytes();
        assert_eq!(raw.len(), 65);
        assert_eq!(raw[0], 0x04);
        use base64::Engine;
        Self {
            cred_id: cred_id.to_string(),
            public_key_b64: base64::engine::general_purpose::STANDARD.encode(raw),
            sk,
        }
    }

    fn sign_assertion(
        &self,
        challenge_b64: &str,
        origin: &str,
        rp_id: &str,
        flags: u8,
        sign_count: u32,
        cross_origin: bool,
    ) -> serde_json::Value {
        use base64::Engine;
        let client_obj = serde_json::json!({
            "type": "webauthn.get",
            "challenge": challenge_b64,
            "origin": origin,
            "crossOrigin": cross_origin,
        });
        let client_bytes = serde_json::to_vec(&client_obj).unwrap();
        let mut auth_data = vec![0u8; 37];
        let rp_hash = Sha256::digest(rp_id.as_bytes());
        auth_data[..32].copy_from_slice(&rp_hash);
        auth_data[32] = flags;
        auth_data[33..37].copy_from_slice(&sign_count.to_be_bytes());
        let client_hash = Sha256::digest(&client_bytes);
        let mut signed = auth_data.clone();
        signed.extend_from_slice(&client_hash);
        let sig: Signature = self.sk.sign(&signed);
        let der = sig.to_der();
        serde_json::json!({
            "clientDataJSON": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&client_bytes),
            "authenticatorData": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&auth_data),
            "signature": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(der.as_bytes()),
        })
    }
}

async fn start_mock_lcd() -> (
    SocketAddr,
    tokio::task::JoinHandle<()>,
    tokio::sync::oneshot::Sender<()>,
) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    let join = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut rx => break,
                acc = listener.accept() => {
                    let Ok((mut stream, _)) = acc else { continue };
                    tokio::spawn(async move {
                        let mut buf = vec![0u8; 4096];
                        let n = stream.read(&mut buf).await.unwrap_or(0);
                        let req = String::from_utf8_lossy(&buf[..n]);
                        let line = req.lines().next().unwrap_or("");
                        let path = line.split_whitespace().nth(1).unwrap_or("");
                        let re = regex::Regex::new(r"/contract/(terp1[a-z0-9]+)/smart/").unwrap();
                        let contract = re.captures(path).and_then(|c| c.get(1).map(|m| m.as_str().to_string()));
                        let data = match contract.as_deref() {
                            Some(c) if c == BALTIMORE => Some(serde_json::json!({
                                "curators": ["terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052"],
                                "coordinators": ["terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052"],
                                "ushers": ["terp1usher00000000000000000000000000000"],
                                "coordinators_group": "terp1coordbaltimore000000000000000000000000",
                                "usher_group": "terp1usherbaltimore000000000000000000000000",
                            })),
                            Some(c) if c == CHICAGO => Some(serde_json::json!({
                                "curators": ["terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052"],
                                "coordinators": ["terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052"],
                                "ushers": [],
                                "coordinators_group": "terp1coordchicago0000000000000000000000000",
                                "usher_group": "terp1usherchicago0000000000000000000000000",
                            })),
                            Some(c) if c == PHILA => Some(serde_json::json!({
                                "curators": ["terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052"],
                                "coordinators": ["terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052"],
                                "ushers": [],
                                "coordinators_group": "terp1coordphila000000000000000000000000000",
                                "usher_group": "terp1usherphila000000000000000000000000000",
                            })),
                            _ => None,
                        };
                        let (code, body) = if let Some(data) = data {
                            (200, serde_json::json!({"data": data}).to_string())
                        } else {
                            (404, serde_json::json!({"code": 5, "message": "not found"}).to_string())
                        };
                        let resp = format!(
                            "HTTP/1.1 {code} OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                            body.len()
                        );
                        let _ = stream.write_all(resp.as_bytes()).await;
                    });
                }
            }
        }
    });
    (addr, join, tx)
}

fn csrf_headers(fwd: Option<&str>) -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("content-type", "application/json".parse().unwrap());
    h.insert("origin", ORIGIN.parse().unwrap());
    h.insert("x-sezs-frost", "1".parse().unwrap());
    if let Some(ip) = fwd {
        h.insert("x-forwarded-for", ip.parse().unwrap());
    }
    h
}

#[test]
fn production_refuses_to_boot_without_secret() {
    let err = resolve_session_secret(
        None,
        None,
        None,
        &[("NODE_ENV".into(), "production".into())],
    )
    .unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("required in production"),
        "unexpected error: {msg}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn production_loopback_server_parity() {
    let dir = TempDir::new().unwrap();
    let secret_file = dir.path().join("session.secret");
    std::fs::write(&secret_file, "ab".repeat(32) + "\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&secret_file, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let loaded = resolve_session_secret(
        None,
        Some(secret_file.to_str().unwrap()),
        None,
        &[("NODE_ENV".into(), "production".into())],
    )
    .unwrap();
    assert_eq!(loaded.len(), 32);

    let (lcd_addr, _lcd_join, lcd_stop) = start_mock_lcd().await;
    let lcd = format!("http://127.0.0.1:{}", lcd_addr.port());

    let cfg = SessionHttpConfig {
        host: "127.0.0.1".into(),
        port: 0,
        state_dir: dir.path().to_path_buf(),
        db_path: Some(dir.path().join("sessions.sqlite").to_string_lossy().into()),
        allowed_origins: Some(ORIGIN.into()),
        rp_id: "permissionless.money".into(),
        cookie_name: "sezs_session".into(),
        cookie_path: "/alpha/sezs/api".into(),
        secure_cookie: Some(true),
        trust_proxy: true,
        session_secret: None,
        session_secret_file: Some(secret_file.to_string_lossy().into()),
        lcd,
        contracts: format!("{BALTIMORE},{CHICAGO},{PHILA}"),
    };
    let server = spawn_session_http(cfg).await.unwrap();
    let base = format!("http://127.0.0.1:{}", server.local.port());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();

    let health: serde_json::Value = client
        .get(format!("{base}/sezs/session/health"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health["ok"], true);
    assert_eq!(health["service"], "sezs-session");

    for dead in [
        "/__splash/api/scenario",
        "/sezs/v2/leaves",
        "/sezs/v2/paid",
        "/sezs/frost/jobs",
    ] {
        let r = client.get(format!("{base}{dead}")).send().await.unwrap();
        assert_eq!(r.status(), 404, "expected 404 for {dead}");
    }

    let bad_origin = client
        .post(format!("{base}/sezs/session/challenge"))
        .header("content-type", "application/json")
        .header("origin", "https://evil.example")
        .header("x-sezs-frost", "1")
        .body(r#"{"origin":"https://evil.example","kind":"zid"}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(bad_origin.status(), 403);

    let no_csrf = client
        .post(format!("{base}/sezs/session/challenge"))
        .header("content-type", "application/json")
        .header("origin", ORIGIN)
        .body(format!(r#"{{"origin":"{ORIGIN}","kind":"zid"}}"#))
        .send()
        .await
        .unwrap();
    assert_eq!(no_csrf.status(), 403);

    let secret_refused = client
        .post(format!("{base}/sezs/session/challenge"))
        .headers(csrf_headers(None))
        .body(format!(
            r#"{{"origin":"{ORIGIN}","kind":"zid","mnemonic":"abandon"}}"#
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(secret_refused.status(), 400);

    let too_big = client
        .post(format!("{base}/sezs/session/challenge"))
        .headers(csrf_headers(None))
        .body(format!(
            r#"{{"origin":"{ORIGIN}","pad":"{}"}}"#,
            "a".repeat(9000)
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(too_big.status(), 413);

    let zid_sk = SigningKey::generate(&mut rand::thread_rng());
    let zid_pub = hex::encode(zid_sk.verifying_key().as_bytes());

    let ch_zid_res = client
        .post(format!("{base}/sezs/session/challenge"))
        .headers(csrf_headers(Some("203.0.113.10")))
        .body(format!(r#"{{"origin":"{ORIGIN}","kind":"zid"}}"#))
        .send()
        .await
        .unwrap();
    assert_eq!(ch_zid_res.status(), 200);
    let ch_zid: serde_json::Value = ch_zid_res.json().await.unwrap();
    assert_eq!(ch_zid["ok"], true);
    let message = ch_zid["message"].as_str().unwrap();
    let zid_sig = hex::encode(zid_sk.sign(message.as_bytes()).to_bytes());
    let verify_zid_body = serde_json::json!({
        "origin": ORIGIN,
        "nonce": ch_zid["nonce"],
        "ts": ch_zid["ts"],
        "method": "zid",
        "publicKey": zid_pub,
        "signature": zid_sig,
    });
    let vf_zid_res = client
        .post(format!("{base}/sezs/session/verify"))
        .headers(csrf_headers(Some("203.0.113.10")))
        .json(&verify_zid_body)
        .send()
        .await
        .unwrap();
    assert_eq!(vf_zid_res.status(), 200);
    let set_cookie = vf_zid_res
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .collect::<Vec<_>>()
        .join(",");
    let vf_zid: serde_json::Value = vf_zid_res.json().await.unwrap();
    assert_eq!(vf_zid["ok"], true);
    assert_eq!(vf_zid["kind"], "ed25519/zid");
    assert_eq!(vf_zid["login_id"], zid_pub);
    assert!(set_cookie.starts_with("sezs_session=v1."), "{set_cookie}");
    assert!(set_cookie.contains("Path=/alpha/sezs/api"), "{set_cookie}");
    assert!(set_cookie.contains("HttpOnly"), "{set_cookie}");
    assert!(set_cookie.contains("SameSite=Strict"), "{set_cookie}");
    assert!(set_cookie.contains("Secure"), "{set_cookie}");
    let zid_cookie = set_cookie.split(';').next().unwrap();

    let replay = client
        .post(format!("{base}/sezs/session/verify"))
        .headers(csrf_headers(Some("203.0.113.10")))
        .json(&verify_zid_body)
        .send()
        .await
        .unwrap();
    assert_eq!(replay.status(), 400);

    let me_zid: serde_json::Value = client
        .get(format!("{base}/sezs/session/me"))
        .header("cookie", zid_cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(me_zid["ok"], true);
    assert_eq!(me_zid["login_id"], zid_pub);
    assert_eq!(me_zid["kind"], "ed25519/zid");

    let logout = client
        .post(format!("{base}/sezs/session/logout"))
        .header("origin", ORIGIN)
        .header("x-sezs-frost", "1")
        .header("cookie", zid_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(logout.status(), 200);
    let logout_cookie = logout
        .headers()
        .get("set-cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(logout_cookie.contains("Max-Age=0"), "{logout_cookie}");

    let me_after: serde_json::Value = client
        .get(format!("{base}/sezs/session/me"))
        .header("cookie", zid_cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(me_after["ok"], false);
    assert_eq!(me_after["error"], "no_session");

    let pk = Passkey::new("cred-alpha-0123456789abcdef");
    let issue_pk = || {
        let client = client.clone();
        let base = base.clone();
        async move {
            client
                .post(format!("{base}/sezs/session/challenge"))
                .headers(csrf_headers(Some("203.0.113.11")))
                .body(format!(r#"{{"origin":"{ORIGIN}","kind":"passkey"}}"#))
                .send()
                .await
                .unwrap()
                .json::<serde_json::Value>()
                .await
                .unwrap()
        }
    };

    let ch_pk1 = issue_pk().await;
    assert_eq!(ch_pk1["ok"], true);
    assert_eq!(ch_pk1["rpId"], "permissionless.money");

    let bad_rp = client
        .post(format!("{base}/sezs/session/verify"))
        .headers(csrf_headers(Some("203.0.113.11")))
        .json(&serde_json::json!({
            "origin": ORIGIN,
            "nonce": ch_pk1["nonce"],
            "ts": ch_pk1["ts"],
            "method": "passkey",
            "credId": pk.cred_id,
            "publicKey": pk.public_key_b64,
            "assertion": pk.sign_assertion(ch_pk1["challengeB64"].as_str().unwrap(), ORIGIN, "evil.example", 0x05, 1, false),
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_rp.status(), 403);
    let bad_rp_body: serde_json::Value = bad_rp.json().await.unwrap();
    assert_eq!(bad_rp_body["error"], "passkey_rp_id");

    let ch_pk2 = issue_pk().await;
    let bad_uv = client
        .post(format!("{base}/sezs/session/verify"))
        .headers(csrf_headers(Some("203.0.113.11")))
        .json(&serde_json::json!({
            "origin": ORIGIN,
            "nonce": ch_pk2["nonce"],
            "ts": ch_pk2["ts"],
            "method": "passkey",
            "credId": pk.cred_id,
            "publicKey": pk.public_key_b64,
            "assertion": pk.sign_assertion(ch_pk2["challengeB64"].as_str().unwrap(), ORIGIN, "permissionless.money", 0x01, 1, false),
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_uv.status(), 403);
    let bad_uv_body: serde_json::Value = bad_uv.json().await.unwrap();
    assert_eq!(bad_uv_body["error"], "passkey_flags");

    let ch_pk3 = issue_pk().await;
    let vf_pk_res = client
        .post(format!("{base}/sezs/session/verify"))
        .headers(csrf_headers(Some("203.0.113.11")))
        .json(&serde_json::json!({
            "origin": ORIGIN,
            "nonce": ch_pk3["nonce"],
            "ts": ch_pk3["ts"],
            "method": "passkey",
            "credId": pk.cred_id,
            "publicKey": pk.public_key_b64,
            "assertion": pk.sign_assertion(ch_pk3["challengeB64"].as_str().unwrap(), ORIGIN, "permissionless.money", 0x05, 5, false),
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(vf_pk_res.status(), 200);
    let pk_cookie = vf_pk_res
        .headers()
        .get("set-cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let vf_pk: serde_json::Value = vf_pk_res.json().await.unwrap();
    assert_eq!(vf_pk["ok"], true);
    assert_eq!(vf_pk["kind"], "p256/passkey");
    assert_eq!(vf_pk["login_id"], pk.cred_id);
    let me_pk: serde_json::Value = client
        .get(format!("{base}/sezs/session/me"))
        .header("cookie", &pk_cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(me_pk["ok"], true);
    assert_eq!(me_pk["kind"], "p256/passkey");

    let ch_pk4 = issue_pk().await;
    let rollback = client
        .post(format!("{base}/sezs/session/verify"))
        .headers(csrf_headers(Some("203.0.113.11")))
        .json(&serde_json::json!({
            "origin": ORIGIN,
            "nonce": ch_pk4["nonce"],
            "ts": ch_pk4["ts"],
            "method": "passkey",
            "credId": pk.cred_id,
            "assertion": pk.sign_assertion(ch_pk4["challengeB64"].as_str().unwrap(), ORIGIN, "permissionless.money", 0x05, 3, false),
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(rollback.status(), 403);
    let rollback_body: serde_json::Value = rollback.json().await.unwrap();
    assert_eq!(rollback_body["error"], "passkey_counter");

    let pk_other = Passkey::new(&pk.cred_id);
    let ch_pk5 = issue_pk().await;
    let sub = client
        .post(format!("{base}/sezs/session/verify"))
        .headers(csrf_headers(Some("203.0.113.11")))
        .json(&serde_json::json!({
            "origin": ORIGIN,
            "nonce": ch_pk5["nonce"],
            "ts": ch_pk5["ts"],
            "method": "passkey",
            "credId": pk.cred_id,
            "publicKey": pk_other.public_key_b64,
            "assertion": pk_other.sign_assertion(ch_pk5["challengeB64"].as_str().unwrap(), ORIGIN, "permissionless.money", 0x05, 6, false),
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(sub.status(), 403);
    let sub_body: serde_json::Value = sub.json().await.unwrap();
    assert_eq!(sub_body["error"], "passkey_key_mismatch");

    let roles_default: serde_json::Value = client
        .get(format!("{base}/sezs/v2/event/roles"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(roles_default["ok"], true);
    assert_eq!(roles_default["contract"], BALTIMORE);
    assert_eq!(
        roles_default["contracts"],
        serde_json::json!([BALTIMORE, CHICAGO, PHILA])
    );
    let coords = roles_default["coordinators"].as_array().unwrap();
    assert!(coords
        .iter()
        .any(|v| v.as_str() == Some("terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052")));
    assert_eq!(
        roles_default["ushers"][0]["terp"],
        "terp1usher00000000000000000000000000000"
    );

    let roles_chicago: serde_json::Value = client
        .get(format!("{base}/sezs/v2/event/roles?contract={CHICAGO}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(roles_chicago["ok"], true);
    assert_eq!(roles_chicago["contract"], CHICAGO);

    let unknown = client
        .get(format!(
            "{base}/sezs/v2/event/roles?contract={UNKNOWN_CONTRACT}"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(unknown.status(), 400);
    let unknown_body: serde_json::Value = unknown.json().await.unwrap();
    assert_eq!(unknown_body["error"], "unknown_contract");

    let bad_contract = client
        .get(format!(
            "{base}/sezs/v2/event/roles?contract=not-a-contract"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_contract.status(), 400);
    let bad_c: serde_json::Value = bad_contract.json().await.unwrap();
    assert_eq!(bad_c["error"], "bad_contract");

    let (secret, address, _) = new_admin().unwrap();
    assert!(!address.is_empty());
    let ch_adr: serde_json::Value = client
        .post(format!("{base}/sezs/session/challenge"))
        .headers(csrf_headers(Some("203.0.113.12")))
        .json(&serde_json::json!({
            "origin": ORIGIN,
            "kind": "adr036",
            "artist_id": address,
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(ch_adr["ok"], true);
    let msg = ch_adr["message"].as_str().unwrap().as_bytes();
    let (pub_key, signature) = sign_adr036(&address, msg, &secret).unwrap();
    let vf_adr: serde_json::Value = client
        .post(format!("{base}/sezs/session/verify"))
        .headers(csrf_headers(Some("203.0.113.12")))
        .json(&serde_json::json!({
            "origin": ORIGIN,
            "nonce": ch_adr["nonce"],
            "ts": ch_adr["ts"],
            "method": "adr036",
            "artist_id": address,
            "pub_key": { "type": "tendermint/PubKeySecp256k1", "value": pub_key },
            "signature": signature,
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(vf_adr["ok"], true, "{vf_adr}");
    assert_eq!(vf_adr["role"], "guest");
    assert_eq!(vf_adr["live"], true);

    let mut got_429 = false;
    for _ in 0..35 {
        let r = client
            .post(format!("{base}/sezs/session/challenge"))
            .headers(csrf_headers(Some("198.51.100.77")))
            .json(&serde_json::json!({"origin": ORIGIN, "kind": "zid"}))
            .send()
            .await
            .unwrap();
        if r.status() == 429 {
            got_429 = true;
            break;
        }
    }
    assert!(got_429);

    server.close().await;
    let _ = lcd_stop.send(());
}
