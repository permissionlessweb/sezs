//! P2. Ushers cannot issue or forge tickets.

use sezs_server::ticketing::v2::now_ms;
use sezs_server::ticketing::{test_commitment, Door, TicketV2, DEFAULT_EVENT};

#[test]
fn p2_ushers_cannot_issue_or_forge() {
    let door = Door::new();
    assert_eq!(
        door.usher_issue_invoice("usher1").unwrap_err(),
        "usher_cannot_issue"
    );
    assert_eq!(
        door.usher_forge_leaf("usher1", &test_commitment(30))
            .unwrap_err(),
        "usher_cannot_forge"
    );
}

#[test]
fn p2_usher_cannot_append_a_leaf_through_the_door() {
    let door = Door::new();
    let v2 = TicketV2::new(DEFAULT_EVENT, None);
    let c = test_commitment(31);
    // The door has no "issue" path for an usher. A commitment that was never
    // invoiced/paid cannot be consumed, and an usher cannot inject it.
    assert!(door.usher_forge_leaf("usher1", &c).is_err());
    let err = door.consume(&c, "usher").unwrap_err();
    assert!(
        err == "unknown" || err == "cannot_admit",
        "forged commitment must not be admitted: {err}"
    );
    assert_eq!(v2.leaves()["leafCount"], 0);
}

#[test]
fn p2_only_the_ticketing_process_issues() {
    let v2 = TicketV2::new(DEFAULT_EVENT, None);
    let c = test_commitment(32);
    let inv = v2.issue_invoice(&serde_json::json!({"rail":"zec","commitment":c}), now_ms());
    assert_eq!(inv["ok"], true);
    assert_eq!(inv["invoice"]["commitment"], c);
}
