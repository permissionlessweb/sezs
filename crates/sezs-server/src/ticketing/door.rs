//! Door consume, cancel, and refund. Ushers admit; they cannot issue or forge.

use super::lifecycle::Lifecycle;
use super::v2::TicketV2;
use std::sync::Mutex;

pub struct Door {
    life: Mutex<Lifecycle>,
}

impl Door {
    pub fn new() -> Self {
        Self {
            life: Mutex::new(Lifecycle::default()),
        }
    }

    pub fn on_invoice_issued(&self, commitment: &str) {
        let mut g = self.life.lock().expect("life");
        let _ = g.reserve(commitment);
    }

    pub fn on_paid(&self, commitment: &str) {
        let mut g = self.life.lock().expect("life");
        if g.get(commitment).is_none() {
            let _ = g.reserve(commitment);
        }
        let _ = g.pay(commitment);
        let _ = g.issue(commitment);
    }

    /// P2: only the coordinator/ticketing process may insert a paid leaf.
    /// An usher calling this must not succeed.
    pub fn usher_forge_leaf(&self, _usher: &str, _commitment: &str) -> Result<(), &'static str> {
        Err("usher_cannot_forge")
    }

    pub fn usher_issue_invoice(&self, _usher: &str) -> Result<(), &'static str> {
        Err("usher_cannot_issue")
    }

    pub fn consume(&self, commitment: &str, role: &str) -> Result<(), &'static str> {
        if role != "usher" {
            return Err("not_usher");
        }
        self.life.lock().expect("life").admit(commitment)
    }

    pub fn cancel(&self, commitment: &str) -> Result<(), &'static str> {
        self.life.lock().expect("life").cancel(commitment)
    }

    pub fn refund(&self, commitment: &str) -> Result<(), &'static str> {
        self.life.lock().expect("life").refund(commitment)
    }

    pub fn p1(&self) -> bool {
        self.life.lock().expect("life").p1_admit_at_most_once()
    }

    pub fn p1_count_agrees(&self) -> bool {
        self.life.lock().expect("life").p1_count_agrees()
    }

    pub fn p3(&self) -> bool {
        self.life.lock().expect("life").p3_cancel_refund_exclusive()
    }

    pub fn admitted(&self, commitment: &str) -> bool {
        self.life
            .lock()
            .expect("life")
            .get(commitment)
            .map(|t| t.admitted)
            .unwrap_or(false)
    }

    pub fn ticket_valid(&self, commitment: &str) -> bool {
        self.life
            .lock()
            .expect("life")
            .get(commitment)
            .map(|t| t.valid())
            .unwrap_or(false)
    }
}

impl Default for Door {
    fn default() -> Self {
        Self::new()
    }
}

/// Apply a paid invoice to the door book and the v2 tree together.
pub fn record_payment(
    v2: &TicketV2,
    door: &Door,
    commitment: &str,
    amount_cents: Option<i64>,
    now: i64,
) -> serde_json::Value {
    let out = v2.mark_paid(commitment, amount_cents, now, None, None, None);
    if out.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        door.on_paid(commitment);
    }
    out
}
