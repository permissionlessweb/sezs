/**
 * Production SEZS session service handlers:
 *   - ZID (ed25519 over SEZS-LOGIN-ZID-V1)
 *   - Passkey (WebAuthn P-256 assertion with UV required + rpId/origin check)
 *   - ADR-036 (terp-bech32 with live mainnet event contract role check)
 *   - GET /sezs/session/me, POST /sezs/session/logout, GET /sezs/v2/event/roles
 *
 * All sessions are HMAC-SHA256 signed cookies backed by a local SQLite WAL
 * store for instant revocation and replay/rate-limit enforcement.
 */
import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519'

import { verifyAdr036 } from '../src/ticket/v2/adr036.mjs'
import { makeSqliteSessionStore } from './session-store.mjs'
import { resolveSessionSecret, signSessionToken, verifySessionToken } from './session-token.mjs'

const DEFAULT_ORIGINS = ['http://127.0.0.1:3051', 'http://localhost:3051']
const CHALLENGE_TTL_MS = 2 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const WINDOW_MS = 15 * 60 * 1000
const MAX_FAST_BUCKETS = 10_000
const PREFIX = 'terp'
const CRED_ID_RE = /^[A-Za-z0-9_-]{16,512}$/
const P256_SPKI_PREFIX = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex')

const sha256 = (data) => createHash('sha256').update(data).digest()
const newId = (prefix, bytes = 16) => prefix + randomBytes(bytes).toString('hex')

export const parseAllowedOrigins = (raw) => {
  if (raw instanceof Set) return raw
  if (Array.isArray(raw)) return new Set(raw.map((s) => String(s).trim()).filter(Boolean))
  const list = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return new Set(list.length ? list : DEFAULT_ORIGINS)
}

const fromB64Any = (s) => {
  const raw = String(s || '').trim()
  if (!raw || !/^[A-Za-z0-9+/_-]+=*$/.test(raw)) return null
  const std = raw.replace(/-/g, '+').replace(/_/g, '/')
  const pad = std.length % 4 ? std + '='.repeat(4 - (std.length % 4)) : std
  try {
    return Buffer.from(pad, 'base64')
  } catch {
    return null
  }
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

export const loginMessage = ({ origin, address, nonce, ts }) =>
  [
    'SEZS-LOGIN-V1',
    `origin: ${origin}`,
    `address: ${address}`,
    `nonce: ${nonce}`,
    `ts: ${ts}`,
  ].join('\n')

export const zidLoginMessage = ({ origin, nonce, ts }) =>
  [
    'SEZS-LOGIN-ZID-V1',
    `origin: ${origin}`,
    'audience: sezs',
    `nonce: ${nonce}`,
    `ts: ${ts}`,
  ].join('\n')

export const zidChallengeHex = (message) => Buffer.from(message, 'utf8').toString('hex')

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

export const resolveRpIdForOrigin = (origin, configuredRpId) => {
  try {
    const host = new URL(origin).hostname.toLowerCase()
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return null
    if (configuredRpId) {
      const rp = String(configuredRpId).trim().toLowerCase()
      if (!rp || /^(\d{1,3}\.){3}\d{1,3}$/.test(rp) || rp.includes(':')) return null
      if (host !== rp && !host.endsWith(`.${rp}`)) return null
      return rp
    }
    return host
  } catch {
    return null
  }
}

export const verifyPasskeyAssertion = ({
  origin,
  rpId,
  challengeB64,
  publicKey,
  assertion,
  prevSignCount = 0,
}) => {
  try {
    const expectedRpId = rpId || resolveRpIdForOrigin(origin)
    if (!expectedRpId) return { ok: false, error: 'passkey_invalid_rp_id' }

    const pub = fromB64Any(publicKey)
    if (!pub || pub.length !== 65 || pub[0] !== 0x04) return { ok: false, error: 'proof_required' }
    const clientBytes = fromB64Any(assertion?.clientDataJSON)
    const authData = fromB64Any(assertion?.authenticatorData)
    const sig = fromB64Any(assertion?.signature)
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

    if (!authData.subarray(0, 32).equals(sha256(expectedRpId))) return { ok: false, error: 'passkey_rp_id' }
    const flags = authData[32]
    if (!(flags & 0x01)) return { ok: false, error: 'passkey_flags' } // UP
    if (!(flags & 0x04)) return { ok: false, error: 'passkey_flags' } // UV
    if (flags & 0x40) return { ok: false, error: 'bad_signature' }    // AT must not be set on get()

    const signCount = authData.readUInt32BE(33)
    if (prevSignCount > 0 && signCount > 0 && signCount <= prevSignCount) return { ok: false, error: 'passkey_counter' }

    const key = createPublicKey({ key: Buffer.concat([P256_SPKI_PREFIX, pub]), format: 'der', type: 'spki' })
    const signed = Buffer.concat([authData, sha256(clientBytes)])
    if (!cryptoVerify('sha256', signed, key, sig)) return { ok: false, error: 'bad_signature' }
    return { ok: true, signCount, normalizedPublicKey: pub.toString('base64url'), rpId: expectedRpId }
  } catch {
    return { ok: false, error: 'bad_signature' }
  }
}

export const makeSessionService = ({
  allowedOrigins = DEFAULT_ORIGINS,
  rpId = '',
  roleReader = null,
  store,
  dbPath = ':memory:',
  stateDir,
  sessionSecret,
  sessionSecretFile,
  cookieName = 'sezs_session',
  cookiePath = '/',
  secureCookie,
  now = Date.now,
  challengeTtlMs = CHALLENGE_TTL_MS,
  sessionTtlMs = SESSION_TTL_MS,
  windowMs = WINDOW_MS,
  ipChallengeLimit = 30,
  ipVerifyLimit = 60,
  ipRolesLimit = 120,
  trustProxy = false,
} = {}) => {
  const origins = parseAllowedOrigins(allowedOrigins)
  const ownStore = !store
  const db = store || makeSqliteSessionStore({ dbPath })
  const secretBytes = resolveSessionSecret({ secret: sessionSecret, secretFile: sessionSecretFile, stateDir })
  const fastBuckets = new Map()
  const safeCookiePath = String(cookiePath || '/').startsWith('/') ? String(cookiePath || '/') : `/${cookiePath}`

  const pruneFast = () => {
    const t = now()
    for (const [k, v] of fastBuckets) {
      const kept = v.filter((ts) => t - ts < windowMs)
      if (kept.length) fastBuckets.set(k, kept)
      else fastBuckets.delete(k)
    }
    db.prune(t)
  }

  const fastHit = (key, limit) => {
    const t = now()
    const arr = (fastBuckets.get(key) || []).filter((ts) => t - ts < windowMs)
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

  const hit = (key, limit) => {
    if (!fastHit(key, limit)) return false
    return db.hitRateLimit(key, limit, windowMs, now())
  }

  const ipOf = (req) => {
    if (trustProxy) {
      const fwd = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
      if (fwd) return fwd
      const real = String(req?.headers?.['x-real-ip'] || '').trim()
      if (real) return real
    }
    return String(req?.socket?.remoteAddress || 'local')
  }

  const requestOriginOf = (req, bodyOrigin) => {
    const hdr = String(req?.headers?.origin || '').trim()
    const bodyOrg = String(bodyOrigin || '').trim()
    if (hdr && !origins.has(hdr)) return null
    if (bodyOrg && !origins.has(bodyOrg)) return null
    if (hdr && bodyOrg && hdr !== bodyOrg) return null
    const chosen = hdr || bodyOrg
    return chosen && origins.has(chosen) ? chosen : null
  }

  const csrfOk = (req) =>
    Boolean(String(req?.headers?.['x-sezs-frost'] || req?.headers?.['x-sezs-csrf'] || '').trim())

  const cookieOf = (req) => {
    const m = new RegExp(`(?:^|;\\s*)${cookieName}=([A-Za-z0-9._-]{1,640})`).exec(String(req?.headers?.cookie || ''))
    return m ? m[1] : null
  }

  const useSecure = (origin) =>
    typeof secureCookie === 'boolean' ? secureCookie : String(origin || '').startsWith('https://')

  const cookieAttrs = (origin) =>
    `Path=${safeCookiePath}; HttpOnly; SameSite=Strict${useSecure(origin) ? '; Secure' : ''}`

  const setCookieHeader = (token, origin) =>
    `${cookieName}=${token}; Max-Age=${Math.floor(sessionTtlMs / 1000)}; ${cookieAttrs(origin)}`

  const clearCookieHeader = (origin) =>
    `${cookieName}=; Max-Age=0; ${cookieAttrs(origin)}`

  const health = () => [200, { ok: true, service: 'sezs-session', live: true }]

  const challenge = (req, b) => {
    pruneFast()
    if (!csrfOk(req)) return [403, { ok: false, error: 'csrf_required' }]
    const origin = requestOriginOf(req, b?.origin)
    if (!origin) return [403, { ok: false, error: 'origin_refused' }]

    const ip = ipOf(req)
    if (!hit(`ch:ip:${ip}`, ipChallengeLimit)) {
      return [429, { ok: false, error: 'rate_limited' }, { 'retry-after': '60' }]
    }

    const kind = String(b?.kind || (b?.artist_id || b?.address ? 'adr036' : 'zid'))
    const nonce = randomBytes(16).toString('hex')
    const ts = now()
    const exp = ts + challengeTtlMs

    if (kind === 'zid') {
      const message = zidLoginMessage({ origin, nonce, ts })
      const challengeHex = zidChallengeHex(message)
      db.putChallenge({ nonce, kind: 'zid', origin, message, ts, exp })
      return [200, { ok: true, nonce, ts, message, challengeHex, statement: `Sign in to ${origin}` }]
    }

    if (kind === 'passkey') {
      const resolvedRpId = resolveRpIdForOrigin(origin, rpId)
      if (!resolvedRpId) return [400, { ok: false, error: 'passkey_invalid_rp_id' }]
      const challengeB64 = randomBytes(32).toString('base64url')
      db.putChallenge({ nonce, kind: 'passkey', origin, challengeB64, ts, exp })
      return [200, { ok: true, nonce, ts, challengeB64, rpId: resolvedRpId }]
    }

    if (kind === 'adr036') {
      const address = String(b?.artist_id || b?.address || '').trim()
      if (!/^terp1[a-z0-9]{20,}$/i.test(address)) return [400, { ok: false, error: 'bad_address' }]
      const message = loginMessage({ origin, address, nonce, ts })
      db.putChallenge({ nonce, kind: 'adr036', origin, address, message, ts, exp })
      return [200, { ok: true, nonce, ts, message }]
    }

    return [400, { ok: false, error: 'bad_kind' }]
  }

  const verify = async (req, b) => {
    pruneFast()
    if (!csrfOk(req)) return [403, { ok: false, error: 'csrf_required' }]
    const origin = requestOriginOf(req, b?.origin)
    if (!origin) return [403, { ok: false, error: 'origin_refused' }]

    const ip = ipOf(req)
    if (!hit(`vf:ip:${ip}`, ipVerifyLimit)) {
      return [429, { ok: false, error: 'rate_limited' }, { 'retry-after': '60' }]
    }

    const nonce = String(b?.nonce || '')
    if (!/^[0-9a-f]{32}$/.test(nonce)) return [400, { ok: false, error: 'unknown_challenge' }]

    const ch = db.takeChallenge(nonce, now())
    if (!ch) return [400, { ok: false, error: 'unknown_challenge' }]
    if (ch.expired) return [400, { ok: false, error: 'expired' }]
    if (ch.origin !== origin) return [403, { ok: false, error: 'challenge_mismatch' }]

    const method = String(b?.method || ch.kind)
    const prevToken = cookieOf(req)
    const prevClaims = prevToken ? verifySessionToken(prevToken, secretBytes, { now: now() }) : null
    const revokeSessionId = prevClaims?.sid || null

    if (method === 'zid' && ch.kind === 'zid') {
      const publicKey = String(b?.publicKey || '').trim().toLowerCase()
      const signature = String(b?.signature || '').trim()
      if (!verifyZid(publicKey, ch.message, signature)) {
        return [403, { ok: false, error: 'bad_signature' }]
      }
      const t = now()
      const exp = t + sessionTtlMs
      const sid = newId('sess-')
      db.createSession({ sessionId: sid, kind: 'ed25519/zid', subject: publicKey, origin, issuedAt: t, exp, revokeSessionId })
      const token = signSessionToken({ sid, lid: publicKey, sub: publicKey, kind: 'ed25519/zid', org: origin, iat: t, exp }, secretBytes)
      return [
        200,
        { ok: true, role: 'guest', login_id: publicKey, kind: 'ed25519/zid', source: 'session', live: Boolean(roleReader) },
        { 'set-cookie': setCookieHeader(token, origin) },
      ]
    }

    if (method === 'passkey' && ch.kind === 'passkey') {
      const credId = String(b?.credId || '').trim()
      if (!CRED_ID_RE.test(credId)) return [400, { ok: false, error: 'bad_cred_id' }]
      const existing = db.getPasskey(credId)
      const providedPubBytes = b?.publicKey ? fromB64Any(b.publicKey) : null
      const providedPubNorm = providedPubBytes ? providedPubBytes.toString('base64url') : ''
      if (existing && providedPubNorm && existing.publicKey !== providedPubNorm) {
        return [403, { ok: false, error: 'passkey_key_mismatch' }]
      }
      const pubForCheck = existing ? existing.publicKey : providedPubNorm
      const expectedRpId = existing ? existing.rpId : resolveRpIdForOrigin(origin, rpId)
      if (!pubForCheck) return [400, { ok: false, error: 'proof_required' }]

      const pkCheck = verifyPasskeyAssertion({
        origin,
        rpId: expectedRpId,
        challengeB64: ch.challengeB64,
        publicKey: pubForCheck,
        assertion: b?.assertion,
        prevSignCount: existing ? existing.signCount : 0,
      })
      if (!pkCheck.ok) return [403, { ok: false, error: pkCheck.error }]

      const t = now()
      const stored = db.recordPasskeyUse({
        credId,
        publicKey: pkCheck.normalizedPublicKey,
        rpId: pkCheck.rpId,
        signCount: pkCheck.signCount,
        now: t,
      })
      if (!stored.ok) return [403, { ok: false, error: stored.error }]

      const exp = t + sessionTtlMs
      const sid = newId('sess-')
      db.createSession({ sessionId: sid, kind: 'p256/passkey', subject: credId, origin, issuedAt: t, exp, revokeSessionId })
      const token = signSessionToken({ sid, lid: credId, sub: credId, kind: 'p256/passkey', org: origin, iat: t, exp }, secretBytes)
      return [
        200,
        { ok: true, role: 'guest', login_id: credId, kind: 'p256/passkey', source: 'session', live: Boolean(roleReader) },
        { 'set-cookie': setCookieHeader(token, origin) },
      ]
    }

    if (method === 'adr036' && ch.kind === 'adr036') {
      const address = String(b?.artist_id || b?.address || b?.login_id || '').trim()
      if (ch.address.toLowerCase() !== address.toLowerCase()) {
        return [403, { ok: false, error: 'challenge_mismatch' }]
      }
      const signature = {
        typ: 'zafu-adr36',
        signer: address,
        pub_key: b?.pub_key?.type ? b.pub_key : { type: 'tendermint/PubKeySecp256k1', value: b?.pub_key },
        signature: b?.signature,
      }
      if (!verifyAdr036(PREFIX, address, ch.message, signature)) {
        return [403, { ok: false, error: 'bad_signature' }]
      }
      let role = 'guest'
      let source = 'session'
      let live = false
      if (roleReader) {
        const r = await roleReader.resolveAddressRole(address)
        if (r.error) return [503, { ok: false, error: 'role_query_failed' }]
        role = r.role || 'guest'
        source = r.source || source
        live = !!r.live
      }
      const t = now()
      const exp = t + sessionTtlMs
      const sid = newId('sess-')
      db.createSession({ sessionId: sid, kind: 'terp-bech32', subject: address, origin, issuedAt: t, exp, revokeSessionId })
      const token = signSessionToken({ sid, lid: address, sub: address, kind: 'terp-bech32', org: origin, iat: t, exp }, secretBytes)
      return [
        200,
        { ok: true, role, login_id: address, kind: 'terp-bech32', source, live },
        { 'set-cookie': setCookieHeader(token, origin) },
      ]
    }

    return [400, { ok: false, error: 'method' }]
  }

  const me = async (req) => {
    const token = cookieOf(req)
    if (!token) return [200, { ok: false, error: 'no_session' }]
    const claims = verifySessionToken(token, secretBytes, { now: now() })
    if (!claims || !origins.has(claims.org)) return [200, { ok: false, error: 'no_session' }]
    const sess = db.getActiveSession(claims.sid, now())
    if (!sess) return [200, { ok: false, error: 'no_session' }]

    let role = 'guest'
    let source = 'session'
    let live = Boolean(roleReader)
    if (sess.kind === 'terp-bech32' && roleReader) {
      const requestedContract = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('contract') || ''
      const r = await roleReader.resolveAddressRole(sess.subject, requestedContract)
      if (r.role) role = r.role
      if (r.source) source = r.source
      live = Boolean(r.live)
    }

    return [
      200,
      {
        ok: true,
        role,
        login_id: sess.subject,
        kind: sess.kind,
        source,
        live,
      },
    ]
  }

  const logout = (req) => {
    if (!csrfOk(req)) return [403, { ok: false, error: 'csrf_required' }]
    const hdrOrigin = String(req?.headers?.origin || '').trim()
    if (hdrOrigin && !origins.has(hdrOrigin)) return [403, { ok: false, error: 'origin_refused' }]

    const token = cookieOf(req)
    let cookieOrigin = hdrOrigin || [...origins][0] || ''
    if (token) {
      const claims = verifySessionToken(token, secretBytes, { now: now() })
      if (claims) {
        db.revokeSession(claims.sid, now())
        if (claims.org) cookieOrigin = claims.org
      }
    }
    return [200, { ok: true }, { 'set-cookie': clearCookieHeader(cookieOrigin) }]
  }

  const eventRoles = async (req) => {
    const ip = ipOf(req)
    if (!hit(`rl:ip:${ip}`, ipRolesLimit)) {
      return [429, { ok: false, error: 'rate_limited' }, { 'retry-after': '60' }]
    }
    if (!roleReader) return [200, { ok: false, error: 'no_event_contract' }]
    const requestedContract = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('contract') || ''
    const r = await roleReader.getEventRoles(requestedContract)
    if (!r.ok && (r.error === 'bad_contract' || r.error === 'unknown_contract')) {
      return [400, r]
    }
    if (!r.ok) return [502, r]
    return [200, r]
  }

  return {
    handlers: {
      'GET /sezs/session/health': health,
      'POST /sezs/session/challenge': challenge,
      'POST /sezs/session/verify': verify,
      'GET /sezs/session/me': me,
      'POST /sezs/session/logout': logout,
      'GET /sezs/v2/event/roles': eventRoles,
    },
    close: () => {
      if (ownStore) db.close()
    },
  }
}
