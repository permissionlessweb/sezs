/**
 * XEdDSA verify over an X25519 public key, as frostd uses for login.
 * Matches Zafu's frost_relay_sign_challenge (same key Noise_K uses).
 *
 * Conversion is the standard Montgomery-u to Edwards-y map:
 *   y = (u - 1) / (u + 1)  (mod 2^255-19), sign bit 0.
 * The signature is a 64-byte XEdDSA/Ed25519 signature.
 */
import { createPublicKey, verify } from 'node:crypto'

const P = (1n << 255n) - 19n
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex')

const mod = (a) => {
  let x = a % P
  if (x < 0n) x += P
  return x
}

const modPow = (base, exp, m) => {
  let b = mod(base)
  let e = exp
  let r = 1n
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m
    b = (b * b) % m
    e >>= 1n
  }
  return r
}

const inv = (a) => modPow(mod(a), P - 2n, P)

const leToBig = (buf) => {
  let n = 0n
  for (let i = 0; i < buf.length; i++) n |= BigInt(buf[i]) << (8n * BigInt(i))
  return n
}

const bigToLe32 = (n) => {
  const out = Buffer.alloc(32)
  let x = n
  for (let i = 0; i < 32; i++) {
    out[i] = Number(x & 0xffn)
    x >>= 8n
  }
  return out
}

/** X25519 (Montgomery) public key → Ed25519 (Edwards) public key, sign bit 0. */
export const x25519ToEd25519 = (pubHex) => {
  const raw = Buffer.from(String(pubHex), 'hex')
  if (raw.length !== 32) throw new Error('bad_x25519_pubkey')
  let u = leToBig(raw)
  u &= (1n << 255n) - 1n
  const y = mod((u - 1n) * inv(u + 1n))
  const out = bigToLe32(y)
  out[31] &= 0x7f
  return out
}

const messageBytes = (challenge) => {
  const s = String(challenge)
  if (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0) {
    return Buffer.from(s, 'hex')
  }
  return Buffer.from(s, 'utf8')
}

/**
 * Verify an XEdDSA signature of a frostd login challenge.
 * @returns {boolean}
 */
export const verifyXeddsa = (publicKeyHex, challenge, signatureHex) => {
  try {
    const ed = x25519ToEd25519(publicKeyHex)
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI, ed]),
      format: 'der',
      type: 'spki',
    })
    const sig = Buffer.from(String(signatureHex), 'hex')
    if (sig.length !== 64) return false
    const msg = messageBytes(challenge)
    if (verify(null, msg, key, sig)) return true
    // Some implementations sign the utf8 of the hex string itself.
    if (verify(null, Buffer.from(String(challenge), 'utf8'), key, sig)) return true
    return false
  } catch {
    return false
  }
}
