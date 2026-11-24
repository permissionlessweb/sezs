/**
 * Self-hosted SQLite WAL store for SEZS production sessions, single-use login
 * challenges, registered P-256 passkey public keys/signCounters, and rate limits.
 * No third-party custody.
 */
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SCHEMA = `
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

export const makeSqliteSessionStore = ({ dbPath = ':memory:' } = {}) => {
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

  const stmtPruneChallenges = db.prepare('DELETE FROM challenges WHERE exp <= ?')
  const stmtPruneSessions = db.prepare('DELETE FROM sessions WHERE exp <= ?')
  const stmtPruneRates = db.prepare('DELETE FROM rate_limits WHERE window_end <= ?')

  const stmtGetRate = db.prepare('SELECT timestamps_json FROM rate_limits WHERE bucket_key = ?')
  const stmtPutRate = db.prepare(
    'INSERT INTO rate_limits (bucket_key, timestamps_json, window_end) VALUES (?, ?, ?) ON CONFLICT(bucket_key) DO UPDATE SET timestamps_json = excluded.timestamps_json, window_end = excluded.window_end'
  )

  const stmtPutChallenge = db.prepare(`
    INSERT INTO challenges (nonce, kind, origin, address, challenge_b64, message, ts, exp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const stmtGetChallenge = db.prepare('SELECT * FROM challenges WHERE nonce = ?')
  const stmtDelChallenge = db.prepare('DELETE FROM challenges WHERE nonce = ?')

  const stmtGetPasskey = db.prepare('SELECT * FROM passkeys WHERE cred_id = ?')
  const stmtInsertPasskey = db.prepare(`
    INSERT INTO passkeys (cred_id, public_key, rp_id, sign_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const stmtUpdatePasskeyCount = db.prepare('UPDATE passkeys SET sign_count = ?, updated_at = ? WHERE cred_id = ?')

  const stmtInsertSession = db.prepare(`
    INSERT INTO sessions (session_id, kind, subject, origin, issued_at, exp, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `)
  const stmtRevokeSession = db.prepare('UPDATE sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL')
  const stmtGetActiveSession = db.prepare(`
    SELECT session_id, kind, subject, origin, issued_at, exp
    FROM sessions
    WHERE session_id = ? AND revoked_at IS NULL AND exp > ?
  `)

  return {
    dbPath,
    prune: (now) => {
      stmtPruneChallenges.run(now)
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
    putChallenge: (ch) => {
      stmtPutChallenge.run(
        ch.nonce,
        ch.kind,
        ch.origin,
        ch.address || null,
        ch.challengeB64 || null,
        ch.message || null,
        ch.ts,
        ch.exp,
      )
    },
    takeChallenge: (nonce, now) =>
      inTx(() => {
        const r = stmtGetChallenge.get(nonce)
        if (!r) return null
        stmtDelChallenge.run(nonce)
        if (Number(r.exp) <= now) return { expired: true }
        return {
          expired: false,
          nonce: r.nonce,
          kind: r.kind,
          origin: r.origin,
          address: r.address || '',
          challengeB64: r.challenge_b64 || '',
          message: r.message || '',
          ts: Number(r.ts),
          exp: Number(r.exp),
        }
      }),
    getPasskey: (credId) => {
      const r = stmtGetPasskey.get(credId)
      if (!r) return null
      return {
        credId: r.cred_id,
        publicKey: r.public_key,
        rpId: r.rp_id,
        signCount: Number(r.sign_count || 0),
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      }
    },
    recordPasskeyUse: ({ credId, publicKey, rpId, signCount, now }) =>
      inTx(() => {
        const existing = stmtGetPasskey.get(credId)
        if (!existing) {
          if (!publicKey) return { ok: false, error: 'unknown_passkey' }
          stmtInsertPasskey.run(credId, publicKey, rpId, signCount, now, now)
          return { ok: true, created: true, signCount }
        }
        if (existing.rp_id !== rpId) return { ok: false, error: 'passkey_rp_id' }
        if (publicKey && existing.public_key !== publicKey) return { ok: false, error: 'passkey_key_mismatch' }
        const prevCount = Number(existing.sign_count || 0)
        if (prevCount > 0 && signCount > 0 && signCount <= prevCount) {
          return { ok: false, error: 'passkey_counter' }
        }
        const nextCount = Math.max(prevCount, signCount)
        stmtUpdatePasskeyCount.run(nextCount, now, credId)
        return { ok: true, created: false, signCount: nextCount }
      }),
    createSession: ({ sessionId, kind, subject, origin, issuedAt, exp, revokeSessionId }) =>
      inTx(() => {
        if (revokeSessionId) stmtRevokeSession.run(issuedAt, revokeSessionId)
        stmtInsertSession.run(sessionId, kind, subject, origin, issuedAt, exp)
      }),
    getActiveSession: (sessionId, now) => {
      const r = stmtGetActiveSession.get(sessionId, now)
      if (!r) return null
      return {
        id: r.session_id,
        kind: r.kind,
        subject: r.subject,
        origin: r.origin,
        issuedAt: Number(r.issued_at),
        exp: Number(r.exp),
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
