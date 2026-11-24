/**
 * Browser-only ticket secret derivation.
 *
 * ticketSecret is a domain-separated KDF of a fresh CSPRNG seed (>= 256 bits)
 * plus event_id, sku, and a per-purchase invoice nonce. It is then reduced to
 * a Pallas field element so C = Poseidon(ticketSecret, sku, event_id) and
 * N = Poseidon(ticketSecret, event_id) stay circuit-compatible.
 *
 * The KDF input must never include a payment key, wallet address, or ZID.
 *
 * See apps/sezs/docs/BACKEND-ROLE.md.
 */
import { toHex, fromHex } from './poseidon.mjs'

export const SECRET_KDF_DOMAIN = 'sezs-ticket-secret-v1'
export const SEED_BYTES = 32
export const NONCE_BYTES = 16

const enc = new TextEncoder()

const subtleOf = () => {
  const c = globalThis.crypto
  if (!c?.subtle || !c.getRandomValues) throw new Error('no_rng')
  return c
}

export const defaultRng = (n) => {
  const b = new Uint8Array(n)
  subtleOf().getRandomValues(b)
  return b
}

/** Length-prefixed UTF-8, so labels cannot collide by concatenation. */
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

const sha256SyncOrThrow = async (bytes) => {
  const buf = await subtleOf().subtle.digest('SHA-256', bytes)
  return new Uint8Array(buf)
}

/**
 * HKDF-SHA256(ikm=seed, salt=SHA256(domain), info=domain||lp(event)||lp(sku)||lp(nonce))
 * → 32 bytes, then top two bits of the last byte cleared (Fp::from_bytes).
 *
 * Async because WebCrypto HKDF is async in the browser. Node 19+ has the same API.
 */
export const deriveTicketSecret = async ({ seed, eventId, sku, invoiceNonce }) => {
  const seedBytes = seed instanceof Uint8Array ? seed : fromHex(String(seed))
  if (seedBytes.length < SEED_BYTES) throw new Error('seed_len')
  const event = String(eventId || '')
  const tier = String(sku || '')
  const nonce = String(invoiceNonce || '')
  if (!event || !tier || !nonce) throw new Error('kdf_context')
  const crypto = subtleOf()
  const salt = await sha256SyncOrThrow(enc.encode(SECRET_KDF_DOMAIN))
  const info = concat([enc.encode(SECRET_KDF_DOMAIN), lp(event), lp(tier), lp(nonce)])
  const key = await crypto.subtle.importKey('raw', seedBytes, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, 256)
  return fitSecretToField(new Uint8Array(bits))
}

/** 32-byte field element: clear the top two bits of the last byte. */
export const fitSecretToField = (bytes) => {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error('secret_len')
  const b = new Uint8Array(bytes)
  b[31] &= 0x3f
  return b
}

export const newSeed = (rng = defaultRng) => {
  const b = rng(SEED_BYTES)
  if (!b || b.length < SEED_BYTES) throw new Error('seed_len')
  return Uint8Array.from(b).slice(0, SEED_BYTES)
}

export const newInvoiceNonce = (rng = defaultRng) => toHex(rng(NONCE_BYTES))

/**
 * Fresh, collision-resistant, non-identifying ticket material.
 * Pass a deterministic rng only in tests. Never pass a wallet key.
 * Seed and invoice nonce are generated when omitted.
 * @param {{ eventId: string, sku: string, invoiceNonce?: string, seed?: Uint8Array|string, rng?: (n: number) => Uint8Array }} [opts]
 */
export const newTicketMaterial = async ({
  eventId,
  sku,
  invoiceNonce,
  seed,
  rng = defaultRng,
} = {}) => {
  const seedBytes = seed
    ? seed instanceof Uint8Array
      ? seed
      : fromHex(String(seed))
    : newSeed(rng)
  const nonce = invoiceNonce || newInvoiceNonce(rng)
  const secret = await deriveTicketSecret({
    seed: seedBytes,
    eventId,
    sku,
    invoiceNonce: nonce,
  })
  return { seed: seedBytes, invoiceNonce: nonce, secret, eventId, sku }
}
