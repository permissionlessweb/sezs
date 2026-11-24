/**
 * HMAC-SHA256 signed session tokens and stateless Proof-of-Work challenges.
 *
 * Signed cookie tokens (`v1.<payload_b64url>.<sig_b64url>`) allow stateless
 * cryptographic verification (format + signature + expiry) before consulting
 * the SQLite session table for revocation or linked passkey/ZID bindings.
 *
 * Secret sourcing: SEZS_EMAIL_SESSION_SECRET from process env (never hardcoded,
 * never logged). Production refuses to boot without it; dev falls back to a
 * 0600 key file under the local state dir (or an ephemeral CSPRNG key).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TOKEN_RE = /^v1\.([A-Za-z0-9_-]{1,512})\.([A-Za-z0-9_-]{43})$/
const HEX_KEY_RE = /^[0-9a-f]{64,}$/i

export const resolveSessionSecret = ({ secret, stateDir, env = process.env } = {}) => {
  if (secret) {
    return Buffer.isBuffer(secret) ? secret : createHash('sha256').update(String(secret)).digest()
  }
  const fromEnv = String(env.SEZS_EMAIL_SESSION_SECRET || '').trim()
  if (fromEnv) {
    if (HEX_KEY_RE.test(fromEnv)) return Buffer.from(fromEnv, 'hex').subarray(0, 32)
    return createHash('sha256').update(fromEnv, 'utf8').digest()
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('SEZS_EMAIL_SESSION_SECRET is required in production')
  }
  if (stateDir) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
    const p = join(stateDir, 'email-session.key')
    if (existsSync(p)) {
      const hex = readFileSync(p, 'utf8').trim()
      if (HEX_KEY_RE.test(hex)) return Buffer.from(hex, 'hex').subarray(0, 32)
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

export const signSessionToken = ({ sid, lid, sub, origin, iat, exp }, secretBytes) => {
  const payload = b64url(JSON.stringify({ v: 1, sid, lid, sub, kind: 'email', org: origin, iat, exp }))
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
  if (!parsed || parsed.v !== 1 || parsed.kind !== 'email') return null
  if (typeof parsed.sid !== 'string' || !parsed.sid || typeof parsed.sub !== 'string' || !parsed.sub) return null
  if (typeof parsed.exp !== 'number' || parsed.exp <= now) return null
  if (expectedOrigin && parsed.org !== expectedOrigin) return null
  return parsed
}

// ── Stateless Hashcash-style Proof-of-Work ───────────────────────
const hasLeadingZeroBits = (buf, bits) => {
  const fullBytes = bits >> 3
  const remBits = bits & 7
  for (let i = 0; i < fullBytes; i++) {
    if (buf[i] !== 0) return false
  }
  if (remBits > 0) {
    const mask = 0xff << (8 - remBits)
    if ((buf[fullBytes] & mask) !== 0) return false
  }
  return true
}

export const issuePowChallenge = ({ origin, ipHash, bits, now, ttlMs = 120_000, secretBytes }) => {
  const salt = randomBytes(16).toString('hex')
  const exp = now + ttlMs
  const payload = `pow1|${origin}|${ipHash}|${bits}|${exp}|${salt}`
  const sig = hmacB64(secretBytes, payload)
  return { salt, bits, exp, sig }
}

export const verifyPowSolution = (pow, { origin, ipHash, minBits, now, secretBytes }) => {
  if (!pow || typeof pow !== 'object') return false
  const salt = String(pow.salt || '')
  const nonce = String(pow.nonce || '')
  const sig = String(pow.sig || '')
  const bits = Number(pow.bits)
  const exp = Number(pow.exp)
  if (!/^[0-9a-f]{32}$/.test(salt)) return false
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(nonce)) return false
  if (!Number.isInteger(bits) || bits < minBits || bits > 28) return false
  if (!Number.isFinite(exp) || exp <= now) return false
  const payload = `pow1|${origin}|${ipHash}|${bits}|${exp}|${salt}`
  const expectedSig = createHmac('sha256', secretBytes).update(payload).digest()
  let gotSig
  try {
    gotSig = Buffer.from(sig, 'base64url')
  } catch {
    return false
  }
  if (gotSig.length !== expectedSig.length || !timingSafeEqual(gotSig, expectedSig)) return false
  const digest = createHash('sha256').update(`${salt}:${nonce}`).digest()
  return hasLeadingZeroBits(digest, bits)
}
