//! SQLite store for hashed email challenges, mailboxes, sessions, and limits.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::Path;
use std::sync::Mutex;

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS email_challenges (
  key TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  origin TEXT NOT NULL,
  nonce TEXT NOT NULL,
  ts INTEGER NOT NULL,
  issued_at INTEGER NOT NULL,
  exp INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  secret_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_challenges_exp ON email_challenges(exp);

CREATE TABLE IF NOT EXISTS bind_challenges (
  nonce TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  ts INTEGER NOT NULL,
  exp INTEGER NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bind_challenges_exp ON bind_challenges(exp);

CREATE TABLE IF NOT EXISTS mailboxes (
  email_hash TEXT PRIMARY KEY,
  login_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  zid_pubkey TEXT,
  passkey_cred_id TEXT,
  passkey_pubkey TEXT,
  passkey_rp_id TEXT,
  passkey_sign_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
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
    pub key: String,
    pub email_hash: String,
    pub origin: String,
    pub nonce: String,
    pub ts: i64,
    pub issued_at: i64,
    pub exp: i64,
    pub attempts: i64,
    pub secret_hash: String,
}

#[derive(Debug, Clone)]
pub struct BindChallenge {
    pub nonce: String,
    pub session_id: String,
    pub origin: String,
    pub ts: i64,
    pub exp: i64,
    pub message: String,
}

#[derive(Debug, Clone, Default)]
pub struct BoundPasskey {
    pub cred_id: String,
    pub public_key: String,
    pub rp_id: String,
    pub sign_count: u32,
}

#[derive(Debug, Clone, Default)]
pub struct Mailbox {
    pub email_hash: String,
    pub login_id: String,
    pub email: String,
    pub zid_pubkey: Option<String>,
    pub passkey: Option<BoundPasskey>,
}

#[derive(Debug, Clone)]
pub struct ActiveSession {
    pub id: String,
    pub email_hash: String,
    pub origin: String,
    pub issued_at: i64,
    pub exp: i64,
    pub mailbox: Mailbox,
}

pub struct EmailStore {
    conn: Mutex<Connection>,
}

impl EmailStore {
    pub fn open(db_path: &str) -> anyhow::Result<Self> {
        if db_path != ":memory:" {
            if let Some(dir) = Path::new(db_path).parent() {
                std::fs::create_dir_all(dir)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
                }
            }
        }
        let conn = Connection::open(db_path)?;
        conn.execute_batch(SCHEMA)?;
        tighten_mode(db_path);
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn prune(&self, now: i64) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute("DELETE FROM email_challenges WHERE exp <= ?1", params![now]);
        let _ = conn.execute("DELETE FROM bind_challenges WHERE exp <= ?1", params![now]);
        let _ = conn.execute("DELETE FROM sessions WHERE exp <= ?1", params![now]);
        let _ = conn.execute(
            "DELETE FROM rate_limits WHERE window_end <= ?1",
            params![now],
        );
    }

    pub fn hit_rate_limit(&self, key: &str, limit: usize, window_ms: i64, now: i64) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.execute("BEGIN IMMEDIATE", []).ok();
        let row: Option<String> = conn
            .query_row(
                "SELECT timestamps_json FROM rate_limits WHERE bucket_key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        let mut arr: Vec<i64> = row
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        arr.retain(|ts| now - *ts < window_ms);
        let ok = if arr.len() >= limit {
            false
        } else {
            arr.push(now);
            true
        };
        let json = serde_json::to_string(&arr).unwrap();
        let _ = conn.execute(
            "INSERT INTO rate_limits (bucket_key, timestamps_json, window_end) VALUES (?1, ?2, ?3)
             ON CONFLICT(bucket_key) DO UPDATE SET timestamps_json = excluded.timestamps_json, window_end = excluded.window_end",
            params![key, json, now + window_ms],
        );
        if ok {
            let _ = conn.execute("COMMIT", []);
        } else {
            let _ = conn.execute("COMMIT", []);
        }
        ok
    }

    pub fn get_challenge(&self, key: &str) -> Option<Challenge> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT key, email_hash, origin, nonce, ts, issued_at, exp, attempts, secret_hash FROM email_challenges WHERE key = ?1",
            params![key],
            map_challenge,
        )
        .optional()
        .ok()
        .flatten()
    }

    pub fn put_challenge(&self, ch: &Challenge) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO email_challenges (key, email_hash, origin, nonce, ts, issued_at, exp, attempts, secret_hash)
             VALUES (?1,?2,?3,?4,?5,?6,?7,0,?8)
             ON CONFLICT(key) DO UPDATE SET
               email_hash=excluded.email_hash, origin=excluded.origin, nonce=excluded.nonce,
               ts=excluded.ts, issued_at=excluded.issued_at, exp=excluded.exp, attempts=0, secret_hash=excluded.secret_hash",
            params![ch.key, ch.email_hash, ch.origin, ch.nonce, ch.ts, ch.issued_at, ch.exp, ch.secret_hash],
        );
    }

    pub fn verify_and_consume(
        &self,
        key: &str,
        now: i64,
        max_attempts: i64,
        check: impl Fn(&Challenge) -> bool,
    ) -> VerifyOutcome {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute("BEGIN IMMEDIATE", []);
        let row = conn
            .query_row(
                "SELECT key, email_hash, origin, nonce, ts, issued_at, exp, attempts, secret_hash FROM email_challenges WHERE key = ?1",
                params![key],
                map_challenge,
            )
            .optional()
            .ok()
            .flatten();
        let Some(ch) = row else {
            let _ = conn.execute("COMMIT", []);
            return VerifyOutcome::Unknown;
        };
        if ch.exp <= now {
            let _ = conn.execute("DELETE FROM email_challenges WHERE key = ?1", params![key]);
            let _ = conn.execute("COMMIT", []);
            return VerifyOutcome::Expired;
        }
        if !check(&ch) {
            let next = ch.attempts + 1;
            if next >= max_attempts {
                let _ = conn.execute("DELETE FROM email_challenges WHERE key = ?1", params![key]);
                let _ = conn.execute("COMMIT", []);
                return VerifyOutcome::BadCode {
                    burned: true,
                    attempts: next,
                };
            }
            let _ = conn.execute(
                "UPDATE email_challenges SET attempts = ?1 WHERE key = ?2",
                params![next, key],
            );
            let _ = conn.execute("COMMIT", []);
            return VerifyOutcome::BadCode {
                burned: false,
                attempts: next,
            };
        }
        let _ = conn.execute("DELETE FROM email_challenges WHERE key = ?1", params![key]);
        let _ = conn.execute("COMMIT", []);
        VerifyOutcome::Ok(ch)
    }

    pub fn put_bind_challenge(&self, ch: &BindChallenge) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO bind_challenges (nonce, session_id, origin, ts, exp, message) VALUES (?1,?2,?3,?4,?5,?6)",
            params![ch.nonce, ch.session_id, ch.origin, ch.ts, ch.exp, ch.message],
        );
    }

    pub fn take_bind_challenge(&self, nonce: &str) -> Option<BindChallenge> {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute("BEGIN IMMEDIATE", []);
        let row = conn
            .query_row(
                "SELECT nonce, session_id, origin, ts, exp, message FROM bind_challenges WHERE nonce = ?1",
                params![nonce],
                |r| {
                    Ok(BindChallenge {
                        nonce: r.get(0)?,
                        session_id: r.get(1)?,
                        origin: r.get(2)?,
                        ts: r.get(3)?,
                        exp: r.get(4)?,
                        message: r.get(5)?,
                    })
                },
            )
            .optional()
            .ok()
            .flatten();
        if row.is_some() {
            let _ = conn.execute(
                "DELETE FROM bind_challenges WHERE nonce = ?1",
                params![nonce],
            );
        }
        let _ = conn.execute("COMMIT", []);
        row
    }

    pub fn get_or_create_mailbox(
        &self,
        email_hash: &str,
        email: &str,
        login_id: &str,
        now: i64,
    ) -> Mailbox {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute("BEGIN IMMEDIATE", []);
        if let Ok(Some(m)) = conn
            .query_row(
                "SELECT email_hash, login_id, email, zid_pubkey, passkey_cred_id, passkey_pubkey, passkey_rp_id, passkey_sign_count FROM mailboxes WHERE email_hash = ?1",
                params![email_hash],
                map_mailbox,
            )
            .optional()
        {
            let _ = conn.execute("COMMIT", []);
            return m;
        }
        let _ = conn.execute(
            "INSERT INTO mailboxes (email_hash, login_id, email, created_at, updated_at) VALUES (?1,?2,?3,?4,?5)",
            params![email_hash, login_id, email, now, now],
        );
        let m = conn
            .query_row(
                "SELECT email_hash, login_id, email, zid_pubkey, passkey_cred_id, passkey_pubkey, passkey_rp_id, passkey_sign_count FROM mailboxes WHERE email_hash = ?1",
                params![email_hash],
                map_mailbox,
            )
            .unwrap();
        let _ = conn.execute("COMMIT", []);
        m
    }

    pub fn bind_zid(&self, email_hash: &str, zid_pubkey: &str, now: i64) -> Mailbox {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "UPDATE mailboxes SET zid_pubkey = ?1, updated_at = ?2 WHERE email_hash = ?3",
            params![zid_pubkey, now, email_hash],
        );
        conn.query_row(
            "SELECT email_hash, login_id, email, zid_pubkey, passkey_cred_id, passkey_pubkey, passkey_rp_id, passkey_sign_count FROM mailboxes WHERE email_hash = ?1",
            params![email_hash],
            map_mailbox,
        )
        .unwrap()
    }

    pub fn bind_passkey(
        &self,
        email_hash: &str,
        cred_id: &str,
        public_key: &str,
        rp_id: &str,
        sign_count: u32,
        now: i64,
    ) -> Mailbox {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "UPDATE mailboxes SET passkey_cred_id=?1, passkey_pubkey=?2, passkey_rp_id=?3, passkey_sign_count=?4, updated_at=?5 WHERE email_hash=?6",
            params![cred_id, public_key, rp_id, sign_count, now, email_hash],
        );
        conn.query_row(
            "SELECT email_hash, login_id, email, zid_pubkey, passkey_cred_id, passkey_pubkey, passkey_rp_id, passkey_sign_count FROM mailboxes WHERE email_hash = ?1",
            params![email_hash],
            map_mailbox,
        )
        .unwrap()
    }

    pub fn create_session(
        &self,
        session_id: &str,
        email_hash: &str,
        origin: &str,
        issued_at: i64,
        exp: i64,
        revoke_session_id: Option<&str>,
    ) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute("BEGIN IMMEDIATE", []);
        if let Some(prev) = revoke_session_id {
            let _ = conn.execute(
                "UPDATE sessions SET revoked_at = ?1 WHERE session_id = ?2 AND revoked_at IS NULL",
                params![issued_at, prev],
            );
        }
        let _ = conn.execute(
            "INSERT INTO sessions (session_id, email_hash, origin, issued_at, exp, revoked_at) VALUES (?1,?2,?3,?4,?5,NULL)",
            params![session_id, email_hash, origin, issued_at, exp],
        );
        let _ = conn.execute("COMMIT", []);
    }

    pub fn get_active_session(&self, session_id: &str, now: i64) -> Option<ActiveSession> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT s.session_id, s.email_hash, s.origin, s.issued_at, s.exp,
                    m.login_id, m.email, m.zid_pubkey, m.passkey_cred_id, m.passkey_pubkey, m.passkey_rp_id, m.passkey_sign_count
             FROM sessions s JOIN mailboxes m ON m.email_hash = s.email_hash
             WHERE s.session_id = ?1 AND s.revoked_at IS NULL AND s.exp > ?2",
            params![session_id, now],
            |r| {
                Ok(ActiveSession {
                    id: r.get(0)?,
                    email_hash: r.get(1)?,
                    origin: r.get(2)?,
                    issued_at: r.get(3)?,
                    exp: r.get(4)?,
                    mailbox: Mailbox {
                        email_hash: r.get(1)?,
                        login_id: r.get(5)?,
                        email: r.get(6)?,
                        zid_pubkey: r.get(7)?,
                        passkey: {
                            let cred: Option<String> = r.get(8)?;
                            cred.map(|cred_id| BoundPasskey {
                                cred_id,
                                public_key: r.get(9).unwrap_or_default(),
                                rp_id: r.get(10).unwrap_or_default(),
                                sign_count: r.get::<_, i64>(11).unwrap_or(0) as u32,
                            })
                        },
                    },
                })
            },
        )
        .optional()
        .ok()
        .flatten()
    }

    pub fn revoke_session(&self, session_id: &str, now: i64) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "UPDATE sessions SET revoked_at = ?1 WHERE session_id = ?2 AND revoked_at IS NULL",
            params![now, session_id],
        );
    }
}

pub enum VerifyOutcome {
    Unknown,
    Expired,
    BadCode { burned: bool, attempts: i64 },
    Ok(Challenge),
}

fn map_challenge(r: &rusqlite::Row<'_>) -> rusqlite::Result<Challenge> {
    Ok(Challenge {
        key: r.get(0)?,
        email_hash: r.get(1)?,
        origin: r.get(2)?,
        nonce: r.get(3)?,
        ts: r.get(4)?,
        issued_at: r.get(5)?,
        exp: r.get(6)?,
        attempts: r.get(7)?,
        secret_hash: r.get(8)?,
    })
}

fn map_mailbox(r: &rusqlite::Row<'_>) -> rusqlite::Result<Mailbox> {
    let cred: Option<String> = r.get(4)?;
    Ok(Mailbox {
        email_hash: r.get(0)?,
        login_id: r.get(1)?,
        email: r.get(2)?,
        zid_pubkey: r.get(3)?,
        passkey: cred.map(|cred_id| BoundPasskey {
            cred_id,
            public_key: r.get(5).unwrap_or_default(),
            rp_id: r.get(6).unwrap_or_default(),
            sign_count: r.get::<_, i64>(7).unwrap_or(0) as u32,
        }),
    })
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

// silence unused import if any
#[allow(dead_code)]
fn _val(_: &Value) {}
