/**
 * P2WPKH (native segwit) address from compressed secp256k1 pubkey.
 * Production receive addresses for Cash App / mobile wallet QR funding.
 *
 * BIP173 bech32; witness version 0 + 20-byte HASH160(pubkey).
 */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

const polymod = (values: number[]): number => {
  let chk = 1
  for (const v of values) {
    const b = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) {
        chk ^= [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3][i]
      }
    }
  }
  return chk
}

const hrpExpand = (hrp: string): number[] => {
  const ret: number[] = []
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) >> 5)
  }
  ret.push(0)
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) & 31)
  }
  return ret
}

const createChecksum = (hrp: string, data: number[]): number[] => {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0])
  const mod = polymod(values) ^ 1
  const ret: number[] = []
  for (let p = 0; p < 6; p++) {
    ret.push((mod >> (5 * (5 - p))) & 31)
  }
  return ret
}

const bech32Encode = (hrp: string, data: number[]): string => {
  const combined = data.concat(createChecksum(hrp, data))
  let ret = hrp + '1'
  for (const d of combined) {
    ret += CHARSET.charAt(d)
  }
  return ret
}

const convertBits = (
  data: Uint8Array,
  from: number,
  to: number,
  pad: boolean
): number[] | null => {
  let acc = 0
  let bits = 0
  const ret: number[] = []
  const maxv = (1 << to) - 1
  for (let i = 0; i < data.length; i++) {
    const value = data[i]
    if (value < 0 || value >> from !== 0) {
      return null
    }
    acc = (acc << from) | value
    bits += from
    while (bits >= to) {
      bits -= to
      ret.push((acc >> bits) & maxv)
    }
  }
  if (pad) {
    if (bits > 0) {
      ret.push((acc << (to - bits)) & maxv)
    }
  } else if (bits >= from || (acc << (to - bits)) & maxv) {
    return null
  }
  return ret
}

/** Minimal RIPEMD-160 (for HASH160). */
const ripemd160 = (message: Uint8Array): Uint8Array => {
  // Use SubtleCrypto is not available for RIPEMD; compact pure impl.
  // Based on standard RIPEMD-160 (public domain algorithm).
  const zl = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6,
    15, 3, 12, 0, 9, 5, 2, 14, 11, 8, 3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6,
    13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2, 4, 0,
    5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
  ]
  const zr = [
    5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13,
    5, 10, 14, 15, 8, 12, 4, 9, 1, 2, 15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2,
    10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14, 12,
    15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
  ]
  const sl = [
    11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11,
    9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12, 11, 13, 6, 7, 14, 9, 13, 15, 14, 8,
    13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5,
    12, 9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
  ]
  const sr = [
    8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12,
    8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11, 9, 7, 15, 11, 8, 6, 6, 14, 12, 13,
    5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15,
    8, 8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
  ]
  const hl = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e]
  const hr = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000]

  const bytes = new Uint8Array(((message.length + 9 + 63) & ~63))
  bytes.set(message)
  bytes[message.length] = 0x80
  const bitLen = message.length * 8
  const view = new DataView(bytes.buffer)
  view.setUint32(bytes.length - 8, bitLen >>> 0, true)
  view.setUint32(bytes.length - 4, Math.floor(bitLen / 0x100000000), true)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n))
  const f = (j: number, x: number, y: number, z: number) => {
    if (j < 16) return x ^ y ^ z
    if (j < 32) return (x & y) | (~x & z)
    if (j < 48) return (x | ~y) ^ z
    if (j < 64) return (x & z) | (y & ~z)
    return x ^ (y | ~z)
  }

  const w = new Int32Array(16)
  for (let i = 0; i < bytes.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getInt32(i + j * 4, true)
    }
    let al = h0
    let bl = h1
    let cl = h2
    let dl = h3
    let el = h4
    let ar = h0
    let br = h1
    let cr = h2
    let dr = h3
    let er = h4
    for (let j = 0; j < 80; j++) {
      const t = (rotl(al + f(j, bl, cl, dl) + w[zl[j]] + hl[Math.floor(j / 16)], sl[j]) + el) | 0
      al = el
      el = dl
      dl = rotl(cl, 10)
      cl = bl
      bl = t
      const t2 =
        (rotl(ar + f(79 - j, br, cr, dr) + w[zr[j]] + hr[Math.floor(j / 16)], sr[j]) +
          er) |
        0
      ar = er
      er = dr
      dr = rotl(cr, 10)
      cr = br
      br = t2
    }
    const t = (h1 + cl + dr) | 0
    h1 = (h2 + dl + er) | 0
    h2 = (h3 + el + ar) | 0
    h3 = (h4 + al + br) | 0
    h4 = (h0 + bl + cr) | 0
    h0 = t
  }

  const out = new Uint8Array(20)
  const ov = new DataView(out.buffer)
  ov.setUint32(0, h0, true)
  ov.setUint32(4, h1, true)
  ov.setUint32(8, h2, true)
  ov.setUint32(12, h3, true)
  ov.setUint32(16, h4, true)
  return out
}

const sha256 = async (data: Uint8Array): Promise<Uint8Array> => {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', data.slice().buffer)
    return new Uint8Array(hash)
  }
  throw new Error('SHA-256 requires Web Crypto (browser production environment)')
}

const hash160 = async (data: Uint8Array): Promise<Uint8Array> => {
  const s = await sha256(data)
  return ripemd160(s)
}

export type BtcNetwork = 'mainnet' | 'testnet'

/** Native segwit P2WPKH from compressed 33-byte pubkey. */
export const p2wpkhAddressFromCompressedPubkey = async (
  compressedPubkey: Uint8Array,
  network: BtcNetwork = 'mainnet'
): Promise<string> => {
  if (compressedPubkey.length !== 33) {
    throw new Error('expected compressed secp256k1 pubkey (33 bytes)')
  }
  const prog = await hash160(compressedPubkey)
  const hrp = network === 'mainnet' ? 'bc' : 'tb'
  const data = convertBits(prog, 8, 5, true)
  if (!data) {
    throw new Error('bech32 convertBits failed')
  }
  return bech32Encode(hrp, [0, ...data])
}

export const bitcoinPaymentUri = (
  address: string,
  opts?: { amountBtc?: string; label?: string; message?: string }
): string => {
  const params = new URLSearchParams()
  if (opts?.amountBtc) {
    params.set('amount', opts.amountBtc)
  }
  if (opts?.label) {
    params.set('label', opts.label)
  }
  if (opts?.message) {
    params.set('message', opts.message)
  }
  const q = params.toString()
  return q ? `bitcoin:${address}?${q}` : `bitcoin:${address}`
}
