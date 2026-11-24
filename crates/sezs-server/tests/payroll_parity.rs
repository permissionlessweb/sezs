//! Parity with apps/sezs/dev/splash/payroll.test.mjs plus HTTP mount tests.
use serde_json::json;
use sezs_server::payroll::itl_frost::{self, FROST_N, FROST_T};
use sezs_server::payroll::store::{
    accept_signature, create_invite, execute_batch, generate_registration_key, hash_key,
    load_payroll, mark_signing, propose_batch, register_with_key, save_payroll, set_amounts,
    truncate_addr,
};
use sezs_server::payroll::{PayrollService, PayrollServiceConfig};
use sezs_server::session::service::{SessionService, SessionServiceConfig};
use sezs_server::ticketing::v2::{TicketV2, DEFAULT_EVENT};
use sezs_server::{spawn_sezs_http, SezsApp};
use std::collections::HashSet;
use tempfile::TempDir;

const ZEC: &str = "u1testzecaddrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const UM: &str = "penumbra1qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qursceg62w";

fn body_register(key: &str, name: &str) -> serde_json::Value {
    json!({"registrationKey": key, "displayName": name, "zec": ZEC, "um": UM})
}

#[test]
fn generates_a_one_time_key_and_stores_only_a_commitment() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("payroll.json");
    let mut state = load_payroll(&path).unwrap();
    let r = create_invite(&mut state, "artist", "Asha");
    assert_eq!(r["ok"], true);
    let key = r["key"].as_str().unwrap();
    assert!(regex::Regex::new(r"^sezsreg_[0-9a-f]{64}$")
        .unwrap()
        .is_match(key));
    assert_eq!(r["invite"]["status"], "invited");
    save_payroll(&state, &path).unwrap();
    let disk = load_payroll(&path).unwrap();
    assert_eq!(disk.invites.len(), 1);
    assert_eq!(disk.invites[0].commitment, hash_key(key));
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(!raw.contains(key));
    let meta = std::fs::metadata(&path).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(meta.permissions().mode() & 0o777, 0o600);
    }
}

#[test]
fn registers_with_a_valid_key_and_truncates_addresses() {
    let mut state = sezs_server::payroll::PayrollState::default();
    let inv = create_invite(&mut state, "staff", "door");
    let r = register_with_key(
        &mut state,
        &body_register(inv["key"].as_str().unwrap(), "Jordan"),
    );
    assert_eq!(r["ok"], true);
    assert_eq!(r["participant"]["status"], "registered");
    assert_eq!(r["participant"]["displayName"], "Jordan");
    let zec = r["participant"]["zec"].as_str().unwrap();
    assert!(zec.contains('…'));
    assert!(!zec.contains(&ZEC[10..30]));
    assert_eq!(state.invites[0].status, "registered");
    assert!(state.invites[0].consumed_at.is_some());
    assert_eq!(truncate_addr(ZEC).contains('…'), true);
}

#[test]
fn refuses_a_reused_key() {
    let mut state = sezs_server::payroll::PayrollState::default();
    let inv = create_invite(&mut state, "vendor", "");
    let key = inv["key"].as_str().unwrap().to_string();
    assert_eq!(
        register_with_key(&mut state, &body_register(&key, "Kim"))["ok"],
        true
    );
    let again = register_with_key(&mut state, &body_register(&key, "Other"));
    assert_eq!(again["ok"], false);
    assert_eq!(again["error"], "key_consumed");
}

#[test]
fn refuses_a_wrong_key() {
    let mut state = sezs_server::payroll::PayrollState::default();
    create_invite(&mut state, "usher", "");
    let r = register_with_key(
        &mut state,
        &body_register(&generate_registration_key(), "No"),
    );
    assert_eq!(r["ok"], false);
    assert_eq!(r["error"], "unknown_key");
}

#[test]
fn refuses_a_malformed_key() {
    let mut state = sezs_server::payroll::PayrollState::default();
    let r = register_with_key(&mut state, &body_register("not-a-key", "No"));
    assert_eq!(r["ok"], false);
    assert_eq!(r["error"], "bad_key");
}

fn seeded() -> sezs_server::payroll::PayrollState {
    let mut state = sezs_server::payroll::PayrollState::default();
    let inv = create_invite(&mut state, "artist", "set");
    register_with_key(
        &mut state,
        &body_register(inv["key"].as_str().unwrap(), "Asha"),
    );
    let id = state.participants[0].id.clone();
    set_amounts(
        &mut state,
        &json!({"roleAmounts": {"artist": "12"}, "amounts": [{"id": id, "amount": "12"}]}),
    );
    state
}

#[test]
fn proposes_a_batch_and_executes_only_after_a_signature() {
    let mut state = seeded();
    let proposed = propose_batch(&mut state, "session one");
    assert_eq!(proposed["ok"], true);
    assert_eq!(proposed["batch"]["status"], "proposed");
    let digest = proposed["batch"]["digest"].as_str().unwrap();
    assert!(regex::Regex::new(r"^[0-9a-f]{64}$")
        .unwrap()
        .is_match(digest));
    let batch_id = proposed["batch"]["id"].as_str().unwrap().to_string();
    let early = execute_batch(&mut state, &batch_id, None);
    assert_eq!(early["ok"], false);
    mark_signing(&mut state, &batch_id, Some("sess-test"));
    let signed = accept_signature(&mut state, &batch_id, "sig-demo", "pk-demo");
    assert_eq!(signed["ok"], true);
    let missing = execute_batch(&mut state, &batch_id, None);
    assert_eq!(missing["ok"], false);
    assert_eq!(missing["error"], "chain_unavailable");
    let pid = proposed["batch"]["items"][0]["participantId"]
        .as_str()
        .unwrap()
        .to_string();
    let done = execute_batch(
        &mut state,
        &batch_id,
        Some(json!({
            "ok": true,
            "execution": {
                "kind": "local-chain",
                "frostGate": "approval-gated-treasury",
                "zec": [{"participantId": pid, "txid": "ab".repeat(32)}],
                "um": [{"participantId": pid, "txid": "cd".repeat(32)}],
            }
        })),
    );
    assert_eq!(done["ok"], true);
    assert_eq!(done["batch"]["status"], "executed");
    assert_eq!(done["batch"]["execution"]["kind"], "local-chain");
    assert_eq!(
        done["batch"]["execution"]["frostGate"],
        "approval-gated-treasury"
    );
    assert_eq!(state.participants[0].status, "paid");
}

#[test]
fn itl_frost_roster_memo_round_trips() {
    let commit = itl_frost::roster_commit(
        1,
        FROST_T,
        FROST_N,
        "ab".repeat(32).as_str(),
        &["seat-a".into(), "seat-b".into()],
    );
    assert_eq!(commit.len(), 64);
    let memo = itl_frost::spend_memo_roster(&commit);
    assert!(memo.starts_with("itl-frost-memo-v1:"));
    itl_frost::require_spend_memo_roster(&memo, &commit).unwrap();
}

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
async fn payroll_coordinator_routes_require_a_session() {
    let dir = TempDir::new().unwrap();
    let payroll = PayrollService::new(PayrollServiceConfig {
        path: dir.path().join("payroll.json"),
        ..PayrollServiceConfig::default()
    })
    .unwrap();
    let server = spawn_sezs_http("127.0.0.1", 0, session_app(&dir).with_payroll(payroll))
        .await
        .expect("bind");
    let client = reqwest::Client::new();
    let res = client
        .get(format!("http://{}/sezs/payroll/state", server.local))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 403);
    let v: serde_json::Value = res.json().await.unwrap();
    assert_eq!(v["error"], "not_member");
}

#[tokio::test(flavor = "multi_thread")]
async fn payroll_http_invite_register_frost_and_execute() {
    let dir = TempDir::new().unwrap();
    let payroll = PayrollService::with_open_gate(dir.path().join("payroll.json")).unwrap();
    let server = spawn_sezs_http("127.0.0.1", 0, session_app(&dir).with_payroll(payroll))
        .await
        .expect("bind");
    let base = format!("http://{}", server.local);
    let client = reqwest::Client::new();

    let inv = client
        .post(format!("{base}/sezs/payroll/invites"))
        .json(&json!({"role": "artist", "label": "set"}))
        .send()
        .await
        .unwrap();
    assert_eq!(inv.status(), 200);
    let iv: serde_json::Value = inv.json().await.unwrap();
    assert_eq!(iv["ok"], true);
    let key = iv["key"].as_str().unwrap();

    let reg = client
        .post(format!("{base}/sezs/payroll/register"))
        .json(&body_register(key, "Asha"))
        .send()
        .await
        .unwrap();
    let rv: serde_json::Value = reg.json().await.unwrap();
    assert_eq!(rv["ok"], true, "{rv}");
    let pid = rv["participant"]["id"].as_str().unwrap();

    let amt = client
        .post(format!("{base}/sezs/payroll/amounts"))
        .json(&json!({"roleAmounts": {"artist": "12"}, "amounts": [{"id": pid, "amount": "12"}]}))
        .send()
        .await
        .unwrap();
    assert_eq!(amt.json::<serde_json::Value>().await.unwrap()["ok"], true);

    let batch = client
        .post(format!("{base}/sezs/payroll/batches"))
        .json(&json!({"note": "session one"}))
        .send()
        .await
        .unwrap();
    let bv: serde_json::Value = batch.json().await.unwrap();
    assert_eq!(bv["ok"], true, "{bv}");
    let batch_id = bv["batch"]["id"].as_str().unwrap();

    let frost = client
        .post(format!("{base}/sezs/payroll/batches/frost"))
        .json(&json!({"batchId": batch_id}))
        .send()
        .await
        .unwrap();
    let fv: serde_json::Value = frost.json().await.unwrap();
    assert_eq!(fv["ok"], true, "{fv}");
    assert_eq!(fv["batch"]["status"], "signed");
    assert!(fv["spendMemo"]
        .as_str()
        .unwrap()
        .starts_with("itl-frost-memo-v1:"));

    let missing = client
        .post(format!("{base}/sezs/payroll/batches/execute"))
        .json(&json!({"batchId": batch_id}))
        .send()
        .await
        .unwrap();
    let mv: serde_json::Value = missing.json().await.unwrap();
    assert_eq!(mv["error"], "chain_unavailable");

    let done = client
        .post(format!("{base}/sezs/payroll/batches/execute"))
        .json(&json!({
            "batchId": batch_id,
            "payout": {
                "ok": true,
                "execution": {
                    "kind": "local-chain",
                    "frostGate": "approval-gated-treasury",
                    "zec": [{"participantId": pid, "txid": "ab".repeat(32)}],
                    "um": [{"participantId": pid, "txid": "cd".repeat(32)}]
                }
            }
        }))
        .send()
        .await
        .unwrap();
    let dv: serde_json::Value = done.json().await.unwrap();
    assert_eq!(dv["ok"], true, "{dv}");
    assert_eq!(dv["batch"]["status"], "executed");
}
