//! Durable, rebuildable paid-ticket leaf list (splash ticket-leaves.mjs).

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub const TREE_FILE: &str = "ticket-v2-tree.json";

pub fn hex32(raw: &str) -> Option<String> {
    let s = raw
        .trim()
        .to_ascii_lowercase()
        .trim_start_matches("0x")
        .trim_start_matches("sezs1:")
        .to_string();
    if s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(s)
    } else {
        None
    }
}

/// Pallas field check: little-endian 32-byte hex is a canonical leaf.
pub fn is_canonical_leaf(raw: &str) -> bool {
    let Some(s) = hex32(raw) else {
        return false;
    };
    let mut be = [0u8; 32];
    for i in 0..32 {
        let Ok(b) = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16) else {
            return false;
        };
        be[31 - i] = b;
    }
    const P_BE: [u8; 32] = [
        0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x22, 0x46, 0x98, 0xfc, 0x09, 0x4c, 0xf9, 0x1b, 0x99, 0x2d, 0x30, 0xed, 0x00, 0x00,
        0x00, 0x01,
    ];
    be.as_slice() < P_BE.as_slice()
}

pub fn tree_path(root: Option<&Path>) -> Option<PathBuf> {
    root.filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.join(TREE_FILE))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Payment {
    pub commitment: String,
    pub txid: String,
    #[serde(default)]
    pub rail: Option<String>,
    #[serde(default)]
    pub height: Option<i64>,
    #[serde(default, rename = "amountCents")]
    pub amount_cents: Option<i64>,
    #[serde(default)]
    pub at: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StoredTree {
    #[serde(default)]
    pub version: u32,
    #[serde(default, rename = "eventId")]
    pub event_id: Option<String>,
    #[serde(default)]
    pub contract: Option<String>,
    #[serde(default)]
    pub leaves: Vec<String>,
    #[serde(default)]
    pub invoices: Vec<serde_json::Value>,
    #[serde(default)]
    pub published: Vec<serde_json::Value>,
    #[serde(default)]
    pub payments: Vec<Payment>,
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default, rename = "updatedAt")]
    pub updated_at: i64,
}

pub fn empty_tree() -> StoredTree {
    StoredTree {
        version: 1,
        ..StoredTree::default()
    }
}

pub fn load_tree(root: Option<&Path>) -> StoredTree {
    let Some(p) = tree_path(root) else {
        return empty_tree();
    };
    let Ok(text) = std::fs::read_to_string(&p) else {
        return empty_tree();
    };
    let Ok(mut t) = serde_json::from_str::<StoredTree>(&text) else {
        return empty_tree();
    };
    t.leaves = t.leaves.into_iter().filter_map(|s| hex32(&s)).collect();
    t
}

pub fn save_tree(root: Option<&Path>, tree: &StoredTree) -> Option<PathBuf> {
    let p = tree_path(root)?;
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
    }
    let mut out = tree.clone();
    out.version = if out.version == 0 { 1 } else { out.version };
    out.updated_at = now_ms();
    let tmp = p.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&out).ok()? + "\n";
    std::fs::write(&tmp, text).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &p).ok()?;
    Some(p)
}

pub fn merge_leaves(existing: &[String], incoming: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut have = HashSet::new();
    for src in [existing, incoming] {
        for raw in src {
            let Some(c) = hex32(raw) else { continue };
            if have.contains(&c) {
                continue;
            }
            have.insert(c.clone());
            out.push(c);
        }
    }
    out
}

fn pay_key(p: &Payment) -> String {
    format!("{}:{}", p.txid, hex32(&p.commitment).unwrap_or_default())
}

pub fn merge_payments(existing: &[Payment], incoming: &[Payment]) -> Vec<Payment> {
    let mut out = Vec::new();
    let mut have = HashSet::new();
    for src in [existing, incoming] {
        for p in src {
            let Some(c) = hex32(&p.commitment) else {
                continue;
            };
            if p.txid.is_empty() {
                continue;
            }
            let rec = Payment {
                commitment: c,
                txid: p.txid.clone(),
                rail: p.rail.clone(),
                height: p.height,
                amount_cents: p.amount_cents,
                at: p.at,
            };
            let k = pay_key(&rec);
            if have.contains(&k) {
                continue;
            }
            have.insert(k);
            out.push(rec);
        }
    }
    out
}

fn payment_order(a: &Payment, b: &Payment) -> std::cmp::Ordering {
    let ha = a.height.unwrap_or(i64::MAX);
    let hb = b.height.unwrap_or(i64::MAX);
    ha.cmp(&hb)
        .then_with(|| a.txid.cmp(&b.txid))
        .then_with(|| a.commitment.cmp(&b.commitment))
}

/// Keep existing leaf order; append paid commitments not yet in the list.
pub fn rebuild_from_payments(tree: &StoredTree, payments: &[Payment]) -> StoredTree {
    let mut t = tree.clone();
    t.payments = merge_payments(&t.payments, payments);
    let mut sorted = t.payments.clone();
    sorted.sort_by(payment_order);
    let incoming: Vec<String> = sorted.into_iter().map(|p| p.commitment).collect();
    t.leaves = merge_leaves(&t.leaves, &incoming);
    t
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
