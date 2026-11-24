/**
 * Self-hosted SQLite store for email sign-in state (node:sqlite, WAL mode).
 * Stores ONLY hashed OTP challenges, bind nonces, mailboxes/bindings,
 * rate-limit buckets, and revocable session records. No plaintext OTPs.
 *
 * All multi-step state transitions (rate-limit hit, atomic OTP verification /
 * attempt burn, one-time bind consume, session rotation) execute inside
 * BEGIN IMMEDIATE transactions so multiple worker processes sharing the WAL
 * (or a future Postgres adapter behind this same interface) stay consistent.
 */
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SCHEMA = `
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
`

const tightenMode = (dbPath) => {
  if (!dbPath || dbPath === ':memory:') return
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`
    if (existsSync(p)) {
      try { chmodSync(p, 0o600) } catch {}
    }
  }
}

export const makeSqliteEmailStore = ({ dbPath = ':memory:' } = {}) => {
  if (dbPath !== ':memory:') {
    const dir = dirname(dbPath)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    try { chmodSync(dir, 0o700) } catch {}
  }

  const db = new DatabaseSync(dbPath)
  db.exec(SCHEMA)
  tightenMode(dbPath)

  const inTx = (fn) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      db.exec('COMMIT')
      return out
    } catch (e) {
      try { db.exec('ROLLBACK') } catch {}
      throw e
    }
  }

  const stmtPruneChallenges = db.prepare('DELETE FROM email_challenges WHERE exp <= ?')
  const stmtPruneBinds = db.prepare('DELETE FROM bind_challenges WHERE exp <= ?')
  const stmtPruneSessions = db.prepare('DELETE FROM sessions WHERE exp <= ?')
  const stmtPruneRates = db.prepare('DELETE FROM rate_limits WHERE window_end <= ?')

  const stmtGetRate = db.prepare('SELECT timestamps_json FROM rate_limits WHERE bucket_key = ?')
  const stmtPutRate = db.prepare(
    'INSERT INTO rate_limits (bucket_key, timestamps_json, window_end) VALUES (?, ?, ?) ON CONFLICT(bucket_key) DO UPDATE SET timestamps_json = excluded.timestamps_json, window_end = excluded.window_end'
  )

  const stmtGetChallenge = db.prepare('SELECT * FROM email_challenges WHERE key = ?')
  const stmtPutChallenge = db.prepare(`
    INSERT INTO email_challenges (key, email_hash, origin, nonce, ts, issued_at, exp, attempts, secret_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(key) DO UPDATE SET
      email_hash = excluded.email_hash,
      origin = excluded.origin,
      nonce = excluded.nonce,
      ts = excluded.ts,
      issued_at = excluded.issued_at,
      exp = excluded.exp,
      attempts = 0,
      secret_hash = excluded.secret_hash
  `)
  const stmtBumpChallenge = db.prepare('UPDATE email_challenges SET attempts = ? WHERE key = ?')
  const stmtDelChallenge = db.prepare('DELETE FROM email_challenges WHERE key = ?')

  const stmtPutBind = db.prepare(`
    INSERT INTO bind_challenges (nonce, session_id, origin, ts, exp, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const stmtGetBind = db.prepare('SELECT * FROM bind_challenges WHERE nonce = ?')
  const stmtDelBind = db.prepare('DELETE FROM bind_challenges WHERE nonce = ?')

  const stmtGetMailbox = db.prepare('SELECT * FROM mailboxes WHERE email_hash = ?')
  const stmtInsertMailbox = db.prepare(`
    INSERT INTO mailboxes (email_hash, login_id, email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const stmtBindZid = db.prepare('UPDATE mailboxes SET zid_pubkey = ?, updated_at = ? WHERE email_hash = ?')
  const stmtBindPasskey = db.prepare(`
    UPDATE mailboxes
    SET passkey_cred_id = ?, passkey_pubkey = ?, passkey_rp_id = ?, passkey_sign_count = ?, updated_at = ?
    WHERE email_hash = ?
  `)

  const stmtInsertSession = db.prepare(`
    INSERT INTO sessions (session_id, email_hash, origin, issued_at, exp, revoked_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `)
  const stmtRevokeSession = db.prepare('UPDATE sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL')
  const stmtGetActiveSession = db.prepare(`
    SELECT s.session_id, s.email_hash, s.origin, s.issued_at, s.exp,
           m.login_id, m.email, m.zid_pubkey, m.passkey_cred_id, m.passkey_pubkey, m.passkey_rp_id, m.passkey_sign_count
    FROM sessions s
    JOIN mailboxes m ON m.email_hash = s.email_hash
    WHERE s.session_id = ? AND s.revoked_at IS NULL AND s.exp > ?
  `)

  const mapMailbox = (row) => {
    if (!row) return null
    const bound = {}
    if (row.zid_pubkey) bound.zid = { pubkey: row.zid_pubkey }
    if (row.passkey_cred_id) {
      bound.passkey = {
        credId: row.passkey_cred_id,
        publicKey: row.passkey_pubkey,
        rpId: row.passkey_rp_id,
        signCount: Number(row.passkey_sign_count || 0),
      }
    }
    return {
      emailHash: row.email_hash,
      loginId: row.login_id,
      email: row.email,
      bound,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  return {
    dbPath,
    prune: (now) => {
      stmtPruneChallenges.run(now)
      stmtPruneBinds.run(now)
      stmtPruneSessions.run(now)
      stmtPruneRates.run(now)
    },
    hitRateLimit: (key, limit, windowMs, now) =>
      inTx(() => {
        const row = stmtGetRate.get(key)
        let arr = []
        if (row) {
          try {
            arr = JSON.parse(row.timestamps_json).filter((ts) => now - ts < windowMs)
          } catch {
            arr = []
          }
        }
        if (arr.length >= limit) {
          stmtPutRate.run(key, JSON.stringify(arr), now + windowMs)
          return false
        }
        arr.push(now)
        stmtPutRate.run(key, JSON.stringify(arr), now + windowMs)
        return true
      }),
    getChallenge: (key) => {
      const r = stmtGetChallenge.get(key)
      if (!r) return null
      return {
        key: r.key,
        emailHash: r.email_hash,
        origin: r.origin,
        nonce: r.nonce,
        ts: Number(r.ts),
        issuedAt: Number(r.issued_at),
        exp: Number(r.exp),
        attempts: Number(r.attempts),
        secretHash: r.secret_hash,
      }
    },
    putChallenge: (ch) => {
      stmtPutChallenge.run(ch.key, ch.emailHash, ch.origin, ch.nonce, ch.ts, ch.issuedAt, ch.exp, ch.secretHash)
    },
    /**
     * Atomically look up, expire-check, verify via `checkFn(ch)`, bump/burn on
     * mismatch, or delete on single-use success. Eliminates OTP TOCTOU races.
     */
    verifyAndConsumeChallenge: (key, now, maxAttempts, checkFn) =>
      inTx(() => {
        const r = stmtGetChallenge.get(key)
        if (!r) return { status: 'unknown' }
        const ch = {
          key: r.key,
          emailHash: r.email_hash,
          origin: r.origin,
          nonce: r.nonce,
          ts: Number(r.ts),
          issuedAt: Number(r.issued_at),
          exp: Number(r.exp),
          attempts: Number(r.attempts),
          secretHash: r.secret_hash,
        }
        if (ch.exp <= now) {
          stmtDelChallenge.run(key)
          return { status: 'expired' }
        }
        if (!checkFn(ch)) {
          const nextAttempts = ch.attempts + 1
          if (nextAttempts >= maxAttempts) {
            stmtDelChallenge.run(key)
            return { status: 'bad_code', burned: true, attempts: nextAttempts }
          }
          stmtBumpChallenge.run(nextAttempts, key)
          return { status: 'bad_code', burned: false, attempts: nextAttempts }
        }
        stmtDelChallenge.run(key)
        return { status: 'ok', challenge: ch }
      }),
    putBindChallenge: (ch) => {
      stmtPutBind.run(ch.nonce, ch.sessionId, ch.origin, ch.ts, ch.exp, ch.message)
    },
    takeBindChallenge: (nonce) =>
      inTx(() => {
        const r = stmtGetBind.get(nonce)
        if (!r) return null
        stmtDelBind.run(nonce)
        return {
          nonce: r.nonce,
          sessionId: r.session_id,
          origin: r.origin,
          ts: Number(r.ts),
          exp: Number(r.exp),
          message: r.message,
        }
      }),
    getOrCreateMailbox: ({ emailHash, email, loginIdFactory, now }) =>
      inTx(() => {
        const existing = stmtGetMailbox.get(emailHash)
        if (existing) return mapMailbox(existing)
        const loginId = loginIdFactory()
        stmtInsertMailbox.run(emailHash, loginId, email, now, now)
        return mapMailbox(stmtGetMailbox.get(emailHash))
      }),
    getMailbox: (emailHash) => mapMailbox(stmtGetMailbox.get(emailHash)),
    bindZid: ({ emailHash, zidPubkey, now }) => {
      stmtBindZid.run(zidPubkey, now, emailHash)
      return mapMailbox(stmtGetMailbox.get(emailHash))
    },
    bindPasskey: ({ emailHash, credId, publicKey, rpId, signCount, now }) => {
      stmtBindPasskey.run(credId, publicKey, rpId, signCount, now, emailHash)
      return mapMailbox(stmtGetMailbox.get(emailHash))
    },
    createSession: ({ sessionId, emailHash, origin, issuedAt, exp, revokeSessionId }) =>
      inTx(() => {
        if (revokeSessionId) stmtRevokeSession.run(issuedAt, revokeSessionId)
        stmtInsertSession.run(sessionId, emailHash, origin, issuedAt, exp)
      }),
    getActiveSession: (sessionId, now) => {
      const r = stmtGetActiveSession.get(sessionId, now)
      if (!r) return null
      return {
        id: r.session_id,
        emailHash: r.email_hash,
        origin: r.origin,
        issuedAt: Number(r.issued_at),
        exp: Number(r.exp),
        mailbox: mapMailbox({
          email_hash: r.email_hash,
          login_id: r.login_id,
          email: r.email,
          zid_pubkey: r.zid_pubkey,
          passkey_cred_id: r.passkey_cred_id,
          passkey_pubkey: r.passkey_pubkey,
          passkey_rp_id: r.passkey_rp_id,
          passkey_sign_count: r.passkey_sign_count,
          created_at: r.issued_at,
          updated_at: r.issued_at,
        }),
      }
    },
    revokeSession: (sessionId, now) => {
      stmtRevokeSession.run(now, sessionId)
    },
    close: () => {
      try { db.close() } catch {}
    },
  }
}
