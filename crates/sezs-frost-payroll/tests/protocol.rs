//! Protocol and in-process ceremony tests for the moved frost-payroll crate.
use serde_json::json;
use sezs_frost_payroll::{dispatch, run_ceremony, run_json_request};

#[test]
fn ping_and_unknown_op() {
    let p = dispatch(&json!({"op": "ping"})).unwrap();
    assert_eq!(p["ok"], true);
    assert_eq!(p["service"], "sezs-frost-payroll");
    let bad = run_json_request(r#"{"op":"nope"}"#);
    assert_eq!(bad["ok"], false);
}

#[test]
fn ceremony_signs_and_verifies() {
    let msg = "ab".repeat(32);
    let out = run_ceremony(&msg, 2, 3).expect("ceremony");
    assert_eq!(out["ok"], true);
    assert_eq!(out["t"], 2);
    assert_eq!(out["n"], 3);
    let sig = out["signature_hex"].as_str().unwrap();
    let vk = out["verifying_key_hex"].as_str().unwrap();
    assert_eq!(sig.len(), 128);
    let v = dispatch(&json!({
        "op": "verify",
        "verifying_key_hex": vk,
        "signature_hex": sig,
        "message": msg,
    }))
    .unwrap();
    assert_eq!(v["ok"], true);
    assert_eq!(v["valid"], true);
    let wrong = dispatch(&json!({
        "op": "verify",
        "verifying_key_hex": vk,
        "signature_hex": sig,
        "message": "cd".repeat(32),
    }))
    .unwrap_err();
    assert!(!wrong.is_empty());
}
