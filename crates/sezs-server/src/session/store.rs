//! SQLite WAL store for challenges, passkeys, sessions, and rate limits.

use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS challenges (
  nonce TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  origin TEXT NOT NULL,
  address TEXT,
  challenge_b64 TEXT,
  message TEXT,
  ts INTEGER NOT NULL,
  exp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_exp ON challenges(exp);

CREATE TABLE IF NOT EXISTS passkeys (
  cred_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  origin TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  exp INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(exp);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,
  timestamps_json TEXT NOT NULL,
  window_end INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_win ON rate_limits(window_end);
"#;

#[derive(Debug, Clone)]
pub struct Challenge {
    pub expired: bool,
    pub nonce: String,
    pub kind: String,
    pub origin: String,
    pub address: String,
    pub challenge_b64: String,
    pub message: String,
    pub ts: i64,
    pub exp: i64,
}

#[derive(Debug, Clone)]
pub struct PasskeyRow {
    pub cred_id: String,
    pub public_key: String,
    pub rp_id: String,
    pub sign_count: i64,
}

#[derive(Debug, Clone)]
pub struct ActiveSession {
    pub id: String,
    pub kind: String,
    pub subject: String,
    pub origin: String,
    pub issued_at: i64,
    pub exp: i64,
}

pub struct SessionStore {
    db: Mutex<Connection>,
    #[allow(dead_code)]
    db_path: PathBuf,
}

impl SessionStore {
    pub fn open(db_path: &str) -> anyhow::Result<Self> {
        if db_path != ":memory:" {
            if let Some(dir) = Path::new(db_path).parent() {
                if !dir.as_os_str().is_empty() {
                    std::fs::create_dir_all(dir)?;
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let _ =
                            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
                    }
                }
            }
        }
        let db = Connection::open(db_path)?;
        db.execute_batch(SCHEMA)?;
        tighten_mode(db_path);
        Ok(Self {
            db: Mutex::new(db),
            db_path: PathBuf::from(db_path),
        })
    }

    pub fn prune(&self, now: i64) {
        if let Ok(db) = self.db.lock() {
            let _ = db.execute("DELETE FROM challenges WHERE exp <= ?1", params![now]);
            let _ = db.execute("DELETE FROM sessions WHERE exp <= ?1", params![now]);
            let _ = db.execute(
                "DELETE FROM rate_limits WHERE window_end <= ?1",
                params![now],
            );
        }
    }

    pub fn hit_rate_limit(&self, key: &str, limit: usize, window_ms: i64, now: i64) -> bool {
        let Ok(mut db) = self.db.lock() else {
            return false;
        };
        let tx = match db.transaction() {
            Ok(t) => t,
            Err(_) => return false,
        };
        let existing: Option<String> = tx
            .query_row(
                "SELECT timestamps_json FROM rate_limits WHERE bucket_key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        let mut arr: Vec<i64> = existing
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        arr.retain(|ts| now - ts < window_ms);
        let allowed = arr.len() < limit;
        if allowed {
            arr.push(now);
        }
        let json = serde_json::to_string(&arr).unwrap_or_else(|_| "[]".into());
        let _ = tx.execute(
            "INSERT INTO rate_limits (bucket_key, timestamps_json, window_end) VALUES (?1, ?2, ?3)
             ON CONFLICT(bucket_key) DO UPDATE SET timestamps_json = excluded.timestamps_json, window_end = excluded.window_end",
            params![key, json, now + window_ms],
        );
        let _ = tx.commit();
        allowed
    }

    pub fn put_challenge(
        &self,
        nonce: &str,
        kind: &str,
        origin: &str,
        address: Option<&str>,
        challenge_b64: Option<&str>,
        message: Option<&str>,
        ts: i64,
        exp: i64,
    ) -> anyhow::Result<()> {
        let db = self.db.lock().map_err(|_| anyhow::anyhow!("db lock"))?;
        db.execute(
            "INSERT INTO challenges (nonce, kind, origin, address, challenge_b64, message, ts, exp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                nonce,
                kind,
                origin,
                address,
                challenge_b64,
                message,
                ts,
                exp
            ],
        )?;
        Ok(())
    }

    pub fn take_challenge(&self, nonce: &str, now: i64) -> Option<Challenge> {
        let mut db = self.db.lock().ok()?;
        let tx = db.transaction().ok()?;
        let row: Option<(String, String, String, Option<String>, Option<String>, Option<String>, i64, i64)> = tx
            .query_row(
                "SELECT nonce, kind, origin, address, challenge_b64, message, ts, exp FROM challenges WHERE nonce = ?1",
                params![nonce],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
            )
            .optional()
            .ok()
            .flatten();
        let Some(r) = row else {
            let _ = tx.commit();
            return None;
        };
        let _ = tx.execute("DELETE FROM challenges WHERE nonce = ?1", params![nonce]);
        let _ = tx.commit();
        Some(Challenge {
            expired: r.7 <= now,
            nonce: r.0,
            kind: r.1,
            origin: r.2,
            address: r.3.unwrap_or_default(),
            challenge_b64: r.4.unwrap_or_default(),
            message: r.5.unwrap_or_default(),
            ts: r.6,
            exp: r.7,
        })
    }

    pub fn get_passkey(&self, cred_id: &str) -> Option<PasskeyRow> {
        let db = self.db.lock().ok()?;
        db.query_row(
            "SELECT cred_id, public_key, rp_id, sign_count FROM passkeys WHERE cred_id = ?1",
            params![cred_id],
            |r| {
                Ok(PasskeyRow {
                    cred_id: r.get(0)?,
                    public_key: r.get(1)?,
                    rp_id: r.get(2)?,
                    sign_count: r.get(3)?,
                })
            },
        )
        .optional()
        .ok()
        .flatten()
    }

    pub fn record_passkey_use(
        &self,
        cred_id: &str,
        public_key: &str,
        rp_id: &str,
        sign_count: i64,
        now: i64,
    ) -> Result<i64, &'static str> {
        let mut db = self.db.lock().map_err(|_| "db lock")?;
        let tx = db.transaction().map_err(|_| "db lock")?;
        let existing: Option<(String, String, i64)> = tx
            .query_row(
                "SELECT public_key, rp_id, sign_count FROM passkeys WHERE cred_id = ?1",
                params![cred_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|_| "db lock")?;
        match existing {
            None => {
                if public_key.is_empty() {
                    return Err("unknown_passkey");
                }
                tx.execute(
                    "INSERT INTO passkeys (cred_id, public_key, rp_id, sign_count, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![cred_id, public_key, rp_id, sign_count, now, now],
                )
                .map_err(|_| "db lock")?;
                tx.commit().map_err(|_| "db lock")?;
                Ok(sign_count)
            }
            Some((existing_key, existing_rp, prev_count)) => {
                if existing_rp != rp_id {
                    return Err("passkey_rp_id");
                }
                if !public_key.is_empty() && existing_key != public_key {
                    return Err("passkey_key_mismatch");
                }
                if prev_count > 0 && sign_count > 0 && sign_count <= prev_count {
                    return Err("passkey_counter");
                }
                let next = prev_count.max(sign_count);
                tx.execute(
                    "UPDATE passkeys SET sign_count = ?1, updated_at = ?2 WHERE cred_id = ?3",
                    params![next, now, cred_id],
                )
                .map_err(|_| "db lock")?;
                tx.commit().map_err(|_| "db lock")?;
                Ok(next)
            }
        }
    }

    pub fn create_session(
        &self,
        session_id: &str,
        kind: &str,
        subject: &str,
        origin: &str,
        issued_at: i64,
        exp: i64,
        revoke_session_id: Option<&str>,
    ) -> anyhow::Result<()> {
        let mut db = self.db.lock().map_err(|_| anyhow::anyhow!("db lock"))?;
        let tx = db.transaction()?;
        if let Some(prev) = revoke_session_id {
            let _ = tx.execute(
                "UPDATE sessions SET revoked_at = ?1 WHERE session_id = ?2 AND revoked_at IS NULL",
                params![issued_at, prev],
            );
        }
        tx.execute(
            "INSERT INTO sessions (session_id, kind, subject, origin, issued_at, exp, revoked_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![session_id, kind, subject, origin, issued_at, exp],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn get_active_session(&self, session_id: &str, now: i64) -> Option<ActiveSession> {
        let db = self.db.lock().ok()?;
        db.query_row(
            "SELECT session_id, kind, subject, origin, issued_at, exp
             FROM sessions
             WHERE session_id = ?1 AND revoked_at IS NULL AND exp > ?2",
            params![session_id, now],
            |r| {
                Ok(ActiveSession {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    subject: r.get(2)?,
                    origin: r.get(3)?,
                    issued_at: r.get(4)?,
                    exp: r.get(5)?,
                })
            },
        )
        .optional()
        .ok()
        .flatten()
    }

    pub fn revoke_session(&self, session_id: &str, now: i64) {
        if let Ok(db) = self.db.lock() {
            let _ = db.execute(
                "UPDATE sessions SET revoked_at = ?1 WHERE session_id = ?2 AND revoked_at IS NULL",
                params![now, session_id],
            );
        }
    }
}

fn tighten_mode(db_path: &str) {
    if db_path.is_empty() || db_path == ":memory:" {
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for suffix in ["", "-wal", "-shm"] {
            let p = format!("{db_path}{suffix}");
            if Path::new(&p).exists() {
                let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
            }
        }
    }
}
