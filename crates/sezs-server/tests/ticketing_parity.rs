//! Parity with apps/sezs/dev/splash/ticket-v2.test.mjs and ticket-leaves.test.mjs.

use sezs_server::ticketing::leaves::{merge_leaves, rebuild_from_payments, Payment};
use sezs_server::ticketing::v2::{now_ms, test_commitment, TicketV2, DEFAULT_EVENT};
use tempfile::TempDir;

fn fresh() -> TicketV2 {
    TicketV2::new(DEFAULT_EVENT, None)
}

#[test]
fn v2_invoice_records_only_c_rail_sku_event_and_refuses_correlators() {
    let s = fresh();
    let c = test_commitment(1);
    let now = now_ms();
    let refused = s.issue_invoice(
        &serde_json::json!({"rail":"zec","commitment":c,"nullifier":"aa".repeat(32)}),
        now,
    );
    assert_eq!(refused["error"], "v2_no_correlators");
    assert_eq!(refused["fields"][0], "nullifier");
    assert_eq!(
        s.issue_invoice(
            &serde_json::json!({"rail":"zec","commitment":c,"ticketPubkey":"bb".repeat(32)}),
            now
        )["error"],
        "v2_no_correlators"
    );
    assert_eq!(
        s.issue_invoice(
            &serde_json::json!({"rail":"zec","commitment":c,"secret":"cc".repeat(32)}),
            now
        )["ok"],
        false
    );
    let r = s.issue_invoice(
        &serde_json::json!({"rail":"zec","commitment":c,"sku":"ga","eventId":DEFAULT_EVENT}),
        now,
    );
    assert_eq!(r["ok"], true, "{r}");
    let inv = &r["invoice"];
    let mut keys: Vec<_> = inv.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "amountCents",
            "commitment",
            "dest",
            "eventId",
            "id",
            "memo",
            "paidAt",
            "phase",
            "rail",
            "sku",
            "status",
            "txid",
            "uri",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>()
    );
    let reuse = s.issue_invoice(&serde_json::json!({"rail":"zec","commitment":c}), now);
    assert_eq!(reuse["reused"], true);
    assert_eq!(
        s.issue_invoice(
            &serde_json::json!({"rail":"zec","commitment":test_commitment(2),"eventId":"other-event"}),
            now
        )["error"],
        "wrong_event"
    );
}

#[test]
fn paid_leaves_are_append_only_and_carry_no_invoice_link() {
    let s = fresh();
    let now = now_ms();
    let hs = [test_commitment(3), test_commitment(4), test_commitment(5)];
    for c in &hs {
        let inv = s.issue_invoice(&serde_json::json!({"rail":"zec","commitment":c}), now);
        assert_eq!(inv["ok"], true, "{inv}");
        let cents = inv["invoice"]["amountCents"].as_i64().unwrap();
        assert_eq!(
            s.mark_paid(c, Some(cents + 1), now, None, None, None)["error"],
            "amount_mismatch"
        );
        let paid = s.mark_paid(c, Some(cents), now, None, None, None);
        assert_eq!(paid["ok"], true, "{paid}");
    }
    let leaves = s.leaves();
    assert_eq!(leaves["leafCount"], 3);
    assert_eq!(leaves["suite"], "P128Pow5T3");
    assert_eq!(leaves["leaves"].as_array().unwrap().len(), 3);
    let dumped = leaves.to_string();
    assert!(
        !dumped.contains("invoice"),
        "leaf list carries no invoice link"
    );
    assert!(!dumped.contains("inv2-"));
}

#[test]
fn sealed_backup_by_invoice_id_only() {
    let s = fresh();
    let now = now_ms();
    let c = test_commitment(6);
    let inv = s.issue_invoice(&serde_json::json!({"rail":"penumbra","commitment":c}), now);
    assert_eq!(inv["ok"], true, "{inv}");
    let id = inv["invoice"]["id"].as_str().unwrap();
    assert_eq!(
        s.put_envelope(&serde_json::json!({"commitment":c,"ciphertext":"x"}), now)["error"],
        "v2_envelope_by_invoice_only"
    );
    assert_eq!(
        s.put_envelope(
            &serde_json::json!({"invoiceId":id,"ciphertext":"sealed"}),
            now
        )["ok"],
        true
    );
    assert_eq!(s.get_envelopes(&c)["error"], "v2_envelope_by_invoice_only");
    assert_eq!(
        s.get_envelopes(id)["envelopes"].as_array().unwrap().len(),
        1
    );
    assert_eq!(
        s.put_envelope(&serde_json::json!({"invoiceId":id,"plaintext":"no"}), now)["ok"],
        false
    );
}

#[test]
fn paid_leaves_persist_and_rebuild_after_restart() {
    let dir = TempDir::new().unwrap();
    let c = test_commitment(7);
    let now = now_ms();
    {
        let s = TicketV2::new(DEFAULT_EVENT, Some(dir.path().to_path_buf()));
        let inv = s.issue_invoice(&serde_json::json!({"rail":"zec","commitment":c}), now);
        let cents = inv["invoice"]["amountCents"].as_i64().unwrap();
        assert_eq!(
            s.mark_paid(&c, Some(cents), now, Some("tx1"), Some("zec"), Some(10))["ok"],
            true
        );
        assert_eq!(s.leaves()["leafCount"], 1);
    }
    let restarted = TicketV2::new(DEFAULT_EVENT, Some(dir.path().to_path_buf()));
    assert_eq!(restarted.leaves()["leafCount"], 1);
    assert_eq!(restarted.leaves()["leaves"][0], c);
}

#[test]
fn ingest_paid_leaf_rebuilds_without_a_live_invoice() {
    let s = fresh();
    let c = test_commitment(8);
    let r = s.ingest_paid_leaf(
        &serde_json::json!({"commitment":c,"txid":"tx-rebuild","rail":"zec","height":12,"amountCents":2000}),
        now_ms(),
    );
    assert_eq!(r["ok"], true, "{r}");
    assert_eq!(r["rebuilt"], true);
    assert_eq!(s.leaves()["leafCount"], 1);
    assert_eq!(s.leaves()["leaves"][0], c);
}

#[test]
fn mark_seen_records_mempool_without_paying_or_appending_a_leaf() {
    let s = fresh();
    let c = test_commitment(9);
    let now = now_ms();
    assert_eq!(
        s.issue_invoice(&serde_json::json!({"rail":"zec","commitment":c}), now)["ok"],
        true
    );
    let seen = s.mark_seen(&c, Some("tx-mem"), Some("zec"), now);
    assert_eq!(seen["ok"], true, "{seen}");
    assert_eq!(seen["paid"], false);
    assert_eq!(seen["phase"], "Mempool");
    assert_eq!(s.leaves()["leafCount"], 0);
}

#[test]
fn merge_leaves_is_append_only_and_deduplicates() {
    let a = vec![test_commitment(1), test_commitment(2)];
    let b = vec![test_commitment(2), test_commitment(3)];
    let m = merge_leaves(&a, &b);
    assert_eq!(
        m,
        vec![test_commitment(1), test_commitment(2), test_commitment(3)]
    );
}

#[test]
fn rebuild_from_payments_keeps_existing_order_and_appends_by_height() {
    let mut tree = sezs_server::ticketing::leaves::empty_tree();
    tree.leaves = vec![test_commitment(1)];
    let payments = vec![
        Payment {
            commitment: test_commitment(3),
            txid: "b".into(),
            rail: Some("zec".into()),
            height: Some(20),
            amount_cents: Some(2000),
            at: None,
        },
        Payment {
            commitment: test_commitment(2),
            txid: "a".into(),
            rail: Some("zec".into()),
            height: Some(10),
            amount_cents: Some(2000),
            at: None,
        },
    ];
    let rebuilt = rebuild_from_payments(&tree, &payments);
    assert_eq!(
        rebuilt.leaves,
        vec![test_commitment(1), test_commitment(2), test_commitment(3)]
    );
}

use sezs_server::session::service::{SessionService, SessionServiceConfig};
use sezs_server::{spawn_sezs_http, SezsApp};
use std::collections::HashSet;

fn test_app(dir: &TempDir) -> SezsApp {
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
async fn one_bind_mounts_session_and_ticketing_under_sezs() {
    let dir = TempDir::new().unwrap();
    let server = spawn_sezs_http("127.0.0.1", 0, test_app(&dir))
        .await
        .expect("bind");
    let base = format!("http://{}", server.local);
    let client = reqwest::Client::new();

    let health = client
        .get(format!("{base}/sezs/session/health"))
        .send()
        .await
        .unwrap();
    assert_eq!(health.status(), 200);
    let hv: serde_json::Value = health.json().await.unwrap();
    assert_eq!(hv["ok"], true);

    let alias = client
        .get(format!("{base}/itl/session/health"))
        .send()
        .await
        .unwrap();
    assert_eq!(alias.status(), 200);

    let leaves = client
        .get(format!("{base}/sezs/v2/leaves"))
        .send()
        .await
        .unwrap();
    assert_eq!(leaves.status(), 200);
    let lv: serde_json::Value = leaves.json().await.unwrap();
    assert_eq!(lv["ok"], true);
    assert_eq!(lv["leafCount"], 0);

    let c = test_commitment(11);
    let inv = client
        .post(format!("{base}/sezs/v2/invoice"))
        .json(&serde_json::json!({"rail":"zec","commitment":c}))
        .send()
        .await
        .unwrap();
    let inv_status = inv.status();
    let iv: serde_json::Value = inv.json().await.unwrap();
    assert_eq!(inv_status, 200, "{iv}");
    assert_eq!(iv["ok"], true);
    let cents = iv["invoice"]["amountCents"].as_i64().unwrap();

    let pay = client
        .post(format!("{base}/sezs/v2/paid"))
        .json(&serde_json::json!({
            "commitment": c,
            "txid": "tx-http",
            "rail": "zec",
            "height": 1,
            "amountCents": cents
        }))
        .send()
        .await
        .unwrap();
    let pv: serde_json::Value = pay.json().await.unwrap();
    assert_eq!(pv["ok"], true, "{pv}");

    let guest = client
        .post(format!("{base}/sezs/v2/door/consume"))
        .json(&serde_json::json!({"commitment": c}))
        .send()
        .await
        .unwrap();
    assert_eq!(guest.status(), 403);

    let admit = client
        .post(format!("{base}/sezs/v2/door/consume"))
        .header("x-sezs-role", "usher")
        .json(&serde_json::json!({"commitment": c}))
        .send()
        .await
        .unwrap();
    assert_eq!(admit.status(), 200);
    let av: serde_json::Value = admit.json().await.unwrap();
    assert_eq!(av["ok"], true);
    assert_eq!(av["p1"], true);

    let twice = client
        .post(format!("{base}/sezs/v2/door/consume"))
        .header("x-sezs-role", "usher")
        .json(&serde_json::json!({"commitment": c}))
        .send()
        .await
        .unwrap();
    assert_eq!(twice.status(), 400);
    let tv: serde_json::Value = twice.json().await.unwrap();
    assert_eq!(tv["error"], "cannot_admit");

    let quote = client
        .get(format!("{base}/sezs/pay/health"))
        .send()
        .await
        .unwrap();
    assert_eq!(quote.status(), 200);

    server.close().await;
}
