//! Ticket lifecycle used by door consume, cancel, and refund.
//! Mirrors the Quint model in docs/specs/quint/ticket_lifecycle.qnt.

use std::collections::HashMap;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Ticket {
    pub reserved: bool,
    pub paid: bool,
    pub issued: bool,
    pub admitted: bool,
    pub cancelled: bool,
    pub refunded: bool,
}

impl Ticket {
    /// Paid, issued or admitted, and neither cancelled nor refunded.
    pub fn valid(&self) -> bool {
        self.paid && (self.issued || self.admitted) && !self.cancelled && !self.refunded
    }
}

#[derive(Debug, Default)]
pub struct Lifecycle {
    tickets: HashMap<String, Ticket>,
    admit_count: HashMap<String, u32>,
}

impl Lifecycle {
    pub fn get(&self, id: &str) -> Option<&Ticket> {
        self.tickets.get(id)
    }

    pub fn admit_count(&self, id: &str) -> u32 {
        self.admit_count.get(id).copied().unwrap_or(0)
    }

    /// P1. A ticket is admitted at most once.
    pub fn p1_admit_at_most_once(&self) -> bool {
        self.tickets.keys().all(|id| self.admit_count(id) <= 1)
    }

    pub fn p1_count_agrees(&self) -> bool {
        self.tickets.keys().all(|id| {
            let t = &self.tickets[id];
            if t.admitted {
                self.admit_count(id) == 1
            } else {
                self.admit_count(id) == 0
            }
        })
    }

    /// P3. A cancellation or refund never leaves a ticket both valid and refunded/cancelled.
    pub fn p3_cancel_refund_exclusive(&self) -> bool {
        self.tickets
            .values()
            .all(|t| !(t.valid() && (t.cancelled || t.refunded)))
    }

    pub fn reserve(&mut self, id: &str) -> Result<(), &'static str> {
        if self.tickets.contains_key(id) {
            return Err("already_reserved");
        }
        self.tickets.insert(
            id.to_string(),
            Ticket {
                reserved: true,
                ..Ticket::default()
            },
        );
        self.admit_count.insert(id.to_string(), 0);
        Ok(())
    }

    pub fn pay(&mut self, id: &str) -> Result<(), &'static str> {
        let t = self.tickets.get_mut(id).ok_or("unknown")?;
        if !t.reserved || t.paid || t.cancelled || t.refunded {
            return Err("cannot_pay");
        }
        t.paid = true;
        Ok(())
    }

    pub fn issue(&mut self, id: &str) -> Result<(), &'static str> {
        let t = self.tickets.get_mut(id).ok_or("unknown")?;
        if !t.paid || t.issued || t.admitted || t.cancelled || t.refunded {
            return Err("cannot_issue");
        }
        t.issued = true;
        Ok(())
    }

    pub fn admit(&mut self, id: &str) -> Result<(), &'static str> {
        let count = self.admit_count(id);
        let t = self.tickets.get_mut(id).ok_or("unknown")?;
        if !t.issued || t.admitted || t.cancelled || t.refunded || count != 0 {
            return Err("cannot_admit");
        }
        t.admitted = true;
        self.admit_count.insert(id.to_string(), count + 1);
        Ok(())
    }

    pub fn cancel(&mut self, id: &str) -> Result<(), &'static str> {
        let t = self.tickets.get_mut(id).ok_or("unknown")?;
        if t.admitted || t.cancelled || t.refunded {
            return Err("cannot_cancel");
        }
        t.issued = false;
        t.cancelled = true;
        Ok(())
    }

    pub fn refund(&mut self, id: &str) -> Result<(), &'static str> {
        let t = self.tickets.get_mut(id).ok_or("unknown")?;
        if !t.paid || t.admitted || t.refunded {
            return Err("cannot_refund");
        }
        t.issued = false;
        t.cancelled = true;
        t.refunded = true;
        Ok(())
    }
}
