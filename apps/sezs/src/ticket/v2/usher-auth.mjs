/**
 * Usher authorization over a consume.
 *
 * Canonical message (UTF-8 lines, no trailing spaces):
 *
 *   SEZS-CONSUME-V3
 *   usher: <terp1...>
 *   event: <event id>
 *   nullifier: <64 hex>
 *   root: <64 hex>
 *   proof_hash: <64 hex sha256 of the proof bytes>
 *   expiry: <unix seconds>
 *
 * Production: the usher's Zafu signs the ConsumeTicket transaction
 * (window.zafu.signAmino / signDirect). That signature covers these fields
 * because they are in the execute message (plus timeout_height ≈ expiry).
 * The same canonical bytes are used for unit tests and for a compact
 * secp256k1 authorization when a full sign doc is not built yet.
 *
 * Zafu does not implement Keplr signArbitrary (ADR-36). See usher-auth notes
 * in the ticketing spec.
 */
import { sha256 } from '@noble/hashes/sha256'
import { secp256k1 } from '@noble/curves/secp256k1'

export const AUTH_DOMAIN = 'SEZS-CONSUME-V3'
export const DEFAULT_TTL_SEC = 120

const utf8 = (s) => new TextEncoder().encode(s)
const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('')
const unhex = (s) => {
  const t = String(s || '').trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]*$/.test(t) || t.length % 2) throw new Error('bad hex')
  return Uint8Array.from(t.match(/../g) || [], (h) => parseInt(h, 16))
}
const fromB64 = (s) => {
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(s, 'base64'))
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const isHex32 = (s) => /^[0-9a-f]{64}$/i.test(String(s || ''))
const isUsherAddr = (s) => /^terp1[0-9a-z]{38,}$/i.test(String(s || ''))

export const proofHash = (proof) => {
  let bytes = proof
  if (typeof proof === 'string') {
    const s = proof.trim()
    if (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0) bytes = unhex(s)
    else bytes = fromB64(s)
  }
  if (!(bytes instanceof Uint8Array)) bytes = Uint8Array.from(bytes)
  return hex(sha256(bytes))
}

export const encodeAuthMessage = ({ usher, eventId, nullifier, root, proofHash: ph, expiry }) => {
  if (!isUsherAddr(usher)) throw new Error('bad usher address')
  if (!eventId) throw new Error('eventId required')
  if (!isHex32(nullifier) || !isHex32(root) || !isHex32(ph)) throw new Error('nullifier, root, and proof_hash must be 32-byte hex')
  const exp = Number(expiry)
  if (!Number.isFinite(exp) || exp <= 0) throw new Error('expiry required')
  const text = [
    AUTH_DOMAIN,
    `usher: ${usher}`,
    `event: ${eventId}`,
    `nullifier: ${String(nullifier).toLowerCase()}`,
    `root: ${String(root).toLowerCase()}`,
    `proof_hash: ${String(ph).toLowerCase()}`,
    `expiry: ${Math.floor(exp)}`,
  ].join('\n')
  return { text, bytes: utf8(text) }
}

export const decodeAuthMessage = (bytesOrText) => {
  const text = typeof bytesOrText === 'string' ? bytesOrText : new TextDecoder().decode(bytesOrText)
  const lines = text.split('\n')
  if (lines[0] !== AUTH_DOMAIN) throw new Error('bad auth domain')
  const field = (prefix) => {
    const line = lines.find((l) => l.startsWith(prefix))
    if (!line) throw new Error(`missing ${prefix}`)
    return line.slice(prefix.length).trim()
  }
  return {
    usher: field('usher: '),
    eventId: field('event: '),
    nullifier: field('nullifier: '),
    root: field('root: '),
    proofHash: field('proof_hash: '),
    expiry: Number(field('expiry: ')),
  }
}

/** Compact secp256k1 signature over sha256(canonical bytes). Test / lab helper. */
export const signAuth = (messageBytes, privateKey) => {
  const hash = sha256(messageBytes)
  const sig = secp256k1.sign(hash, privateKey)
  return {
    typ: 'secp256k1-sha256',
    signature: sig.toCompactHex(),
    pubKey: hex(secp256k1.getPublicKey(privateKey, true)),
  }
}

export const verifyAuth = (messageBytes, { typ, signature, pubKey }) => {
  if (typ !== 'secp256k1-sha256') return false
  try {
    const hash = sha256(messageBytes)
    return secp256k1.verify(signature, hash, unhex(pubKey))
  } catch {
    return false
  }
}

export const authBindsConsume = (auth, consume, { now = Math.floor(Date.now() / 1000) } = {}) => {
  if (!auth || !consume) return { ok: false, error: 'missing_fields' }
  if (Number(auth.expiry) <= now) return { ok: false, error: 'expired' }
  if (String(auth.nullifier).toLowerCase() !== String(consume.nullifier).toLowerCase()) return { ok: false, error: 'nullifier_mismatch' }
  if (String(auth.root).toLowerCase() !== String(consume.root).toLowerCase()) return { ok: false, error: 'root_mismatch' }
  const ph = consume.proofHash || proofHash(consume.proof)
  if (String(auth.proofHash).toLowerCase() !== String(ph).toLowerCase()) return { ok: false, error: 'proof_hash_mismatch' }
  if (auth.eventId && consume.eventId && auth.eventId !== consume.eventId) return { ok: false, error: 'event_mismatch' }
  return { ok: true }
}

export { hex as authHex, unhex as authUnhex }
