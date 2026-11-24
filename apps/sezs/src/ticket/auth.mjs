/**
 * Ticket signing keys and two-way door consent.
 *
 * The signing seed is a domain-separated KDF of ticketSecret plus event_id
 * and the contract domain. The backend never sees the secret — only the
 * public key (registered at purchase, alongside C, not inside the Poseidon
 * leaf) and signatures.
 *
 * Live: sign a door challenge (event, domain, nonce, usher key, time).
 * Print: pre-sign (event, domain, global door-auth pubkey, sku). Paper is
 * still bearer; printing is the consent.
 */
import { toHex, fromHex } from './poseidon.mjs'

export const SIGN_KDF_DOMAIN = 'sezs-ticket-sign-v1'
export const CHALLENGE_DOMAIN = 'sezs-door-challenge-v1'
export const PRINT_AUTH_DOMAIN = 'sezs-door-print-v1'
export const CHALLENGE_SCHEME = 'sezs1://door'
export const ADMIT_SCHEME = 'sezs1://admit'
export const APPROVE_SCHEME = 'sezs1://approve'
export const CHALLENGE_TTL_MS = 120_000

const enc = new TextEncoder()

const subtleOf = () => {
  const c = globalThis.crypto
  if (!c?.subtle) throw new Error('no_crypto')
  return c.subtle
}

const lp = (s) => {
  const b = enc.encode(String(s))
  if (b.length > 255) throw new Error('kdf_label')
  const out = new Uint8Array(1 + b.length)
  out[0] = b.length
  out.set(b, 1)
  return out
}

const concat = (parts) => {
  const n = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const hex32 = (raw) => {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^0x/, '')
  return /^[0-9a-f]{64}$/.test(s) ? s : null
}

export const normalizeOrigin = (raw) => {
  let u
  try {
    u = new URL(String(raw || '').trim())
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password || u.search || u.hash) return null
  if (u.pathname && u.pathname !== '/') return null
  if (!u.hostname) return null
  const port = u.port ? `:${u.port}` : ''
  return `${u.protocol}//${u.hostname}${port}`
}

const pkcs8FromSeed = (seed) => {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) throw new Error('sign_seed')
  const prefix = fromHex('302e020100300506032b657004220420')
  return concat([prefix, seed])
}

const spkiFromRaw = (raw) => {
  if (!(raw instanceof Uint8Array) || raw.length !== 32) throw new Error('sign_pub')
  const prefix = fromHex('302a300506032b6570032100')
  return concat([prefix, raw])
}

export const deriveTicketSignSeed = async ({ secret, eventId, domain }) => {
  const secretBytes = secret instanceof Uint8Array ? secret : fromHex(String(secret))
  if (secretBytes.length !== 32) throw new Error('secret_len')
  const origin = normalizeOrigin(domain)
  const event = String(eventId || '')
  if (!origin || !event) throw new Error('sign_context')
  const subtle = subtleOf()
  const salt = new Uint8Array(await subtle.digest('SHA-256', enc.encode(SIGN_KDF_DOMAIN)))
  const info = concat([enc.encode(SIGN_KDF_DOMAIN), lp(event), lp(origin), enc.encode('ed25519')])
  const key = await subtle.importKey('raw', secretBytes, 'HKDF', false, ['deriveBits'])
  const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, 256)
  return new Uint8Array(bits)
}

const importPrivate = async (seed) => {
  const subtle = subtleOf()
  return subtle.importKey('pkcs8', pkcs8FromSeed(seed), { name: 'Ed25519' }, true, ['sign'])
}

const rawPublicOf = async (priv) => {
  const subtle = subtleOf()
  const jwk = await subtle.exportKey('jwk', priv)
  if (!jwk.x) throw new Error('sign_pub')
  const b64 = jwk.x.replace(/-/g, '+').replace(/_/g, '/')
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  if (out.length !== 32) throw new Error('sign_pub')
  return out
}

export const ticketKeypair = async ({ secret, eventId, domain }) => {
  const seed = await deriveTicketSignSeed({ secret, eventId, domain })
  const priv = await importPrivate(seed)
  const publicKey = await rawPublicOf(priv)
  return {
    publicKey,
    publicHex: toHex(publicKey),
    sign: async (data) => {
      const bytes = data instanceof Uint8Array ? data : enc.encode(String(data))
      const sig = await subtleOf().sign({ name: 'Ed25519' }, priv, bytes)
      return new Uint8Array(sig)
    },
  }
}

export const verifyEd25519 = async (publicRaw, data, signature) => {
  const pubBytes = publicRaw instanceof Uint8Array ? publicRaw : fromHex(String(publicRaw))
  const sigBytes = signature instanceof Uint8Array ? signature : fromHex(String(signature))
  const msg = data instanceof Uint8Array ? data : enc.encode(String(data))
  if (pubBytes.length !== 32 || sigBytes.length !== 64) return false
  try {
    const key = await subtleOf().importKey('spki', spkiFromRaw(pubBytes), { name: 'Ed25519' }, false, [
      'verify',
    ])
    return await subtleOf().verify({ name: 'Ed25519' }, key, sigBytes, msg)
  } catch {
    return false
  }
}

export const challengeBytes = ({ eventId, domain, nonce, usherPubkey, timestamp }) => {
  const origin = normalizeOrigin(domain)
  if (!origin) throw new Error('bad_domain')
  return concat([
    enc.encode(CHALLENGE_DOMAIN),
    lp(eventId),
    lp(origin),
    lp(String(nonce || '').toLowerCase()),
    lp(String(usherPubkey || '').toLowerCase()),
    lp(String(timestamp)),
  ])
}

export const printAuthBytes = ({ eventId, domain, adminPubkey, sku }) => {
  const origin = normalizeOrigin(domain)
  if (!origin) throw new Error('bad_domain')
  return concat([
    enc.encode(PRINT_AUTH_DOMAIN),
    lp(eventId),
    lp(origin),
    lp(String(adminPubkey || '').toLowerCase()),
    lp(sku),
  ])
}

export const encodeChallengeUri = ({ eventId, domain, nonce, usherPubkey, timestamp }) => {
  const origin = normalizeOrigin(domain)
  const q = new URLSearchParams({
    e: String(eventId),
    d: origin,
    n: String(nonce).toLowerCase(),
    u: String(usherPubkey).toLowerCase(),
    t: String(timestamp),
  })
  return `${CHALLENGE_SCHEME}?${q.toString()}`
}

export const parseChallengeUri = (text) => {
  const raw = String(text || '').trim()
  let u
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, error: 'bad_challenge' }
  }
  if (!(raw.startsWith('sezs1://door?'))) return { ok: false, error: 'bad_challenge' }
  const q = u.searchParams
  const eventId = q.get('e') || ''
  const domain = normalizeOrigin(q.get('d') || '')
  const nonce = (q.get('n') || '').toLowerCase()
  const usherPubkey = (q.get('u') || '').toLowerCase()
  const timestamp = Number(q.get('t') || '')
  if (!eventId || !domain || !/^[0-9a-f]{16,128}$/.test(nonce) || !Number.isFinite(timestamp)) {
    return { ok: false, error: 'bad_challenge' }
  }
  return { ok: true, eventId, domain, nonce, usherPubkey, timestamp }
}

export const encodeAdmitUri = ({ eventId, domain, sku, ticketPubkey, signature, commitment }) => {
  const origin = normalizeOrigin(domain)
  const q = new URLSearchParams({
    e: String(eventId),
    d: origin,
    t: String(sku),
    p: String(ticketPubkey).toLowerCase(),
    s: String(signature).toLowerCase(),
  })
  if (commitment) q.set('c', String(commitment).toLowerCase())
  return `${ADMIT_SCHEME}?${q.toString()}`
}

export const parseAdmitUri = (text) => {
  const raw = String(text || '').trim()
  let u
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, error: 'bad_admit' }
  }
  if (!(raw.startsWith('sezs1://admit?'))) return { ok: false, error: 'bad_admit' }
  const q = u.searchParams
  const eventId = q.get('e') || ''
  const domain = normalizeOrigin(q.get('d') || '')
  const sku = q.get('t') || ''
  const ticketPubkey = hex32(q.get('p'))
  const signature = String(q.get('s') || '')
    .trim()
    .toLowerCase()
  const commitment = hex32(q.get('c') || '')
  if (!eventId || !domain || !sku || !ticketPubkey || !/^[0-9a-f]{128}$/.test(signature)) {
    return { ok: false, error: 'bad_admit' }
  }
  return { ok: true, eventId, domain, sku, ticketPubkey, signature, commitment }
}


export const encodeApproveUri = ({ eventId, nonce, ticketPubkey, signature, nullifier }) => {
  const q = new URLSearchParams({
    e: String(eventId),
    n: String(nonce).toLowerCase(),
    p: String(ticketPubkey).toLowerCase(),
    s: String(signature).toLowerCase(),
  })
  if (nullifier) q.set('f', String(nullifier).toLowerCase())
  return `${APPROVE_SCHEME}?${q.toString()}`
}

export const parseApproveUri = (text) => {
  const raw = String(text || '').trim()
  let u
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, error: 'bad_approve' }
  }
  if (!(raw.startsWith('sezs1://approve?'))) return { ok: false, error: 'bad_approve' }
  const q = u.searchParams
  const eventId = q.get('e') || ''
  const nonce = (q.get('n') || '').toLowerCase()
  const ticketPubkey = String(q.get('p') || '').trim().toLowerCase()
  const signature = String(q.get('s') || '').trim().toLowerCase()
  const nullifier = String(q.get('f') || '').trim().toLowerCase() || null
  if (!eventId || !/^[0-9a-f]{16,128}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(ticketPubkey) || !/^[0-9a-f]{128}$/.test(signature)) {
    return { ok: false, error: 'bad_approve' }
  }
  if (nullifier && !/^[0-9a-f]{64}$/.test(nullifier)) return { ok: false, error: 'bad_approve' }
  return { ok: true, eventId, nonce, ticketPubkey, signature, nullifier }
}

export const isSecretTicketUri = (text) => {
  const raw = String(text || '').trim()
  if (/^sezs31[0-9a-z]+$/i.test(raw)) return true
  return raw.startsWith('sezs1://ticket?') && /[?&]k=/.test(raw)
}

export const signChallenge = async ({ secret, eventId, domain, nonce, usherPubkey, timestamp }) => {
  const pair = await ticketKeypair({ secret, eventId, domain })
  const bytes = challengeBytes({ eventId, domain, nonce, usherPubkey, timestamp })
  const signature = await pair.sign(bytes)
  return { publicHex: pair.publicHex, signatureHex: toHex(signature), bytes }
}

export const signPrintAuth = async ({ secret, eventId, domain, adminPubkey, sku }) => {
  const pair = await ticketKeypair({ secret, eventId, domain })
  const bytes = printAuthBytes({ eventId, domain, adminPubkey, sku })
  const signature = await pair.sign(bytes)
  return { publicHex: pair.publicHex, signatureHex: toHex(signature), bytes }
}

export const generateDoorAuthSeed = (rng) => {
  const b = new Uint8Array(32)
  if (rng) {
    const got = rng(32)
    b.set(got.length >= 32 ? got.slice(0, 32) : got)
  } else {
    globalThis.crypto.getRandomValues(b)
  }
  return b
}

export const doorAuthKeypair = async (seed) => {
  const priv = await importPrivate(seed)
  const publicKey = await rawPublicOf(priv)
  return {
    publicKey,
    publicHex: toHex(publicKey),
    sign: async (data) => {
      const bytes = data instanceof Uint8Array ? data : enc.encode(String(data))
      const sig = await subtleOf().sign({ name: 'Ed25519' }, priv, bytes)
      return new Uint8Array(sig)
    },
  }
}
