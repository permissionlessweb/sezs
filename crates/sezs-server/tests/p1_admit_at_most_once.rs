//! P1. A ticket is admitted at most once.

use sezs_server::ticketing::v2::now_ms;
use sezs_server::ticketing::{test_commitment, Door, Lifecycle, TicketV2, DEFAULT_EVENT};

fn paid_ticket(door: &Door, v2: &TicketV2, c: &str) {
    let now = now_ms();
    let inv = v2.issue_invoice(&serde_json::json!({"rail":"zec","commitment":c}), now);
    assert_eq!(inv["ok"], true, "{inv}");
    door.on_invoice_issued(c);
    let cents = inv["invoice"]["amountCents"].as_i64().unwrap();
    assert_eq!(
        v2.mark_paid(c, Some(cents), now, Some("tx"), Some("zec"), Some(1))["ok"],
        true
    );
    door.on_paid(c);
}

#[test]
fn p1_admit_at_most_once() {
    let door = Door::new();
    let v2 = TicketV2::new(DEFAULT_EVENT, None);
    let c = test_commitment(21);
    paid_ticket(&door, &v2, &c);
    assert!(door.consume(&c, "usher").is_ok());
    assert!(door.admitted(&c));
    assert!(door.p1());
    assert_eq!(door.consume(&c, "usher").unwrap_err(), "cannot_admit");
    assert!(door.p1());
    assert!(door.p1_count_agrees());
}

#[test]
fn p1_guest_cannot_consume() {
    let door = Door::new();
    let v2 = TicketV2::new(DEFAULT_EVENT, None);
    let c = test_commitment(22);
    paid_ticket(&door, &v2, &c);
    assert_eq!(door.consume(&c, "guest").unwrap_err(), "not_usher");
    assert!(!door.admitted(&c));
}

#[test]
fn p1_lifecycle_second_admit_fails() {
    let mut life = Lifecycle::default();
    life.reserve("t1").unwrap();
    life.pay("t1").unwrap();
    life.issue("t1").unwrap();
    life.admit("t1").unwrap();
    assert!(life.p1_admit_at_most_once());
    assert!(life.admit("t1").is_err());
    assert!(life.p1_admit_at_most_once());
}
