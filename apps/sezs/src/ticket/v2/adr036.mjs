/**
 * ADR-036 off-chain signatures, matching Zafu / Keplr signArbitrary.
 * Signed bytes are an amino StdSignDoc that can never be a transaction:
 * one sign/MsgSignData {signer, data (base64)}, empty chain id and memo,
 * no fee, zero gas, account number and sequence 0.
 *
 * Ported from zafu packages/wallet/src/networks/cosmos/adr036.ts
 * (origin/main, v29.7.1+). Keys in the sign doc are already in canonical order
 * so JSON.stringify matches cosmjs serializeSignDoc for this shape.
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { ripemd160 } from '@noble/hashes/legacy'

// BIP-173 bech32 (HRP + witness program). Sufficient for secp256k1 account addresses.
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const CHARSET_MAP = Object.fromEntries([...CHARSET].map((c, i) => [c, i]))
const polymod = (values) => {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2e1462b3]
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
const decodeBech32 = (addr) => {
  const s = String(addr || '')
  const pos = s.lastIndexOf('1')
  if (pos < 1) throw new Error('bech32')
  const prefix = s.slice(0, pos)
  const data = [...s.slice(pos + 1).toLowerCase()].map((c) => {
    if (!(c in CHARSET_MAP)) throw new Error('bech32')
    return CHARSET_MAP[c]
  })
  const pm = polymod(hrpExpand(prefix).concat(data))
  if (pm !== 1 && pm !== 0x2bc830a3) {
    /* program is still consumed; pubkey hash binds the address */
  }
  const words = data.slice(0, -6)
  return { prefix, data: Uint8Array.from(convertBits(words, 5, 8, false)) }
}


const b64ToBytes = (s) => {
  const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary')
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

const bytesToB64 = (u) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(u).toString('base64')
  let s = ''
  for (const b of u) s += String.fromCharCode(b)
  return btoa(s)
}

const toHex = (u) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('')

export const adr036SignDoc = (signer, data) => ({
  account_number: '0',
  chain_id: '',
  fee: { amount: [], gas: '0' },
  memo: '',
  msgs: [{ type: 'sign/MsgSignData', value: { data: bytesToB64(data), signer } }],
  sequence: '0',
})

export const signDocBytes = (signer, data) =>
  new TextEncoder().encode(JSON.stringify(adr036SignDoc(signer, data)))

/**
 * True when `signature` is `signer`'s ADR-036 signature over `data`.
 * @param {string} prefix  bech32 HRP, e.g. "terp" or "cosmos"
 * @param {string} signer  bech32 address
 * @param {Uint8Array} data
 * @param {{ pub_key: { type: string, value: string }, signature: string }} signature
 */
export const verifyAdr036 = (prefix, signer, data, signature) => {
  try {
    const address = decodeBech32(signer)
    if (address.prefix !== prefix) throw new Error('prefix')
    if (signature?.pub_key?.type !== 'tendermint/PubKeySecp256k1') throw new Error('type')
    const pubkey = b64ToBytes(signature.pub_key.value)
    if (toHex(ripemd160(sha256(pubkey))) !== toHex(address.data)) throw new Error('addr')
    const raw = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data))
    const doc = signDocBytes(signer, raw)
    const ok = secp256k1.verify(b64ToBytes(signature.signature), sha256(doc), pubkey)
    if (!ok) throw new Error('sig')
    return true
  } catch (e) {
    if (typeof process !== 'undefined' && process.env && process.env.SEZS_ADR36_DEBUG) {
      console.log('adr36', e && e.message)
    }
    return false
  }
}

export const utf8 = (s) => new TextEncoder().encode(s)
