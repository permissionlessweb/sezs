/**
 * Wallet login challenge and verify for staff sessions.
 * - method zid: ed25519 over a origin-bound challenge (site-scoped Zafu ZID)
 * - method adr036: leftover terp-bech32 path (on-chain consume still uses this style)
 * Cookie holds a short session id. Never logs signatures or keys.
 */
import { randomBytes } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519'
import { verifyAdr036 } from '../../src/ticket/v2/adr036.mjs'
import { resolveLiveRole } from './live-roles.mjs'

const ALLOWED = new Set(['http://127.0.0.1:3051', 'http://localhost:3051'])
const TTL_MS = 2 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const PREFIX = 'terp'

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
    `audience: sezs`,
    `nonce: ${nonce}`,
    `ts: ${ts}`,
  ].join('\n')

export const zidChallengeHex = (message) => Buffer.from(message, 'utf8').toString('hex')

const newId = (prefix, bytes = 8) => prefix + randomBytes(bytes).toString('hex')

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

export const makeSessionLogin = ({ allowedOrigins = ALLOWED, liveConfig, cookieName = 'sezs_splash' } = {}) => {
  const challenges = new Map()
  const sessions = new Map()

  const prune = (now = Date.now()) => {
    for (const [k, v] of challenges) if (v.exp <= now) challenges.delete(k)
    for (const [k, v] of sessions) if (v.exp <= now) sessions.delete(k)
  }

  const roleOfSession = (id) => {
    prune()
    return sessions.get(id)?.role || null
  }
  const addressOfSession = (id) => {
    prune()
    return sessions.get(id)?.address || ''
  }
  const recordOf = (id) => {
    prune()
    return sessions.get(id) || null
  }

  const cookieHeader = (id) =>
    `${cookieName}=${id}; Path=/; HttpOnly; SameSite=Strict`

  const challenge = (_req, b) => {
    prune()
    const origin = String(b?.origin || '')
    if (!allowedOrigins.has(origin)) return [403, { ok: false, error: 'origin_refused' }]
    const kind = String(b?.kind || (b?.artist_id || b?.address ? 'adr036' : 'zid'))
    const nonce = randomBytes(16).toString('hex')
    const ts = Date.now()
    if (kind === 'zid') {
      const message = zidLoginMessage({ origin, nonce, ts })
      const challengeHex = zidChallengeHex(message)
      challenges.set(nonce, { kind: 'zid', origin, ts, exp: ts + TTL_MS, message, challengeHex })
      return [200, { ok: true, nonce, ts, message, challengeHex, statement: `Sign in to ${origin}` }]
    }
    const address = String(b?.artist_id || b?.address || '').trim()
    if (!/^terp1[a-z0-9]{20,}$/i.test(address)) return [400, { ok: false, error: 'bad_address' }]
    const message = loginMessage({ origin, address, nonce, ts })
    challenges.set(nonce, { kind: 'adr036', origin, address, ts, exp: ts + TTL_MS, message })
    return [200, { ok: true, nonce, ts, message }]
  }

  const verify = async (_req, b) => {
    prune()
    const origin = String(b?.origin || '')
    const nonce = String(b?.nonce || '')
    const ch = challenges.get(nonce)
    challenges.delete(nonce)
    if (!ch) return [400, { ok: false, error: 'unknown_challenge' }]
    if (ch.exp <= Date.now()) return [400, { ok: false, error: 'expired' }]
    if (ch.origin !== origin) return [403, { ok: false, error: 'challenge_mismatch' }]

    const method = String(b?.method || (ch.kind === 'zid' ? 'zid' : 'adr036'))
    if (method === 'zid' || ch.kind === 'zid') {
      if (method !== 'zid' || ch.kind !== 'zid') return [400, { ok: false, error: 'method' }]
      const publicKey = String(b?.publicKey || '').trim()
      const signature = String(b?.signature || '').trim()
      if (!verifyZid(publicKey, ch.message, signature)) {
        return [403, { ok: false, error: 'bad_signature' }]
      }
      const id = newId('sess-')
      sessions.set(id, {
        address: publicKey,
        kind: 'ed25519/zid',
        role: 'guest',
        source: 'session',
        live: false,
        exp: Date.now() + SESSION_TTL_MS,
      })
      return [
        200,
        { ok: true, role: 'guest', login_id: publicKey, kind: 'ed25519/zid', source: 'session', live: false },
        { 'set-cookie': cookieHeader(id) },
      ]
    }

    if (method !== 'adr036') return [400, { ok: false, error: 'method' }]
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
    const cfg = typeof liveConfig === 'function' ? liveConfig() : liveConfig
    let role = 'guest'
    let source = 'session'
    let live = false
    if (cfg?.lcd) {
      const r = await resolveLiveRole(cfg, { address, sessionRole: null })
      role = r.role || 'guest'
      source = r.source || source
      live = !!r.live
      if (r.error && r.live) return [403, { ok: false, error: 'role_query_failed' }]
    }
    const id = newId('sess-')
    sessions.set(id, { address, kind: 'terp-bech32', role, source, live, exp: Date.now() + SESSION_TTL_MS })
    return [
      200,
      { ok: true, role, login_id: address, kind: 'terp-bech32', source, live },
      { 'set-cookie': cookieHeader(id) },
    ]
  }

  return {
    roleOfSession,
    addressOfSession,
    recordOf,
    handlers: {
      'POST /sezs/session/challenge': challenge,
      'POST /sezs/session/verify': verify,
    },
  }
}

export const staffMeBody = (record, fallbackRole, fallbackAddress) => {
  if (record) {
    return {
      ok: true,
      role: record.role,
      login_id: record.address,
      kind: record.kind,
      source: record.source,
      live: record.live,
    }
  }
  if (!fallbackRole) return { ok: false, error: 'no_session' }
  return { ok: true, role: fallbackRole, login_id: fallbackAddress || '', source: 'session', live: false }
}
