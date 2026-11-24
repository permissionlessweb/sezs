//! P3. A cancellation or refund MUST NOT leave a ticket both valid and refunded.

use sezs_server::ticketing::v2::now_ms;
use sezs_server::ticketing::{test_commitment, Door, Lifecycle, TicketV2, DEFAULT_EVENT};

fn paid(door: &Door, v2: &TicketV2, c: &str) {
    let now = now_ms();
    let inv = v2.issue_invoice(&serde_json::json!({"rail":"zec","commitment":c}), now);
    door.on_invoice_issued(c);
    let cents = inv["invoice"]["amountCents"].as_i64().unwrap();
    assert_eq!(
        v2.mark_paid(c, Some(cents), now, Some("tx"), Some("zec"), Some(1))["ok"],
        true
    );
    door.on_paid(c);
}

#[test]
fn p3_cancel_refund_exclusive() {
    let door = Door::new();
    let v2 = TicketV2::new(DEFAULT_EVENT, None);
    let c = test_commitment(41);
    paid(&door, &v2, &c);
    assert!(door.ticket_valid(&c));
    assert!(door.cancel(&c).is_ok());
    assert!(!door.ticket_valid(&c));
    assert!(door.p3());
    assert_eq!(door.consume(&c, "usher").unwrap_err(), "cannot_admit");
    assert!(door.p3());
}

#[test]
fn p3_refund_then_admit_fails() {
    let door = Door::new();
    let v2 = TicketV2::new(DEFAULT_EVENT, None);
    let c = test_commitment(42);
    paid(&door, &v2, &c);
    assert!(door.refund(&c).is_ok());
    assert!(!door.ticket_valid(&c));
    assert!(door.p3());
    assert!(door.consume(&c, "usher").is_err());
}

#[test]
fn p3_admit_then_refund_fails() {
    let door = Door::new();
    let v2 = TicketV2::new(DEFAULT_EVENT, None);
    let c = test_commitment(43);
    paid(&door, &v2, &c);
    assert!(door.consume(&c, "usher").is_ok());
    assert!(door.refund(&c).is_err());
    assert!(door.p3());
}

#[test]
fn p3_lifecycle_matches_quint() {
    let mut life = Lifecycle::default();
    life.reserve("t1").unwrap();
    life.pay("t1").unwrap();
    life.issue("t1").unwrap();
    life.refund("t1").unwrap();
    assert!(!life.get("t1").unwrap().valid());
    assert!(life.p3_cancel_refund_exclusive());
    assert!(life.admit("t1").is_err());
}
