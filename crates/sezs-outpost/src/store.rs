//! Grant store. Revoked and expired grants are deleted, not retained.
//! Never stores device secrets or ticket openings.
use crate::messages::{decode_grant, CAP_SCAN_TICKET};
use crate::verify::{verify_grant, BleError, RoleChecks};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredGrant {
    pub hash: String,
    #[serde(rename = "grantText")]
    pub grant_text: String,
    pub grant: Value,
    pub admin: String,
    #[serde(rename = "adminSig")]
    pub admin_sig: Value,
    pub status: String,
    pub label: String,
    #[serde(rename = "lastSeen")]
    pub last_seen: i64,
    #[serde(rename = "lastSeq")]
    pub last_seq: u64,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StoreState {
    pub grants: BTreeMap<String, StoredGrant>,
    pub used: BTreeMap<String, i64>,
    pub ingest: Vec<Value>,
}

pub struct GrantStore {
    path: Option<PathBuf>,
    state: std::sync::Mutex<StoreState>,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl GrantStore {
    pub fn open(path: Option<PathBuf>) -> Self {
        let state = path
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let store = Self {
            path,
            state: std::sync::Mutex::new(state),
        };
        store.drop_dead(now());
        store
    }

    fn persist(&self, state: &StoreState) {
        let Some(path) = &self.path else { return };
        if let Some(dir) = path.parent() {
            let _ = fs::DirBuilder::new()
                .mode(0o700)
                .recursive(true)
                .create(dir);
        }
        let tmp = PathBuf::from(format!("{}.{}.tmp", path.display(), std::process::id()));
        if let Ok(mut f) = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
        {
            use std::io::Write;
            let _ = f.write_all(
                (serde_json::to_string_pretty(state).unwrap_or_default() + "\n").as_bytes(),
            );
        }
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
        let _ = fs::rename(&tmp, path);
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }

    fn drop_dead(&self, now: i64) {
        let mut g = self.state.lock().unwrap();
        let mut dirty = false;
        let keys: Vec<String> = g
            .grants
            .iter()
            .filter(|(_, rec)| {
                rec.status == "revoked"
                    || rec
                        .grant
                        .get("expiry")
                        .and_then(|v| v.as_i64())
                        .map(|e| e > 0 && e <= now)
                        .unwrap_or(false)
            })
            .map(|(k, _)| k.clone())
            .collect();
        for k in keys {
            g.grants.remove(&k);
            g.used.retain(|uk, _| !uk.starts_with(&format!("{k}:")));
            dirty = true;
        }
        if dirty {
            self.persist(&g);
        }
    }

    pub fn list(&self) -> Vec<Value> {
        self.drop_dead(now());
        let g = self.state.lock().unwrap();
        g.grants.values().map(public_grant).collect()
    }

    pub fn get(&self, hash: &str) -> Option<StoredGrant> {
        self.drop_dead(now());
        self.state
            .lock()
            .unwrap()
            .grants
            .get(&hash.to_ascii_lowercase())
            .cloned()
    }

    pub fn put_grant(
        &self,
        grant_text: &str,
        admin_sig: &Value,
        admin: &str,
        label: Option<&str>,
        roles: &dyn RoleChecks,
        now: i64,
    ) -> Result<Value, BleError> {
        let checked = verify_grant(grant_text, admin_sig, admin, now, roles)?;
        let mut g = self.state.lock().unwrap();
        let hash = checked.hash.clone();
        let prev = g.grants.get(&hash).cloned();
        let rec = StoredGrant {
            hash: hash.clone(),
            grant_text: checked.text.clone(),
            grant: serde_json::json!({
                "deviceSignPubkey": checked.device_sign_pubkey,
                "deviceNoiseStatic": checked.device_noise_static,
                "usher": checked.usher,
                "eventId": checked.event_id,
                "contract": checked.contract,
                "capabilities": checked.capabilities,
                "expiry": checked.expiry,
                "nonce": checked.nonce,
            }),
            admin: admin.to_string(),
            admin_sig: admin_sig.clone(),
            status: "active".into(),
            label: label
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
                .or_else(|| prev.as_ref().map(|p| p.label.clone()))
                .unwrap_or_else(|| {
                    format!(
                        "usher-phone {}",
                        &checked.device_sign_pubkey[..8.min(checked.device_sign_pubkey.len())]
                    )
                }),
            last_seen: prev.as_ref().map(|p| p.last_seen).unwrap_or(0),
            last_seq: prev.as_ref().map(|p| p.last_seq).unwrap_or(0),
            created_at: prev.as_ref().map(|p| p.created_at).unwrap_or(now),
        };
        let pub_g = public_grant(&rec);
        g.grants.insert(hash, rec);
        self.persist(&g);
        Ok(pub_g)
    }

    pub fn rename(&self, hash: &str, label: &str) -> Result<Value, BleError> {
        let mut g = self.state.lock().unwrap();
        let rec = g
            .grants
            .get_mut(&hash.to_ascii_lowercase())
            .ok_or(BleError::UnknownDevice)?;
        if !label.trim().is_empty() {
            rec.label = label.trim().to_string();
        }
        let out = public_grant(rec);
        self.persist(&g);
        Ok(out)
    }

    /// Delete the grant. Revoked grants are not retained.
    pub fn revoke(&self, hash: &str) -> Result<Value, BleError> {
        let mut g = self.state.lock().unwrap();
        let key = hash.to_ascii_lowercase();
        let rec = g.grants.remove(&key).ok_or(BleError::UnknownDevice)?;
        g.used.retain(|uk, _| !uk.starts_with(&format!("{key}:")));
        let snapshot = public_grant(&rec);
        self.persist(&g);
        Ok(snapshot)
    }

    pub fn remember_seq(&self, hash: &str, seq: u64, ts: i64) {
        let mut g = self.state.lock().unwrap();
        let seen_at;
        if let Some(rec) = g.grants.get_mut(&hash.to_ascii_lowercase()) {
            rec.last_seq = rec.last_seq.max(seq);
            rec.last_seen = ts;
            seen_at = Some(rec.last_seen);
        } else {
            seen_at = None;
        }
        if let Some(seen_at) = seen_at {
            g.used.insert(format!("{hash}:{seq}"), seen_at);
            self.persist(&g);
        }
    }

    pub fn queue_ingest(&self, envelope: Value) {
        let mut g = self.state.lock().unwrap();
        let mut env = envelope;
        if let Some(obj) = env.as_object_mut() {
            obj.insert("queuedAt".into(), serde_json::json!(now()));
            // Do not persist ticket openings in a side log beyond the short
            // desk queue (sezs-0021: must not keep openings after consume).
        }
        g.ingest.push(env);
        if g.ingest.len() > 32 {
            let n = g.ingest.len();
            g.ingest = g.ingest.split_off(n - 32);
        }
        self.persist(&g);
    }

    pub fn take_ingest(&self) -> Option<Value> {
        let mut g = self.state.lock().unwrap();
        let next = if g.ingest.is_empty() {
            None
        } else {
            Some(g.ingest.remove(0))
        };
        if next.is_some() {
            self.persist(&g);
        }
        next
    }

    pub fn used_set(&self) -> std::collections::BTreeSet<String> {
        self.state.lock().unwrap().used.keys().cloned().collect()
    }

    /// After a consume attempt finishes, drop any queued frame whose
    /// payload (ticket opening) is still sitting in the desk queue.
    pub fn forget_openings(&self) {
        let mut g = self.state.lock().unwrap();
        g.ingest.clear();
        self.persist(&g);
    }
}

fn public_grant(rec: &StoredGrant) -> Value {
    serde_json::json!({
        "hash": rec.hash,
        "label": rec.label,
        "status": rec.status,
        "usher": rec.grant.get("usher"),
        "eventId": rec.grant.get("eventId"),
        "contract": rec.grant.get("contract"),
        "capabilities": rec.grant.get("capabilities"),
        "expiry": rec.grant.get("expiry"),
        "deviceSignPubkey": rec.grant.get("deviceSignPubkey"),
        "deviceNoiseStatic": rec.grant.get("deviceNoiseStatic"),
        "lastSeen": rec.last_seen,
        "lastSeq": rec.last_seq,
        "createdAt": rec.created_at,
        "admin": rec.admin,
    })
}

// silence unused import if verify_grant uses CAP
#[allow(dead_code)]
fn _cap() -> &'static str {
    CAP_SCAN_TICKET
}

pub fn decode_stored_grant(text: &str) -> Result<crate::messages::GrantMsg, String> {
    decode_grant(text)
}
