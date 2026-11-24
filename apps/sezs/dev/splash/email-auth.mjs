/**
 * Self-hosted email sign-in runtime (docs/specs/EMAIL-AUTH-GAP.md).
 *
 * All auth state lives on our own SQLite WAL store (hashed OTPs, attempt
 * counters, single-use challenges, mailboxes/bindings, rate limits, session
 * revocations). No Durable Objects, no third-party custody of codes or keys.
 *
 * Scalability & DDoS layers:
 *   1. Single nginx (nginx/sezs-email-auth.inc): limit_req/limit_conn + body/time caps.
 *   2. Cheap early rejection before DB or mail: method/route, Origin allowlist,
 *      x-sezs-csrf, syntax checks, bounded in-process token buckets, and optional/
 *      adaptive stateless HMAC-signed PoW (428 pow_required).
 *   3. SQLite WAL store as authoritative cross-worker truth (atomic BEGIN IMMEDIATE).
 *   4. Stateless HMAC-SHA256 signed session tokens (`v1.<payload>.<sig>`) verified
 *      before checking SQLite for revocation or bound ZID/passkey state.
 *
 * Never logs raw OTPs, full addresses, session tokens, or env secrets.
 */
import { createHash, createPublicKey, randomBytes, randomInt, timingSafeEqual, verify as cryptoVerify } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519'

import { makeSqliteEmailStore } from './email-store.mjs'
import { issuePowChallenge, resolveSessionSecret, signSessionToken, verifyPowSolution, verifySessionToken } from './email-token.mjs'
import { resolveEmailFrom } from './email-sink.mjs'

const DEFAULT_ORIGINS = ['http://127.0.0.1:3051', 'http://localhost:3051']
const OTP_TTL_MS = 10 * 60 * 1000
const BIND_TTL_MS = 2 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const WINDOW_MS = 15 * 60 * 1000
const RESEND_COOLDOWN_MS = 30 * 1000
const MAX_CODE_ATTEMPTS = 5
const MAX_FAST_BUCKETS = 10_000
const MAX_USED_POW = 10_000

const sha256 = (data) => createHash('sha256').update(data).digest()
const sha256Hex = (data) => sha256(data).toString('hex')
const newId = (prefix, bytes = 8) => prefix + randomBytes(bytes).toString('hex')

export const parseAllowedOrigins = (raw) => {
  if (raw instanceof Set) return raw
  if (Array.isArray(raw)) return new Set(raw.map((s) => String(s).trim()).filter(Boolean))
  const list = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return new Set(list.length ? list : DEFAULT_ORIGINS)
}

/** Trim + lowercase, then the same shape the front end checks. Null when malformed. */
export const normalizeEmail = (raw) => {
  const email = String(raw || '').trim().toLowerCase()
  if (!email || email.length > 254) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  if (email.split('@')[0].length > 64) return null
  return email
}

/** Domain-separated mailbox hash. Safe for storage keys and log lines. */
export const emailHashOf = (email) => sha256Hex(`sezs-email-v1\n${email}`)

export const emailLoginMessage = ({ origin, email, nonce, ts }) =>
  [
    'SEZS-LOGIN-EMAIL-V1',
    `origin: ${origin}`,
    'audience: sezs',
    `email: ${email}`,
    `nonce: ${nonce}`,
    `ts: ${ts}`,
  ].join('\n')

export const emailBindMessage = ({ origin, nonce, ts }) =>
  [
    'SEZS-EMAIL-BIND-V1',
    `origin: ${origin}`,
    'audience: sezs',
    `nonce: ${nonce}`,
    `ts: ${ts}`,
  ].join('\n')

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const fromB64url = (s) => {
  const str = String(s || '')
  if (!str || !/^[A-Za-z0-9_-]+$/.test(str)) return null
  return Buffer.from(str, 'base64url')
}

const hexToBytes = (hex) => {
  const h = String(hex || '').replace(/^0x/, '')
  if (!h || h.length % 2) return null
  try {
    return Uint8Array.from(Buffer.from(h, 'hex'))
  } catch {
    return null
  }
}

const verifyZid = (publicKeyHex, message, signatureHex) => {
  const pub = hexToBytes(publicKeyHex)
  const sig = hexToBytes(signatureHex)
  if (!pub || pub.length !== 32 || !sig || sig.length !== 64) return false
  try {
    return ed25519.verify(sig, Buffer.from(message, 'utf8'), pub)
  } catch {
    return false
  }
}

const P256_SPKI_PREFIX = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex')

export const verifyPasskeyAssertion = ({ origin, challengeB64, publicKey, assertion, prevSignCount = 0 }) => {
  try {
    const host = new URL(origin).hostname
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return { ok: false, error: 'passkey_needs_localhost' }
    const rpId = host

    const pub = fromB64url(publicKey)
    if (!pub || pub.length !== 65 || pub[0] !== 0x04) return { ok: false, error: 'proof_required' }
    const clientBytes = fromB64url(assertion?.clientDataJSON)
    const authData = fromB64url(assertion?.authenticatorData)
    const sig = fromB64url(assertion?.signature)
    if (!clientBytes || clientBytes.length > 4096 || !authData || authData.length < 37 || authData.length > 4096 || !sig || sig.length > 256) {
      return { ok: false, error: 'proof_required' }
    }

    let client
    try {
      client = JSON.parse(clientBytes.toString('utf8'))
    } catch {
      return { ok: false, error: 'bad_signature' }
    }
    if (client?.type !== 'webauthn.get') return { ok: false, error: 'bad_signature' }
    if (client?.origin !== origin) return { ok: false, error: 'passkey_origin' }
    if (client?.challenge !== challengeB64) return { ok: false, error: 'passkey_challenge' }
    if (client?.crossOrigin === true) return { ok: false, error: 'passkey_origin' }

    if (!authData.subarray(0, 32).equals(sha256(rpId))) return { ok: false, error: 'passkey_rp_id' }
    const flags = authData[32]
    if (!(flags & 0x01)) return { ok: false, error: 'passkey_flags' }
    if (!(flags & 0x04)) return { ok: false, error: 'passkey_flags' }
    if (flags & 0x40) return { ok: false, error: 'bad_signature' }

    const signCount = authData.readUInt32BE(33)
    if (prevSignCount > 0 && signCount > 0 && signCount <= prevSignCount) return { ok: false, error: 'passkey_counter' }

    const key = createPublicKey({ key: Buffer.concat([P256_SPKI_PREFIX, pub]), format: 'der', type: 'spki' })
    const signed = Buffer.concat([authData, sha256(clientBytes)])
    if (!cryptoVerify('sha256', signed, key, sig)) return { ok: false, error: 'bad_signature' }
    return { ok: true, signCount }
  } catch {
    return { ok: false, error: 'bad_signature' }
  }
}

const publicBound = (mailbox) => {
  const out = {}
  if (mailbox?.bound?.zid) out.zidPubkey = mailbox.bound.zid.pubkey
  if (mailbox?.bound?.passkey) out.passkeyCredId = mailbox.bound.passkey.credId
  return out
}

export const emailMeBody = (record) => ({
  ok: true,
  role: record.role,
  login_id: record.address,
  kind: record.kind,
  source: record.source,
  live: record.live,
  bound: record.bound,
})

export const makeEmailAuth = ({
  allowedOrigins = DEFAULT_ORIGINS,
  sendEmail,
  emailFrom = resolveEmailFrom(),
  store,
  dbPath = ':memory:',
  stateDir,
  sessionSecret,
  cookieName = 'sezs_splash',
  now = Date.now,
  otpTtlMs = OTP_TTL_MS,
  bindTtlMs = BIND_TTL_MS,
  sessionTtlMs = SESSION_TTL_MS,
  windowMs = WINDOW_MS,
  requestLimit = 3,
  verifyLimit = 5,
  ipRequestLimit = 30,
  ipVerifyLimit = 60,
  bindLimit = 5,
  resendCooldownMs = RESEND_COOLDOWN_MS,
  maxCodeAttempts = MAX_CODE_ATTEMPTS,
  powBits = 0,
  adaptivePowThreshold = 0,
  trustProxy = false,
  onEvent,
} = {}) => {
  if (typeof sendEmail !== 'function') throw new Error('email auth needs a sendEmail sink')

  const origins = parseAllowedOrigins(allowedOrigins)
  const ownStore = !store
  const db = store || makeSqliteEmailStore({ dbPath })
  const secretBytes = resolveSessionSecret({ secret: sessionSecret, stateDir })
  const fastBuckets = new Map() // key → [ts…] (bounded LRU-ish flood shield before SQLite)
  const usedPowSalts = new Map() // salt → exp

  const emit = (e) => {
    try {
      onEvent?.(e)
    } catch {
      /* broken log sink must not break sign-in */
    }
  }

  const pruneFast = () => {
    const t = now()
    for (const [k, v] of fastBuckets) {
      const kept = v.filter((ts) => t - ts < windowMs)
      if (kept.length) fastBuckets.set(k, kept)
      else fastBuckets.delete(k)
    }
    for (const [salt, exp] of usedPowSalts) {
      if (exp <= t) usedPowSalts.delete(salt)
    }
    db.prune(t)
  }

  /** Fast O(1)-ish in-process bucket check before touching SQLite. */
  const fastPeekCount = (key) => {
    const t = now()
    const arr = (fastBuckets.get(key) || []).filter((ts) => t - ts < windowMs)
    return arr.length
  }

  const fastHit = (key, limit) => {
    const t = now()
    let arr = (fastBuckets.get(key) || []).filter((ts) => t - ts < windowMs)
    if (arr.length >= limit) {
      fastBuckets.set(key, arr)
      return false
    }
    if (!fastBuckets.has(key) && fastBuckets.size >= MAX_FAST_BUCKETS) {
      const oldestKey = fastBuckets.keys().next().value
      fastBuckets.delete(oldestKey)
    }
    arr.push(t)
    fastBuckets.set(key, arr)
    return true
  }

  /** Dual-layer rate limit: cheap in-process shield + SQLite WAL source of truth. */
  const hit = (key, limit) => {
    if (!fastHit(key, limit)) return false
    return db.hitRateLimit(key, limit, windowMs, now())
  }

  const originOf = (req) => {
    const origin = String(req?.headers?.origin || '')
    return origins.has(origin) ? origin : null
  }
  const csrfOk = (req) => Boolean(String(req?.headers?.['x-sezs-csrf'] || '').trim())
  const ipOf = (req) => {
    if (trustProxy) {
      const fwd = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
      if (fwd) return fwd
      const real = String(req?.headers?.['x-real-ip'] || '').trim()
      if (real) return real
    }
    return String(req?.socket?.remoteAddress || 'local')
  }
  const cookieOf = (req) => {
    const m = new RegExp(`(?:^|;\\s*)${cookieName}=([A-Za-z0-9._-]{1,640})`).exec(String(req?.headers?.cookie || ''))
    return m ? m[1] : null
  }
  const cookieAttrs = (origin) =>
    `Path=/; HttpOnly; SameSite=Strict${String(origin || '').startsWith('https://') ? '; Secure' : ''}`
  const cookieHeader = (token, origin) => `${cookieName}=${token}; ${cookieAttrs(origin)}`
  const clearCookieHeader = (origin) => `${cookieName}=; Max-Age=0; ${cookieAttrs(origin)}`

  /** Stateless cryptographic check first, then SQLite revocation/binding lookup. */
  const sessionOf = (req) => {
    const token = cookieOf(req)
    if (!token) return null
    const claims = verifySessionToken(token, secretBytes, { now: now() })
    if (!claims) return null
    return db.getActiveSession(claims.sid, now())
  }

  const recordOf = (token) => {
    if (!token) return null
    const claims = verifySessionToken(token, secretBytes, { now: now() })
    if (!claims) return null
    const active = db.getActiveSession(claims.sid, now())
    if (!active) return null
    return {
      address: active.mailbox.loginId,
      kind: 'email',
      role: 'guest',
      source: 'session',
      live: false,
      exp: active.exp,
      bound: publicBound(active.mailbox),
    }
  }

  const revokeFromRequest = (req) => {
    const token = cookieOf(req)
    if (!token) return false
    const claims = verifySessionToken(token, secretBytes, { now: now() })
    if (!claims) return false
    db.revokeSession(claims.sid, now())
    return true
  }

  // ── issuance ──────────────────────────────────────────────────
  const request = async (req, b) => {
    pruneFast()
    // Cheap early rejections before any DB or mail work:
    const origin = originOf(req)
    if (!origin) return [403, { ok: false, error: 'origin_refused' }]
    if (!csrfOk(req)) return [403, { ok: false, error: 'csrf_required' }]
    const email = normalizeEmail(b?.email)
    if (!email) return [400, { ok: false, error: 'bad_email' }]

    const hash = emailHashOf(email)
    const ip = ipOf(req)
    const ipHash = sha256Hex(`ip:${ip}`).slice(0, 24)

    if (!hit(`ipreq:${ip}`, ipRequestLimit)) return [429, { ok: false, error: 'rate_limited' }]
    if (!hit(`req:${hash}:${origin}`, requestLimit)) return [429, { ok: false, error: 'rate_limited' }]

    // Optional or adaptive stateless PoW before DB challenge write or mail send.
    const needBits = powBits > 0
      ? powBits
      : adaptivePowThreshold > 0 && fastPeekCount(`ipreq:${ip}`) > adaptivePowThreshold
        ? 12
        : 0
    if (needBits > 0) {
      const pow = b?.pow
      if (!pow) {
        return [
          428,
          {
            ok: false,
            error: 'pow_required',
            pow: issuePowChallenge({ origin, ipHash, bits: needBits, now: now(), secretBytes }),
          },
        ]
      }
      const salt = String(pow.salt || '')
      if (usedPowSalts.has(salt) || !verifyPowSolution(pow, { origin, ipHash, minBits: needBits, now: now(), secretBytes })) {
        return [
          428,
          {
            ok: false,
            error: 'pow_required',
            pow: issuePowChallenge({ origin, ipHash, bits: needBits, now: now(), secretBytes }),
          },
        ]
      }
      if (usedPowSalts.size >= MAX_USED_POW) {
        const first = usedPowSalts.keys().next().value
        usedPowSalts.delete(first)
      }
      usedPowSalts.set(salt, Number(pow.exp))
    }

    const key = `${hash}:${origin}`
    const t = now()
    const prior = db.getChallenge(key)
    if (prior && t - prior.issuedAt < resendCooldownMs) {
      // Idempotent inside cooldown: identical response, no second message, no enumeration leak.
      return [200, { ok: true, status: 'awaiting' }]
    }

    const nonce = randomBytes(16).toString('hex')
    const ts = t
    const message = emailLoginMessage({ origin, email, nonce, ts })
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const secretHash = sha256Hex(`${message}\ncode: ${code}`)
    const minutes = Math.round(otpTtlMs / 60_000)
    const text =
      `Your SEZS sign-in code is ${code}. It expires in ${minutes} minutes and works once.\n\n` +
      `Or open this link on the same device: ${origin}/?email_code=${code}&email=${encodeURIComponent(email)}\n\n` +
      'If you did not request this, ignore this message.'
    try {
      await sendEmail({ to: email, from: emailFrom, subject: 'Your SEZS sign-in code', text, tokenRef: nonce })
    } catch {
      emit({ kind: 'request', emailHash: hash, origin, ok: false })
      return [503, { ok: false, error: 'delivery_unavailable' }]
    }
    db.putChallenge({
      key,
      emailHash: hash,
      origin,
      nonce,
      ts,
      issuedAt: t,
      exp: t + otpTtlMs,
      secretHash,
    })
    emit({ kind: 'request', emailHash: hash, origin, ok: true })
    return [200, { ok: true, status: 'awaiting' }]
  }

  // ── verification ──────────────────────────────────────────────
  const verify = async (req, b) => {
    const origin = originOf(req)
    if (!origin) return [403, { ok: false, error: 'origin_refused' }]
    if (!csrfOk(req)) return [403, { ok: false, error: 'csrf_required' }]
    const email = normalizeEmail(b?.email)
    if (!email) return [400, { ok: false, error: 'bad_email' }]
    const code = String(b?.code || '').trim()
    if (!/^\d{6}$/.test(code)) return [400, { ok: false, error: 'bad_code' }]

    const hash = emailHashOf(email)
    const ip = ipOf(req)
    if (!hit(`ipver:${ip}`, ipVerifyLimit)) return [429, { ok: false, error: 'rate_limited' }]
    if (!hit(`ver:${hash}:${origin}`, verifyLimit)) return [429, { ok: false, error: 'rate_limited' }]

    const t = now()
    const key = `${hash}:${origin}`
    const outcome = db.verifyAndConsumeChallenge(key, t, maxCodeAttempts, (ch) => {
      const message = emailLoginMessage({ origin: ch.origin, email, nonce: ch.nonce, ts: ch.ts })
      const candidate = sha256(`${message}\ncode: ${code}`)
      const expected = Buffer.from(ch.secretHash, 'hex')
      return candidate.length === expected.length && timingSafeEqual(candidate, expected)
    })
    db.prune(t)

    if (outcome.status === 'unknown') return [400, { ok: false, error: 'unknown_challenge' }]
    if (outcome.status === 'expired') return [400, { ok: false, error: 'expired' }]
    if (outcome.status === 'bad_code') {
      emit({ kind: 'verify', emailHash: hash, origin, ok: false })
      return [400, { ok: false, error: 'bad_code' }]
    }

    const mailbox = db.getOrCreateMailbox({
      emailHash: hash,
      email,
      loginIdFactory: () => newId('mail-'),
      now: t,
    })
    const priorToken = cookieOf(req)
    const priorClaims = priorToken ? verifySessionToken(priorToken, secretBytes, { now: t }) : null
    const sid = newId('sess-', 16)
    const exp = t + sessionTtlMs
    db.createSession({
      sessionId: sid,
      emailHash: mailbox.emailHash,
      origin,
      issuedAt: t,
      exp,
      revokeSessionId: priorClaims?.sid || null,
    })
    const token = signSessionToken({ sid, lid: mailbox.loginId, sub: mailbox.emailHash, origin, iat: t, exp }, secretBytes)
    emit({ kind: 'verify', emailHash: hash, origin, ok: true })
    return [
      200,
      { ok: true, email, login_id: mailbox.loginId, kind: 'email', bound: publicBound(mailbox) },
      { 'set-cookie': cookieHeader(token, origin) },
    ]
  }

  const session = (req) => {
    db.prune(now())
    const active = sessionOf(req)
    if (!active) return [401, { ok: false, error: 'no_session' }]
    return [
      200,
      {
        ok: true,
        email: active.mailbox.email,
        login_id: active.mailbox.loginId,
        kind: 'email',
        bound: publicBound(active.mailbox),
      },
    ]
  }

  const logout = (req) => {
    db.prune(now())
    const origin = originOf(req)
    if (!origin) return [403, { ok: false, error: 'origin_refused' }]
    if (!csrfOk(req)) return [403, { ok: false, error: 'csrf_required' }]
    revokeFromRequest(req)
    return [200, { ok: true }, { 'set-cookie': clearCookieHeader(origin) }]
  }

  // ── binding to a passkey / ZID ────────────────────────────────
  const bindChallenge = (req) => {
    db.prune(now())
    const origin = originOf(req)
    if (!origin) return [403, { ok: false, error: 'origin_refused' }]
    if (!csrfOk(req)) return [403, { ok: false, error: 'csrf_required' }]
    const active = sessionOf(req)
    if (!active) return [401, { ok: false, error: 'no_session' }]
    if (!hit(`bind:${active.id}`, bindLimit)) return [429, { ok: false, error: 'rate_limited' }]
    const nonce = randomBytes(16).toString('hex')
    const ts = now()
    const message = emailBindMessage({ origin, nonce, ts })
    const challengeHex = Buffer.from(message, 'utf8').toString('hex')
    const challengeB64 = b64url(Buffer.from(message, 'utf8'))
    db.putBindChallenge({ nonce, sessionId: active.id, origin, ts, exp: ts + bindTtlMs, message })
    return [200, { ok: true, nonce, ts, message, challengeHex, challengeB64 }]
  }

  const bind = async (req, b) => {
    db.prune(now())
    const origin = originOf(req)
    if (!origin) return [403, { ok: false, error: 'origin_refused' }]
    if (!csrfOk(req)) return [403, { ok: false, error: 'csrf_required' }]
    const active = sessionOf(req)
    if (!active) return [401, { ok: false, error: 'no_session' }]
    const kind = String(b?.kind || '')
    if (kind !== 'ed25519/zid' && kind !== 'p256/passkey') return [400, { ok: false, error: 'bad_kind' }]

    const nonce = String(b?.nonce || '')
    if (!nonce) return [400, { ok: false, error: 'proof_required' }]
    const ch = db.takeBindChallenge(nonce)
    if (!ch) return [400, { ok: false, error: 'unknown_challenge' }]
    if (ch.exp <= now()) return [400, { ok: false, error: 'expired' }]
    if (ch.sessionId !== active.id || ch.origin !== origin) return [403, { ok: false, error: 'challenge_mismatch' }]

    const mailbox = active.mailbox
    let updated = mailbox
    if (kind === 'ed25519/zid') {
      const zidPubkey = String(b?.zidPubkey || '').trim()
      const signature = String(b?.signature || '').trim()
      if (!zidPubkey || !signature) return [400, { ok: false, error: 'proof_required' }]
      if (!verifyZid(zidPubkey, ch.message, signature)) return [403, { ok: false, error: 'bad_signature' }]
      updated = db.bindZid({ emailHash: mailbox.emailHash, zidPubkey, now: now() })
    } else {
      const credId = String(b?.credId || '').trim()
      const publicKey = String(b?.publicKey || '').trim()
      const assertion = b?.assertion
      if (!credId || !publicKey || !assertion) return [400, { ok: false, error: 'proof_required' }]
      const credBytes = fromB64url(credId)
      if (!credBytes || credBytes.length > 1024) return [400, { ok: false, error: 'proof_required' }]
      const prev = mailbox.bound.passkey
      const r = verifyPasskeyAssertion({
        origin,
        challengeB64: b64url(Buffer.from(ch.message, 'utf8')),
        publicKey,
        assertion,
        prevSignCount: prev && prev.credId === credId ? prev.signCount : 0,
      })
      if (!r.ok) return [403, { ok: false, error: r.error }]
      updated = db.bindPasskey({
        emailHash: mailbox.emailHash,
        credId,
        publicKey,
        rpId: new URL(origin).hostname,
        signCount: r.signCount,
        now: now(),
      })
    }
    emit({ kind: 'bind', emailHash: mailbox.emailHash, origin, ok: true })
    return [200, { ok: true, kind, bound: publicBound(updated) }]
  }

  const health = () => [200, { ok: true, service: 'email-auth', store: 'sqlite', powBits }]

  return {
    recordOf,
    revokeFromRequest,
    roleOfSession: (token) => recordOf(token)?.role || null,
    addressOfSession: (token) => {
      const rec = recordOf(token)
      return rec?.bound?.zidPubkey || rec?.address || ''
    },
    close: () => {
      if (ownStore) db.close()
    },
    handlers: {
      'GET /sezs/auth/email/health': health,
      'POST /sezs/auth/email/request': request,
      'POST /sezs/auth/email/verify': verify,
      'GET /sezs/auth/email/session': session,
      'POST /sezs/auth/email/logout': logout,
      'POST /sezs/auth/email/bind-challenge': bindChallenge,
      'POST /sezs/auth/email/bind': bind,
    },
  }
}
