//! Simulated-transport and message/grant tests for the first Rust outpost.
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use serde_json::json;
use sezs_outpost::messages::is_terp_addr;
use sezs_outpost::verify::{verify_device_chain, OpenRoles};
use sezs_outpost::{
    decode_frame, decode_grant, decode_usher_reg, encode_consume_device, encode_frame,
    encode_grant, encode_usher_reg, event_tag_hex, spawn_outpost_http, GrantStore, OutpostConfig,
    SimulatedTransport, Transport, FRAME_DOMAIN, GRANT_DOMAIN, USHER_REG_DOMAIN,
};
use tempfile::TempDir;

const EVENT: &str = "event-lab-1";
const USHER: &str = "terp1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const PAYLOAD: &str = "sezs3openingcode";

fn hex32(n: u8) -> String {
    hex::encode([n; 32])
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[test]
fn terp_addr_and_message_round_trips() {
    assert!(is_terp_addr(USHER));
    assert!(!is_terp_addr("not-an-address"));
    let g = encode_grant(
        &hex32(1),
        &hex32(2),
        USHER,
        EVENT,
        "-",
        "scan-ticket",
        now() + 3600,
        &hex32(3),
    )
    .unwrap();
    assert!(g.text.starts_with(GRANT_DOMAIN));
    assert_eq!(decode_grant(&g.text).unwrap(), g);

    let f = encode_frame(&g.hash, &hex32(1), EVENT, None, 1, now(), PAYLOAD).unwrap();
    assert!(f.text.starts_with(FRAME_DOMAIN));
    assert_eq!(f.event_tag, event_tag_hex(EVENT));
    assert_eq!(decode_frame(&f.text).unwrap(), f);

    let c = encode_consume_device(
        USHER,
        EVENT,
        &hex32(10),
        &hex32(11),
        &hex32(12),
        now() + 60,
        &g.hash,
        &f.hash,
        &hex::encode([7u8; 64]),
        1,
    )
    .unwrap();
    assert!(c.text.starts_with("SEZS-CONSUME-V3-DEVICE"));

    let r = encode_usher_reg(EVENT, USHER, "-", "-", now() + 60, &hex32(4)).unwrap();
    assert!(r.text.starts_with(USHER_REG_DOMAIN));
    assert_eq!(decode_usher_reg(&r.text).unwrap(), r);
}

#[test]
fn simulated_transport_connect_ingest_and_next() {
    let mut t = SimulatedTransport::new();
    let d = t.simulate(
        "phone-1".into(),
        "door".into(),
        Some(hex32(1)),
        Some(hex32(2)),
    );
    assert_eq!(d.status, "disconnected");
    let d = t.connect("phone-1").unwrap();
    assert_eq!(d.status, "connected");
    t.ingest(Some("phone-1"), json!({"frame": "one"}), None, None)
        .unwrap();
    t.ingest(Some("phone-1"), json!({"frame": "two"}), None, None)
        .unwrap();
    assert_eq!(t.next("phone-1").unwrap()["frame"], "one");
    assert_eq!(t.next("phone-1").unwrap()["frame"], "two");
    assert!(t.next("phone-1").is_none());
    t.disconnect("phone-1").unwrap();
    assert_eq!(t.devices()[0].status, "disconnected");
}

#[test]
fn revoke_deletes_the_grant_and_expired_are_dropped() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("grants.json");
    let store = GrantStore::open(Some(path.clone()));
    let g = encode_grant(
        &hex32(1),
        &hex32(2),
        USHER,
        EVENT,
        "-",
        "scan-ticket",
        now() + 3600,
        &hex32(3),
    )
    .unwrap();
    let put = store
        .put_grant(
            &g.text,
            &json!({"signature": "ok"}),
            USHER,
            Some("door"),
            &OpenRoles,
            now(),
        )
        .unwrap();
    assert_eq!(store.list().len(), 1);
    let hash = put["hash"].as_str().unwrap().to_string();
    let revoked = store.revoke(&hash).unwrap();
    assert_eq!(revoked["hash"], hash);
    assert!(store.get(&hash).is_none());
    assert_eq!(store.list().len(), 0);

    let g2 = encode_grant(
        &hex32(4),
        &hex32(5),
        USHER,
        EVENT,
        "-",
        "scan-ticket",
        now() + 3600,
        &hex32(6),
    )
    .unwrap();
    store
        .put_grant(
            &g2.text,
            &json!({"signature": "ok"}),
            USHER,
            None,
            &OpenRoles,
            now(),
        )
        .unwrap();
    // expire on disk
    let mut raw: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let h = g2.hash.clone();
    raw["grants"][&h]["grant"]["expiry"] = json!(now() - 10);
    std::fs::write(&path, raw.to_string()).unwrap();
    let store2 = GrantStore::open(Some(path));
    assert_eq!(store2.list().len(), 0);
    assert!(store2.get(&h).is_none());
}

#[test]
fn chain_refuses_forged_and_replayed_frames() {
    let sk = SigningKey::generate(&mut OsRng);
    let pk = hex::encode(sk.verifying_key().to_bytes());
    let noise = hex32(9);
    let g = encode_grant(
        &pk,
        &noise,
        USHER,
        EVENT,
        "-",
        "scan-ticket",
        now() + 3600,
        &hex32(8),
    )
    .unwrap();
    let frame = encode_frame(&g.hash, &pk, EVENT, None, 1, now(), PAYLOAD).unwrap();
    let sig = hex::encode(sk.sign(frame.text.as_bytes()).to_bytes());
    let consume = json!({"nullifier": hex32(10), "root": hex32(11), "proofHash": hex32(12), "eventId": EVENT});
    let auth_text = encode_consume_device(
        USHER,
        EVENT,
        &hex32(10),
        &hex32(11),
        &hex32(12),
        now() + 60,
        &g.hash,
        &frame.hash,
        &sig,
        1,
    )
    .unwrap();
    let roles = OpenRoles;
    let seen = Default::default();
    let ok = verify_device_chain(
        &g.text,
        &json!({"signature": "ok"}),
        USHER,
        "active",
        &frame.text,
        &sig,
        0,
        &seen,
        &consume,
        &auth_text.text,
        &json!({"signature": "ok", "message": auth_text.text}),
        Some(EVENT),
        now(),
        &roles,
    );
    assert!(ok.is_ok(), "{ok:?}");

    // wrong device key
    let other = SigningKey::generate(&mut OsRng);
    let bad = hex::encode(other.sign(frame.text.as_bytes()).to_bytes());
    let err = verify_device_chain(
        &g.text,
        &json!({"signature": "ok"}),
        USHER,
        "active",
        &frame.text,
        &bad,
        0,
        &seen,
        &consume,
        &auth_text.text,
        &json!({"signature": "ok", "message": auth_text.text}),
        Some(EVENT),
        now(),
        &roles,
    )
    .unwrap_err();
    assert_eq!(err.as_str(), "bad_frame_sig");

    // replay of seq
    let mut seen2 = std::collections::BTreeSet::new();
    seen2.insert(format!("{}:1", g.hash));
    let replay = verify_device_chain(
        &g.text,
        &json!({"signature": "ok"}),
        USHER,
        "active",
        &frame.text,
        &sig,
        0,
        &seen2,
        &consume,
        &auth_text.text,
        &json!({"signature": "ok", "message": auth_text.text}),
        Some(EVENT),
        now(),
        &roles,
    )
    .unwrap_err();
    assert_eq!(replay.as_str(), "replayed_frame");
}

#[tokio::test(flavor = "multi_thread")]
async fn loopback_helper_paths_and_non_loopback_refused() {
    let dir = TempDir::new().unwrap();
    let store = GrantStore::open(Some(dir.path().join("g.json")));
    let cfg = OutpostConfig::loopback(0, store);
    let server = spawn_outpost_http(cfg).await.expect("bind");
    assert!(server.local.ip().is_loopback());
    let base = format!("http://{}", server.local);
    let client = reqwest::Client::new();

    let health = client.get(format!("{base}/health")).send().await.unwrap();
    assert_eq!(health.status(), 200);
    let hv: serde_json::Value = health.json().await.unwrap();
    assert_eq!(hv["service"], "sezs-ble-helper");

    let sim = client
        .post(format!("{base}/v1/simulate"))
        .json(&json!({"id": "phone-1", "label": "door", "publicHex": hex32(1)}))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap();
    assert_eq!(sim["ok"], true);

    let conn = client
        .post(format!("{base}/v1/connect"))
        .json(&json!({"id": "phone-1"}))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap();
    assert_eq!(conn["device"]["status"], "connected");

    let ing = client
        .post(format!("{base}/v1/ingest"))
        .json(&json!({"id": "phone-1", "frame": {"text": "SEZS-TICKET-FRAME-V1"}}))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap();
    assert_eq!(ing["ok"], true);

    let nxt = client
        .get(format!("{base}/v1/devices/phone-1/next"))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap();
    assert_eq!(nxt["ok"], true);
    assert_eq!(nxt["frame"]["text"], "SEZS-TICKET-FRAME-V1");

    let empty = client
        .get(format!("{base}/v1/devices/phone-1/next"))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap();
    assert_eq!(empty["frame"], serde_json::Value::Null);

    // Non-loopback bind is refused.
    let store2 = GrantStore::open(None);
    let mut bad = OutpostConfig::loopback(0, store2);
    bad.host = "0.0.0.0".into();
    match spawn_outpost_http(bad).await {
        Ok(_) => panic!("non-loopback bind must be refused"),
        Err(err) => assert!(err.to_string().contains("loopback"), "{err}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn desk_grant_verify_forgets_openings() {
    let dir = TempDir::new().unwrap();
    let store = GrantStore::open(Some(dir.path().join("g.json")));
    let server = spawn_outpost_http(OutpostConfig::loopback(0, store))
        .await
        .expect("bind");
    let base = format!("http://{}", server.local);
    let client = reqwest::Client::new();

    let sk = SigningKey::generate(&mut OsRng);
    let pk = hex::encode(sk.verifying_key().to_bytes());
    let g = encode_grant(
        &pk,
        &hex32(2),
        USHER,
        EVENT,
        "-",
        "scan-ticket",
        now() + 3600,
        &hex32(3),
    )
    .unwrap();
    let put = client
        .post(format!("{base}/sezs/v2/door/device/grant"))
        .json(&json!({"grantText": g.text, "adminSig": {"signature": "ok", "signer": USHER}, "admin": USHER, "label": "door"}))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap();
    assert_eq!(put["ok"], true, "{put}");

    let frame = encode_frame(&g.hash, &pk, EVENT, None, 1, now(), PAYLOAD).unwrap();
    let sig = hex::encode(sk.sign(frame.text.as_bytes()).to_bytes());
    let auth = encode_consume_device(
        USHER,
        EVENT,
        &hex32(10),
        &hex32(11),
        &hex32(12),
        now() + 60,
        &g.hash,
        &frame.hash,
        &sig,
        1,
    )
    .unwrap();

    let _ = client
        .post(format!("{base}/sezs/v2/door/device/ingest"))
        .json(&json!({"frameText": frame.text, "frameSig": sig, "grantHash": g.hash}))
        .send()
        .await
        .unwrap();

    let ver = client
        .post(format!("{base}/sezs/v2/door/device/verify"))
        .json(&json!({
            "frameText": frame.text,
            "frameSig": sig,
            "consume": {"nullifier": hex32(10), "root": hex32(11), "proofHash": hex32(12), "eventId": EVENT},
            "auth": {"signature": "ok", "message": auth.text},
        }))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap();
    assert_eq!(ver["ok"], true, "{ver}");

    // openings dropped from the desk queue after the consume attempt
    let nxt = client
        .get(format!("{base}/sezs/v2/door/device/next"))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap();
    assert_eq!(nxt["frame"], serde_json::Value::Null);
}
