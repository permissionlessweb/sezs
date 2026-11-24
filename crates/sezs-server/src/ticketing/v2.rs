//! Ticket v2 payment backend (splash ticket-v2.mjs). The backend never sees a ticket secret.

use super::leaves::{
    hex32, is_canonical_leaf, load_tree, merge_leaves, merge_payments, save_tree, Payment,
};
use crate::secret_fields::refuse_secret_fields;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const SUITE: &str = "P128Pow5T3";
pub const TREE_DEPTH: u32 = 10;
pub const CAPACITY: usize = 1 << TREE_DEPTH;
pub const DEFAULT_EVENT: &str = "speakez-sessions";
pub const DEFAULT_SKU: &str = "ga";
pub const LIST_CENTS: i64 = 4000;
pub const LAB_ZEC: &str = "uregtest1labonlydonotsendrealfunds00000000000000000000000000";
pub const LAB_UM: &str = "penumbratest1labonlydonotsendrealfunds00000000000000000000000000";

pub const V2_CORRELATOR_KEYS: &[&str] = &[
    "ticketPubkey",
    "ticket_pubkey",
    "ticketPublicKey",
    "pubkey",
    "nullifier",
    "n",
    "rk",
];

pub fn price_cents(rail: &str) -> i64 {
    let bps = match rail {
        "zec" | "penumbra" => 5000,
        _ => 0,
    };
    LIST_CENTS - (LIST_CENTS * bps) / 10_000
}

fn dest_for(rail: &str) -> String {
    match rail {
        "zec" => std::env::var("SEZS_TICKET_ZEC_DEST").unwrap_or_else(|_| LAB_ZEC.into()),
        "penumbra" => std::env::var("SEZS_TICKET_UM_DEST").unwrap_or_else(|_| LAB_UM.into()),
        _ => String::new(),
    }
}

fn dest_ok(rail: &str, dest: &str) -> bool {
    match rail {
        "zec" => {
            dest.starts_with("uregtest1")
                || dest.starts_with("utest")
                || dest.starts_with("zs1")
                || dest.starts_with("u1")
        }
        "penumbra" => dest.starts_with("penumbratest1") || dest.starts_with("penumbra1"),
        _ => false,
    }
}

fn memo_of(c: &str) -> String {
    format!("sezs1:{c}")
}

fn zip321(address: &str, memo: &str) -> String {
    format!("zcash:{address}?memo={memo}&message=Speakez%20Sessions")
}

fn tree_root(leaves: &[String]) -> String {
    // Deterministic public root over the append-only list. Circuit-identical
    // P128Pow5T3 padding will replace this when the circuit crate is linked.
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(SUITE.as_bytes());
    h.update(&[TREE_DEPTH as u8]);
    for leaf in leaves {
        if let Ok(bytes) = hex::decode(leaf) {
            h.update(&bytes);
        }
    }
    hex::encode(h.finalize())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invoice {
    pub id: String,
    pub rail: String,
    pub sku: String,
    #[serde(rename = "eventId")]
    pub event_id: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    pub commitment: String,
    pub dest: String,
    pub memo: String,
    pub uri: Option<String>,
    pub status: String,
    #[serde(rename = "issuedAt")]
    pub issued_at: i64,
    #[serde(rename = "paidAt")]
    pub paid_at: Option<i64>,
    #[serde(default)]
    pub txid: Option<String>,
    #[serde(default, rename = "seenAt")]
    pub seen_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    #[serde(rename = "invoiceId")]
    pub invoice_id: String,
    pub ciphertext: String,
    #[serde(default, rename = "ephemeral_pubkey")]
    pub ephemeral_pubkey: String,
    #[serde(default, rename = "pq_epoch")]
    pub pq_epoch: i64,
    #[serde(default, rename = "pq_suite")]
    pub pq_suite: Option<String>,
    pub origin: Option<String>,
    #[serde(rename = "storedAt")]
    pub stored_at: i64,
}

#[derive(Debug, Clone, Default)]
pub struct V2State {
    pub event_id: String,
    pub invoices: Vec<Invoice>,
    pub leaves: Vec<String>,
    pub envelopes: Vec<Envelope>,
    pub published: Vec<serde_json::Value>,
    pub payments: Vec<Payment>,
    pub root: String,
}

impl V2State {
    fn new(event_id: &str) -> Self {
        Self {
            event_id: event_id.to_string(),
            root: tree_root(&[]),
            ..Self::default()
        }
    }

    fn rebuild_root(&mut self) {
        self.root = tree_root(&self.leaves);
    }
}

pub struct TicketV2 {
    inner: Mutex<V2State>,
    session_root: Option<PathBuf>,
}

impl TicketV2 {
    pub fn new(event_id: &str, session_root: Option<PathBuf>) -> Self {
        let mut s = V2State::new(event_id);
        if let Some(root) = session_root.as_deref() {
            hydrate_into(&mut s, root);
        }
        Self {
            inner: Mutex::new(s),
            session_root,
        }
    }

    pub fn issue_invoice(&self, body: &serde_json::Value, now: i64) -> serde_json::Value {
        if let Some(refused) = refuse_secret_fields(body) {
            return refused;
        }
        let extra: Vec<&str> = V2_CORRELATOR_KEYS
            .iter()
            .copied()
            .filter(|k| {
                !body
                    .get(*k)
                    .map(|v| v.is_null() || v.as_str() == Some(""))
                    .unwrap_or(true)
            })
            .collect();
        if !extra.is_empty() {
            return serde_json::json!({"ok": false, "error": "v2_no_correlators", "fields": extra});
        }
        let mut g = self.inner.lock().expect("v2 lock");
        let rail = body.get("rail").and_then(|v| v.as_str()).unwrap_or("");
        if rail != "zec" && rail != "penumbra" {
            return serde_json::json!({"ok": false, "error": "bad_rail"});
        }
        let Some(c) = body
            .get("commitment")
            .and_then(|v| v.as_str())
            .and_then(hex32)
            .filter(|c| is_canonical_leaf(c))
        else {
            return serde_json::json!({"ok": false, "error": "bad_commitment"});
        };
        let event_id = body
            .get("eventId")
            .and_then(|v| v.as_str())
            .unwrap_or(&g.event_id)
            .to_string();
        if event_id != g.event_id {
            return serde_json::json!({"ok": false, "error": "wrong_event"});
        }
        if let Some(existing) = g
            .invoices
            .iter()
            .find(|i| i.commitment == c && i.status != "void")
        {
            return serde_json::json!({"ok": true, "invoice": public_invoice(existing), "reused": true});
        }
        let dest = dest_for(rail);
        if !dest_ok(rail, &dest) {
            return serde_json::json!({"ok": false, "error": "bad_dest"});
        }
        let memo = memo_of(&c);
        let uri = if rail == "zec" {
            Some(zip321(&dest, &memo))
        } else {
            None
        };
        let sku = body
            .get("sku")
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_SKU)
            .to_string();
        let mut rng = rand::thread_rng();
        let inv = Invoice {
            id: format!("inv2-{:x}-{:04x}", now, rng.gen::<u16>()),
            rail: rail.to_string(),
            sku,
            event_id,
            amount_cents: price_cents(rail),
            commitment: c,
            dest,
            memo,
            uri,
            status: "pending".into(),
            issued_at: now,
            paid_at: None,
            txid: None,
            seen_at: None,
        };
        g.invoices.push(inv.clone());
        serde_json::json!({"ok": true, "invoice": public_invoice(&inv)})
    }

    pub fn mark_paid(
        &self,
        raw: &str,
        amount_cents: Option<i64>,
        now: i64,
        txid: Option<&str>,
        rail: Option<&str>,
        height: Option<i64>,
    ) -> serde_json::Value {
        let mut g = self.inner.lock().expect("v2 lock");
        let Some(c) = hex32(raw).or_else(|| hex32(&raw.replace("sezs1:", ""))) else {
            return serde_json::json!({"ok": false, "error": "bad_commitment"});
        };
        let Some(idx) = g
            .invoices
            .iter()
            .position(|i| i.commitment == c && i.status != "void")
        else {
            return serde_json::json!({"ok": false, "error": "unknown_invoice"});
        };
        if g.invoices[idx].status == "paid" {
            if let Some(txid) = txid {
                if g.invoices[idx].txid.is_none() {
                    g.invoices[idx].txid = Some(txid.to_string());
                }
                let pay = Payment {
                    commitment: c,
                    txid: txid.to_string(),
                    rail: Some(rail.unwrap_or(&g.invoices[idx].rail).to_string()),
                    height,
                    amount_cents: Some(g.invoices[idx].amount_cents),
                    at: g.invoices[idx].paid_at,
                };
                g.payments = merge_payments(&g.payments, &[pay]);
                persist(&g, self.session_root.as_deref());
            }
            return serde_json::json!({"ok": true, "invoice": public_invoice(&g.invoices[idx]), "already": true});
        }
        if let Some(amt) = amount_cents {
            if amt != g.invoices[idx].amount_cents {
                return serde_json::json!({"ok": false, "error": "amount_mismatch"});
            }
        }
        if g.leaves.len() >= CAPACITY {
            return serde_json::json!({"ok": false, "error": "tree_full"});
        }
        g.invoices[idx].status = "paid".into();
        g.invoices[idx].paid_at = Some(now);
        if let Some(txid) = txid {
            g.invoices[idx].txid = Some(txid.to_string());
        }
        if let Some(txid) = txid {
            let pay = Payment {
                commitment: c.clone(),
                txid: txid.to_string(),
                rail: Some(rail.unwrap_or(&g.invoices[idx].rail).to_string()),
                height,
                amount_cents: Some(g.invoices[idx].amount_cents),
                at: Some(now),
            };
            g.payments = merge_payments(&g.payments, &[pay]);
        }
        if !g.leaves.contains(&c) {
            g.leaves.push(c);
        }
        g.rebuild_root();
        persist(&g, self.session_root.as_deref());
        serde_json::json!({
            "ok": true,
            "invoice": public_invoice(&g.invoices[idx]),
            "root": g.root,
            "leafCount": g.leaves.len(),
        })
    }

    pub fn mark_seen(
        &self,
        raw: &str,
        txid: Option<&str>,
        rail: Option<&str>,
        now: i64,
    ) -> serde_json::Value {
        let mut g = self.inner.lock().expect("v2 lock");
        let Some(c) = hex32(raw).or_else(|| hex32(&raw.replace("sezs1:", ""))) else {
            return serde_json::json!({"ok": false, "error": "bad_commitment"});
        };
        let Some(idx) = g
            .invoices
            .iter()
            .position(|i| i.commitment == c && i.status != "void")
        else {
            return serde_json::json!({"ok": false, "error": "unknown_invoice"});
        };
        if g.invoices[idx].status == "paid" {
            return serde_json::json!({"ok": true, "invoice": public_invoice(&g.invoices[idx]), "already": true, "paid": true});
        }
        if g.invoices[idx].seen_at.is_none() {
            g.invoices[idx].seen_at = Some(now);
        }
        if let Some(txid) = txid {
            if g.invoices[idx].txid.is_none() {
                g.invoices[idx].txid = Some(txid.to_string());
            }
        }
        if let Some(rail) = rail {
            if g.invoices[idx].rail.is_empty() {
                g.invoices[idx].rail = rail.to_string();
            }
        }
        persist(&g, self.session_root.as_deref());
        serde_json::json!({"ok": true, "invoice": public_invoice(&g.invoices[idx]), "paid": false, "phase": "Mempool"})
    }

    pub fn ingest_paid_leaf(&self, hit: &serde_json::Value, now: i64) -> serde_json::Value {
        let c = hit.get("commitment").and_then(|v| v.as_str()).unwrap_or("");
        let amt = hit.get("amountCents").and_then(|v| v.as_i64());
        let txid = hit.get("txid").and_then(|v| v.as_str());
        let rail = hit.get("rail").and_then(|v| v.as_str());
        let height = hit.get("height").and_then(|v| v.as_i64());
        let marked = self.mark_paid(c, amt, now, txid, rail, height);
        if marked.get("ok").and_then(|v| v.as_bool()) == Some(true) {
            return marked;
        }
        let mut g = self.inner.lock().expect("v2 lock");
        let hex = c
            .trim()
            .to_ascii_lowercase()
            .trim_start_matches("0x")
            .trim_start_matches("sezs1:")
            .to_string();
        if hex32(&hex).is_none() || !is_canonical_leaf(&hex) {
            return serde_json::json!({"ok": false, "error": "bad_commitment"});
        }
        if g.leaves.len() >= CAPACITY && !g.leaves.contains(&hex) {
            return serde_json::json!({"ok": false, "error": "tree_full"});
        }
        if !g.leaves.contains(&hex) {
            g.leaves.push(hex.clone());
        }
        if let Some(txid) = txid {
            let pay = Payment {
                commitment: hex.clone(),
                txid: txid.to_string(),
                rail: rail.map(|s| s.to_string()),
                height,
                amount_cents: amt,
                at: Some(now),
            };
            g.payments = merge_payments(&g.payments, &[pay]);
        }
        if !g.invoices.iter().any(|i| i.commitment == hex) {
            let event_id = g.event_id.clone();
            g.invoices.push(Invoice {
                id: format!("rebuilt-{}", &hex[..12]),
                rail: rail.unwrap_or("unknown").to_string(),
                sku: "rebuilt".into(),
                event_id,
                amount_cents: amt.unwrap_or(0),
                commitment: hex.clone(),
                dest: hit
                    .get("dest")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                memo: memo_of(&hex),
                uri: None,
                status: "paid".into(),
                issued_at: now,
                paid_at: Some(now),
                txid: txid.map(|s| s.to_string()),
                seen_at: None,
            });
        }
        g.rebuild_root();
        persist(&g, self.session_root.as_deref());
        serde_json::json!({"ok": true, "rebuilt": true, "root": g.root, "leafCount": g.leaves.len()})
    }

    pub fn leaves(&self) -> serde_json::Value {
        let g = self.inner.lock().expect("v2 lock");
        let last = g.published.last().cloned();
        serde_json::json!({
            "ok": true,
            "eventId": g.event_id,
            "suite": SUITE,
            "depth": TREE_DEPTH,
            "leafCount": g.leaves.len(),
            "leaves": g.leaves,
            "root": g.root,
            "published": last,
        })
    }

    pub fn put_envelope(&self, body: &serde_json::Value, now: i64) -> serde_json::Value {
        if let Some(refused) = refuse_secret_fields(body) {
            return refused;
        }
        if body.get("commitment").is_some() && !body.get("commitment").unwrap().is_null() {
            return serde_json::json!({"ok": false, "error": "v2_envelope_by_invoice_only"});
        }
        let mut g = self.inner.lock().expect("v2 lock");
        let id = body.get("invoiceId").and_then(|v| v.as_str()).unwrap_or("");
        if !g.invoices.iter().any(|i| i.id == id) {
            return serde_json::json!({"ok": false, "error": "unknown_invoice"});
        }
        let Some(ct) = body
            .get("ciphertext")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        else {
            return serde_json::json!({"ok": false, "error": "bad_ciphertext"});
        };
        g.envelopes.push(Envelope {
            invoice_id: id.to_string(),
            ciphertext: ct.to_string(),
            ephemeral_pubkey: body
                .get("ephemeral_pubkey")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            pq_epoch: body.get("pq_epoch").and_then(|v| v.as_i64()).unwrap_or(0),
            pq_suite: body
                .get("pq_suite")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            origin: body
                .get("origin")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            stored_at: now,
        });
        let count = g.envelopes.iter().filter(|e| e.invoice_id == id).count();
        serde_json::json!({"ok": true, "invoiceId": id, "count": count})
    }

    pub fn get_envelopes(&self, invoice_id: &str) -> serde_json::Value {
        let g = self.inner.lock().expect("v2 lock");
        if hex32(invoice_id).is_some() {
            return serde_json::json!({"ok": false, "error": "v2_envelope_by_invoice_only"});
        }
        if !g.invoices.iter().any(|i| i.id == invoice_id) {
            return serde_json::json!({"ok": false, "error": "unknown_invoice"});
        }
        let envelopes: Vec<_> = g
            .envelopes
            .iter()
            .filter(|e| e.invoice_id == invoice_id)
            .cloned()
            .collect();
        serde_json::json!({"ok": true, "invoiceId": invoice_id, "envelopes": envelopes})
    }

    pub fn record_publish(&self, rec: serde_json::Value) {
        let mut g = self.inner.lock().expect("v2 lock");
        g.published.push(rec);
        if g.published.len() > 200 {
            let n = g.published.len() - 200;
            g.published.drain(0..n);
        }
        persist(&g, self.session_root.as_deref());
    }

    pub fn snapshot_leaves(&self) -> Vec<String> {
        self.inner.lock().expect("v2 lock").leaves.clone()
    }

    pub fn invoice_by_commitment(&self, c: &str) -> Option<Invoice> {
        let g = self.inner.lock().expect("v2 lock");
        let c = hex32(c)?;
        g.invoices
            .iter()
            .find(|i| i.commitment == c && i.status != "void")
            .cloned()
    }

    pub fn invoice_by_id(&self, id: &str) -> Option<Invoice> {
        self.inner
            .lock()
            .expect("v2 lock")
            .invoices
            .iter()
            .find(|i| i.id == id)
            .cloned()
    }

    pub fn void_invoice(&self, id: &str) -> Option<Invoice> {
        let mut g = self.inner.lock().expect("v2 lock");
        let inv = g.invoices.iter_mut().find(|i| i.id == id)?;
        inv.status = "void".into();
        Some(inv.clone())
    }
}

fn public_invoice(i: &Invoice) -> serde_json::Value {
    let phase = if i.status == "paid" {
        "Settled"
    } else if i.seen_at.is_some() {
        "Mempool"
    } else {
        "waiting"
    };
    serde_json::json!({
        "id": i.id,
        "rail": i.rail,
        "sku": i.sku,
        "eventId": i.event_id,
        "amountCents": i.amount_cents,
        "commitment": i.commitment,
        "dest": i.dest,
        "memo": i.memo,
        "uri": i.uri,
        "status": i.status,
        "paidAt": i.paid_at,
        "txid": i.txid,
        "phase": phase,
    })
}

fn hydrate_into(s: &mut V2State, root: &Path) {
    let disk = load_tree(Some(root));
    if let Some(event) = disk.event_id {
        if s.event_id.is_empty() {
            s.event_id = event;
        }
    }
    s.leaves = merge_leaves(&disk.leaves, &s.leaves);
    let mut by_c: HashMap<String, usize> = s
        .invoices
        .iter()
        .enumerate()
        .map(|(i, inv)| (inv.commitment.clone(), i))
        .collect();
    for inv in disk.invoices {
        let Some(c) = inv
            .get("commitment")
            .and_then(|v| v.as_str())
            .and_then(hex32)
        else {
            continue;
        };
        if let Some(&idx) = by_c.get(&c) {
            if inv.get("status").and_then(|v| v.as_str()) == Some("paid")
                && s.invoices[idx].status != "paid"
            {
                if let Ok(parsed) = serde_json::from_value::<Invoice>(inv) {
                    s.invoices[idx] = parsed;
                }
            }
        } else if let Ok(parsed) = serde_json::from_value::<Invoice>(inv) {
            by_c.insert(c, s.invoices.len());
            s.invoices.push(parsed);
        }
    }
    if !disk.published.is_empty() && s.published.is_empty() {
        s.published = disk.published;
    }
    s.payments = merge_payments(&disk.payments, &s.payments);
    s.rebuild_root();
}

fn persist(s: &V2State, root: Option<&Path>) {
    let mut disk = load_tree(root);
    disk.event_id = Some(s.event_id.clone());
    disk.leaves = merge_leaves(&disk.leaves, &s.leaves);
    disk.payments = merge_payments(&disk.payments, &s.payments);
    disk.root = Some(s.root.clone());
    if !s.published.is_empty() {
        disk.published = s.published.clone();
    }
    // merge invoices by commitment
    let mut by_c = HashMap::new();
    for inv in disk.invoices.iter().cloned().chain(
        s.invoices
            .iter()
            .map(|i| serde_json::to_value(i).unwrap_or(serde_json::Value::Null)),
    ) {
        if let Some(c) = inv
            .get("commitment")
            .and_then(|v| v.as_str())
            .and_then(hex32)
        {
            by_c.insert(c, inv);
        }
    }
    disk.invoices = by_c.into_values().collect();
    let _ = save_tree(root, &disk);
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// A valid-looking Pallas leaf for tests that do not need a real circuit commitment.
pub fn test_commitment(seed: u8) -> String {
    let mut b = [0u8; 32];
    b[0] = seed;
    b[1] = 0x11;
    hex::encode(b)
}
