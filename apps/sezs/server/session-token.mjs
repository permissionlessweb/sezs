/**
 * HMAC-SHA256 signed session tokens for the production SEZS session service.
 *
 * Token format: `v1.<payload_b64url>.<sig_b64url>`
 * Cryptographic verification runs before consulting SQLite for revocation.
 * Production refuses to boot without SEZS_SESSION_SECRET or SEZS_SESSION_SECRET_FILE.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TOKEN_RE = /^v1\.([A-Za-z0-9_-]{1,512})\.([A-Za-z0-9_-]{43})$/
const HEX_KEY_RE = /^[0-9a-f]{64,}$/i
const ALLOWED_KINDS = new Set(['ed25519/zid', 'p256/passkey', 'terp-bech32'])

const deriveSecretBytes = (raw) => {
  const s = String(raw || '').trim()
  if (!s) return null
  if (HEX_KEY_RE.test(s)) return Buffer.from(s, 'hex').subarray(0, 32)
  if (s.length < 16) return null
  return createHash('sha256').update(s, 'utf8').digest()
}

export const resolveSessionSecret = ({ secret, secretFile, stateDir, env = process.env } = {}) => {
  if (secret) {
    if (Buffer.isBuffer(secret)) {
      if (secret.length < 32) throw new Error('session secret buffer must be at least 32 bytes')
      return secret
    }
    const derived = deriveSecretBytes(secret)
    if (!derived) throw new Error('session secret is too short')
    return derived
  }

  const fromEnv = String(env.SEZS_SESSION_SECRET || '').trim()
  if (fromEnv) {
    const derived = deriveSecretBytes(fromEnv)
    if (!derived) throw new Error('SEZS_SESSION_SECRET is too short')
    return derived
  }

  const filePath = String(secretFile || env.SEZS_SESSION_SECRET_FILE || '').trim()
  if (filePath) {
    if (!existsSync(filePath)) throw new Error('SEZS_SESSION_SECRET_FILE does not exist')
    const derived = deriveSecretBytes(readFileSync(filePath, 'utf8'))
    if (!derived) throw new Error('SEZS_SESSION_SECRET_FILE contents too short')
    return derived
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('SEZS_SESSION_SECRET or SEZS_SESSION_SECRET_FILE is required in production')
  }

  if (stateDir) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
    const p = join(stateDir, 'session.key')
    if (existsSync(p)) {
      const derived = deriveSecretBytes(readFileSync(p, 'utf8'))
      if (derived) return derived
    }
    const fresh = randomBytes(32)
    writeFileSync(p, fresh.toString('hex') + '\n', { mode: 0o600 })
    try { chmodSync(p, 0o600) } catch {}
    return fresh
  }

  return randomBytes(32)
}

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const hmacB64 = (secretBytes, input) => b64url(createHmac('sha256', secretBytes).update(input).digest())

export const signSessionToken = ({ sid, lid, sub, kind, org, iat, exp }, secretBytes) => {
  if (!ALLOWED_KINDS.has(kind)) throw new Error(`unsupported session kind: ${kind}`)
  const payload = b64url(JSON.stringify({ v: 1, sid, lid, sub, kind, org, iat, exp }))
  const body = `v1.${payload}`
  const sig = hmacB64(secretBytes, body)
  return `${body}.${sig}`
}

export const verifySessionToken = (token, secretBytes, { now = Date.now(), expectedOrigin } = {}) => {
  if (typeof token !== 'string' || token.length > 640) return null
  const m = TOKEN_RE.exec(token)
  if (!m) return null
  const [, payloadB64, sigB64] = m
  const expectedSig = createHmac('sha256', secretBytes).update(`v1.${payloadB64}`).digest()
  let gotSig
  try {
    gotSig = Buffer.from(sigB64, 'base64url')
  } catch {
    return null
  }
  if (gotSig.length !== expectedSig.length || !timingSafeEqual(gotSig, expectedSig)) return null
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!parsed || parsed.v !== 1 || !ALLOWED_KINDS.has(parsed.kind)) return null
  if (typeof parsed.sid !== 'string' || !parsed.sid || typeof parsed.sub !== 'string' || !parsed.sub) return null
  if (typeof parsed.exp !== 'number' || parsed.exp <= now) return null
  if (expectedOrigin && parsed.org !== expectedOrigin) return null
  return parsed
}
