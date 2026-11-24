//! Parity of sezs-server tree roots against Node wasm `treeRoot` vectors
//! (P128Pow5T3 via circuits/sezs-ticket-v2).
//!
//! Vectors were produced by `apps/sezs/.zk/sezs-ticket-v2/node/sezs_ticket_v2_wasm.js`.
//!
//! `apps/sezs/src/ticket/ticket.test.mjs` still pins legacy custom-suite
//! hashes (SHA256("sezs-poseidon-pallas-t3-v1") constants). Those values are
//! known stale versus this suite; this test asserts they do not match, and
//! the JS file must not be silently rewritten to the circuit values.

use sezs_server::ticketing::v2::now_ms;
use sezs_server::ticketing::{tree_root, TicketV2, DEFAULT_EVENT};

/// Node wasm `treeRoot([])`.
const WASM_EMPTY_ROOT: &str = "e01482b9f9d66be7feb94d3ba771dec9dc299ecaf91edd612e15cb718c558e01";
/// C = wasm `commitment(secret[0]=1, "ga", "speakez-sessions")`.
const WASM_C_SECRET1: &str = "912fa2e76e7b76fd58491f66e500d34a2fffc885512c3446c969e0c796d2451d";
const WASM_N_SECRET1: &str = "a8a667be7c7a9151d97b1cfe72ba8cc9c1f5371eeb51b598c6cf1298c6667230";
const WASM_ROOT_ONE: &str = "5f6dfca880ed355e0d0e9bdc0c4144afeae658899c81c092f3debaf45aa5f326";
const WASM_C_SECRET2: &str = "78a01a6f880da3a07f062fede579324e5349b833eaf43d755cc5030bc0500104";
const WASM_C_SECRET3: &str = "eb8d0bea6ef938e2fae807bd7d8f49be88aa07cafa6550b039d74cf817758031";
const WASM_ROOT_THREE: &str = "82c313b806d0cd28325f88b2911729baac9d2b240a2bfb4c9e60894ef3fdb428";
/// Raw 32-byte LE leaves 1, 2, 3 (byte 0 only).
const RAW1: &str = "0100000000000000000000000000000000000000000000000000000000000000";
const RAW2: &str = "0200000000000000000000000000000000000000000000000000000000000000";
const RAW3: &str = "0300000000000000000000000000000000000000000000000000000000000000";
const WASM_ROOT_RAW_ONE: &str = "520b59440947c5dc5410ce8324e95ecfe39fc1482d54e1e6d27967a5d2ce4e1a";
const WASM_ROOT_RAW_THREE: &str =
    "9c8d76b9560f00d8b28d1936500dceebd77058a3cfcf86f2a9d9345bdc963a27";

// Legacy custom-suite values from ticket.test.mjs. Do not "fix" these.
const STALE_C_SECRET1: &str = "5d0a9000ba970e7adb34477c2e327dc8d769aeb03abed95d94934299e0083a3a";
const STALE_N_SECRET1: &str = "7a9f989d4d0de0a56cbd87c31f1ee102fbae6e21da14dbddfd5b2123bdc2181f";
const STALE_EMPTY_ROOT: &str = "ae1b19a7651f5f06095c21e6c29e9b35926903ec973dec784e31fa43b2182b3d";
const STALE_ROOT_ONE: &str = "b154c58a77abc1ce48b5b74f870fae6c3972863e096a59889b6c519ff4be7e34";

#[test]
fn p128_empty_and_leaves_match_node_wasm_vectors() {
    assert_eq!(tree_root(&[]), WASM_EMPTY_ROOT);
    assert_eq!(tree_root(&[RAW1.to_string()]), WASM_ROOT_RAW_ONE);
    assert_eq!(
        tree_root(&[RAW1.to_string(), RAW2.to_string(), RAW3.to_string()]),
        WASM_ROOT_RAW_THREE
    );
    assert_eq!(tree_root(&[WASM_C_SECRET1.to_string()]), WASM_ROOT_ONE);
    assert_eq!(
        tree_root(&[
            WASM_C_SECRET1.to_string(),
            WASM_C_SECRET2.to_string(),
            WASM_C_SECRET3.to_string()
        ]),
        WASM_ROOT_THREE
    );
}

#[test]
fn ticket_v2_public_root_is_the_poseidon_root() {
    let v2 = TicketV2::new(DEFAULT_EVENT, None);
    let leaves = v2.leaves();
    assert_eq!(leaves["root"], WASM_EMPTY_ROOT);
    let now = now_ms();
    let c = WASM_C_SECRET1;
    assert_eq!(
        v2.issue_invoice(&serde_json::json!({"rail":"zec","commitment":c}), now)["ok"],
        true
    );
    let cents = v2.invoice_by_commitment(c).expect("invoice").amount_cents;
    assert_eq!(
        v2.mark_paid(c, Some(cents), now, Some("tx"), Some("zec"), Some(1))["ok"],
        true
    );
    let after = v2.leaves();
    assert_eq!(after["leafCount"], 1);
    assert_eq!(after["root"], WASM_ROOT_ONE);
    assert_eq!(after["suite"], "P128Pow5T3");
}

#[test]
fn stale_custom_suite_vectors_are_not_silently_updated() {
    assert_ne!(WASM_C_SECRET1, STALE_C_SECRET1);
    assert_ne!(WASM_N_SECRET1, STALE_N_SECRET1);
    assert_ne!(WASM_EMPTY_ROOT, STALE_EMPTY_ROOT);
    assert_ne!(WASM_ROOT_ONE, STALE_ROOT_ONE);
    assert_ne!(tree_root(&[]), STALE_EMPTY_ROOT);
    assert_ne!(tree_root(&[WASM_C_SECRET1.to_string()]), STALE_ROOT_ONE);
}
