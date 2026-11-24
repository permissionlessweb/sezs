/**
 * Compact guest ticket QR (v3).
 *
 * The guest shows one static QR. It carries the ticket opening (the secret)
 * plus the smallest event/sku reference the usher needs to recompute the
 * commitment and prove on their device. The guest does not generate a proof.
 *
 * Binary layout (big-endian lengths):
 *   version   1 byte     = 0x03
 *   flags     1 byte     bit0 = sku present (else sku is "ga")
 *                        bit1 = 8-byte event tag present (always set)
 *   secret   32 bytes
 *   [sku_len  1 byte + sku utf8]     if bit0
 *   [event_tag 8 bytes]              if bit1 — sha256(utf8(eventId))[0:8]
 *
 * Encoding: bech32m, HRP `sezs3`. Typical payload is 42 raw bytes, ~80
 * characters, which fits a Version 4 QR at ECC M (alphanumeric, 90-character
 * budget). Size budget: raw ≤ 64 bytes, encoded ≤ 90 characters. Longer SKUs
 * may need Version 5 (122 alphanumeric).
 *
 * An older `sezs1://ticket?e=&t=&k=` URI is still accepted by parseGuestQr.
 */
import { sha256 } from '@noble/hashes/sha256'
import { encodeBech32, decodeBech32 } from '../../pay/bech32.mjs'

export const GUEST_QR_VERSION = 3
export const GUEST_QR_HRP = 'sezs3'
export const GUEST_QR_CHAR_BUDGET = 90
export const GUEST_QR_RAW_BUDGET = 64
export const DEFAULT_SKU = 'ga'
export const EVENT_TAG_LEN = 8
export const FLAG_SKU = 0x01
export const FLAG_EVENT_TAG = 0x02

const convertBits = (data, from, to, pad) => {
  let acc = 0
  let bits = 0
  const out = []
  const maxv = (1 << to) - 1
  for (const v of data) {
    acc = (acc << from) | v
    bits += from
    while (bits >= to) {
      bits -= to
      out.push((acc >> bits) & maxv)
    }
  }
  if (pad && bits) out.push((acc << (to - bits)) & maxv)
  else if (bits >= from || ((acc << (to - bits)) & maxv)) return null
  return out
}

export const eventTag = (eventId) => sha256(new TextEncoder().encode(String(eventId))) .slice(0, EVENT_TAG_LEN)

export const eventTagMatches = (eventId, tag) => {
  if (!tag || tag.length !== EVENT_TAG_LEN) return false
  const expect = eventTag(eventId)
  for (let i = 0; i < EVENT_TAG_LEN; i++) if (expect[i] !== tag[i]) return false
  return true
}

export const encodeGuestQrBytes = ({ secret, sku = DEFAULT_SKU, eventId }) => {
  if (!(secret instanceof Uint8Array) || secret.length !== 32) throw new Error('secret must be 32 bytes')
  if (!eventId) throw new Error('eventId required')
  const skuStr = String(sku || DEFAULT_SKU)
  if (skuStr.length > 16) throw new Error('sku too long')
  const includeSku = skuStr !== DEFAULT_SKU
  const flags = (includeSku ? FLAG_SKU : 0) | FLAG_EVENT_TAG
  const tag = eventTag(eventId)
  const skuBytes = includeSku ? new TextEncoder().encode(skuStr) : new Uint8Array()
  const out = new Uint8Array(2 + 32 + (includeSku ? 1 + skuBytes.length : 0) + EVENT_TAG_LEN)
  out[0] = GUEST_QR_VERSION
  out[1] = flags
  out.set(secret, 2)
  let i = 34
  if (includeSku) {
    out[i++] = skuBytes.length
    out.set(skuBytes, i)
    i += skuBytes.length
  }
  out.set(tag, i)
  if (out.length > GUEST_QR_RAW_BUDGET) throw new Error('guest qr exceeds raw size budget')
  return out
}

export const encodeGuestQr = (fields) => {
  const bytes = encodeGuestQrBytes(fields)
  const text = encodeBech32(GUEST_QR_HRP, bytes, 'bech32m')
  if (text.length > GUEST_QR_CHAR_BUDGET) throw new Error('guest qr exceeds character budget')
  return text
}

export const decodeGuestQrBytes = (bytes) => {
  if (!(bytes instanceof Uint8Array) || bytes.length < 2 + 32 + EVENT_TAG_LEN) throw new Error('short guest qr')
  if (bytes[0] !== GUEST_QR_VERSION) throw new Error('unsupported guest qr version')
  const flags = bytes[1]
  const secret = bytes.slice(2, 34)
  let i = 34
  let sku = DEFAULT_SKU
  if (flags & FLAG_SKU) {
    const n = bytes[i++]
    if (!n || i + n > bytes.length) throw new Error('truncated sku')
    sku = new TextDecoder().decode(bytes.slice(i, i + n))
    i += n
  }
  if (!(flags & FLAG_EVENT_TAG)) throw new Error('guest qr missing event tag')
  if (i + EVENT_TAG_LEN > bytes.length) throw new Error('truncated event tag')
  const tag = bytes.slice(i, i + EVENT_TAG_LEN)
  i += EVENT_TAG_LEN
  if (i !== bytes.length) throw new Error('unexpected guest qr trailing bytes')
  return { version: GUEST_QR_VERSION, secret, sku, eventTag: tag }
}

export const decodeGuestQrText = (text) => {
  const raw = String(text || '').trim()
  const dec = decodeBech32(raw)
  if (!dec || dec.hrp !== GUEST_QR_HRP) throw new Error('not a sezs3 ticket')
  const bytes = Uint8Array.from(convertBits(dec.data, 5, 8, false) || [])
  if (!bytes.length) throw new Error('bad sezs3 payload')
  return decodeGuestQrBytes(bytes)
}

/** v1 URI still accepted so older printouts and stored tickets keep working. */
const parseV1Uri = (text) => {
  const raw = String(text || '').trim()
  let u
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (!(u.protocol === 'sezs1:' && u.hostname === 'ticket') && !raw.startsWith('sezs1://ticket?')) return null
  const q = u.searchParams
  const eventId = q.get('e') || ''
  const sku = q.get('t') || ''
  const k = (q.get('k') || '').toLowerCase()
  if (!eventId || !sku || !/^[0-9a-f]{64}$/.test(k)) return null
  const secret = new Uint8Array(32)
  for (let i = 0; i < 32; i++) secret[i] = parseInt(k.slice(i * 2, i * 2 + 2), 16)
  return { version: 1, secret, sku, eventId, eventTag: eventTag(eventId) }
}

/**
 * Parse a guest ticket QR (v3 bech32 or v1 URI).
 * @returns {{ ok: true, version: number, secret: Uint8Array, sku: string, eventTag?: Uint8Array, eventId?: string } | { ok: false, error: string }}
 */
export const parseGuestQr = (text) => {
  const raw = String(text || '').trim()
  if (!raw) return { ok: false, error: 'empty' }
  if (raw.toLowerCase().startsWith(GUEST_QR_HRP + '1')) {
    try {
      return { ok: true, ...decodeGuestQrText(raw) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'bad_qr' }
    }
  }
  const v1 = parseV1Uri(raw)
  if (v1) return { ok: true, ...v1 }
  return { ok: false, error: 'bad_qr' }
}

export const guestQrSize = (text) => ({
  chars: String(text || '').length,
  withinBudget: String(text || '').length <= GUEST_QR_CHAR_BUDGET,
  budget: GUEST_QR_CHAR_BUDGET,
})
