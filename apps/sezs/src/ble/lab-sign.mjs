/**
 * Lab helpers: derive a terp1 address from a secp256k1 key and produce
 * an ADR-36 signature that verifyAdr036 accepts. Used by tests and by
 * the walkthrough e2e; production signing is Zafu signArbitrary.
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { ripemd160 } from '@noble/hashes/legacy'
import { signDocBytes } from '../ticket/v2/adr036.mjs'

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2e1462b3]

const polymod = (values) => {
  let chk = 1
  for (const v of values) {
    const b = chk >>> 25
    chk = (((chk & 0x1ffffff) << 5) ^ v) >>> 0
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk = (chk ^ GEN[i]) >>> 0
  }
  return chk
}

const hrpExpand = (hrp) => [...hrp].map((c) => c.charCodeAt(0) >> 5).concat(0, [...hrp].map((c) => c.charCodeAt(0) & 31))

const convertBits = (data, from, to, pad) => {
  let acc = 0
  let bits = 0
  const maxv = (1 << to) - 1
  const out = []
  for (const v of data) {
    acc = (acc << from) | v
    bits += from
    while (bits >= to) {
      bits -= to
      out.push((acc >> bits) & maxv)
    }
  }
  if (pad && bits) out.push((acc << (to - bits)) & maxv)
  return out
}

export const encodeBech32 = (hrp, data) => {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0])
  const mod = polymod(values) ^ 1
  const checksum = [0, 0, 0, 0, 0, 0].map((_, i) => (mod >>> (5 * (5 - i))) & 31)
  return hrp + '1' + [...data, ...checksum].map((v) => CHARSET[v]).join('')
}

const b64 = (u) => Buffer.from(u).toString('base64')

export const pubFromPriv = (priv) => secp256k1.getPublicKey(priv, true)

export const terpAddress = (privOrPub) => {
  const pub = privOrPub.length === 32 ? pubFromPriv(privOrPub) : privOrPub
  const hash = ripemd160(sha256(pub))
  const words = convertBits([...hash], 8, 5, true)
  return encodeBech32('terp', words)
}

export const signAdr036 = (signer, data, privateKey) => {
  const pub = pubFromPriv(privateKey)
  const raw = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data))
  const doc = signDocBytes(signer, raw)
  const sig = secp256k1.sign(sha256(doc), privateKey)
  const compact = typeof sig.toCompactRawBytes === 'function' ? sig.toCompactRawBytes() : sig.toRawBytes()
  return {
    typ: 'zafu-adr36',
    signer,
    pub_key: { type: 'tendermint/PubKeySecp256k1', value: b64(pub) },
    signature: b64(compact),
    pubKey: b64(pub),
  }
}

export const newAdmin = () => {
  const secret = secp256k1.utils.randomPrivateKey()
  const address = terpAddress(secret)
  return { secret, address, publicKey: pubFromPriv(secret) }
}
