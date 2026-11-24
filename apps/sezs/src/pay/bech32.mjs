/**
 * Bech32 / bech32m checksum helpers (BIP-173 / BIP-350).
 * Used to validate Penumbra UM addresses (penumbra1…).
 */
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
/** BIP-173 / BIP-350 generators. */
const GEN_BIP = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2e880328]
/**
 * pcli 2.0.8 (and some Bech32m implementations) use this last generator
 * (`0x2a1462b3`) rather than BIP-173's `0x2e880328`. Official Penumbra
 * addresses only verify with this set.
 */
const GEN_PCLI = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

const polymod = (values, gen = GEN_BIP) => {
  let chk = 1
  for (const v of values) {
    // Unsigned shift: JS bitwise ops are signed int32, and a signed >> 25
    // corrupts the checksum for long Bech32m strings (Penumbra addresses).
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= gen[i]
  }
  return chk >>> 0
}

const hrpExpand = (hrp) => {
  const out = []
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5)
  out.push(0)
  for (const c of hrp) out.push(c.charCodeAt(0) & 31)
  return out
}

const verify = (hrp, data, const_) => {
  const values = hrpExpand(hrp).concat(data)
  return polymod(values, GEN_BIP) === const_ || polymod(values, GEN_PCLI) === const_
}

export const BECH32 = 1
export const BECH32M = 0x2bc830a3

export const decodeBech32 = (s) => {
  const raw = String(s || '').trim()
  if (raw.length < 8 || raw.length > 256) return null
  if (raw !== raw.toLowerCase() && raw !== raw.toUpperCase()) return null
  const str = raw.toLowerCase()
  const pos = str.lastIndexOf('1')
  if (pos < 1 || pos + 7 > str.length) return null
  const hrp = str.slice(0, pos)
  const body = str.slice(pos + 1)
  const data = []
  for (const c of body) {
    const i = CHARSET.indexOf(c)
    if (i < 0) return null
    data.push(i)
  }
  const bech32 = verify(hrp, data, BECH32)
  const bech32m = verify(hrp, data, BECH32M)
  if (!bech32 && !bech32m) return null
  return { hrp, data: data.slice(0, -6), encoding: bech32m ? 'bech32m' : 'bech32' }
}

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

export const encodeBech32 = (hrp, bytes, encoding = 'bech32') => {
  const const_ = encoding === 'bech32m' ? BECH32M : BECH32
  const data = convertBits([...bytes], 8, 5, true)
  if (!data) throw new Error('convert_bits')
  const values = hrpExpand(hrp).concat(data)
  const mod = polymod(values.concat([0, 0, 0, 0, 0, 0])) ^ const_
  const checksum = [0, 0, 0, 0, 0, 0].map((_, i) => (mod >> (5 * (5 - i))) & 31)
  return hrp + '1' + [...data, ...checksum].map((d) => CHARSET[d]).join('')
}

/** UM / Penumbra address. Local chains use the same penumbra1 HRP as production. */
export const UM_HRPS = Object.freeze(['penumbra', 'penumbratest', 'plmt', 'penumbrat'])

export const looksUmBech32 = (s) => {
  const d = decodeBech32(s)
  if (!d) return false
  return UM_HRPS.includes(d.hrp)
}

/** Shielded or unified ZEC (no transparent t-addresses). */
export const looksShieldedZec = (s) => {
  const v = String(s || '').trim()
  if (v.length < 20 || v.length > 256) return false
  if (/^t[1-9a-z]/i.test(v) && !/^tex1/i.test(v)) return false
  return /^(u|uregtest|utest|zs|zregtestsapling|u1)[a-z0-9]+$/i.test(v) || /^(u1|uregtest1|utest1|zs1)/i.test(v)
}

export const parseAddressQr = (text) => {
  const raw = String(text || '').trim()
  if (!raw) return { ok: false, error: 'empty' }
  if (/^zcash:/i.test(raw)) {
    const value = raw.replace(/^zcash:/i, '').split('?')[0].trim()
    if (looksShieldedZec(value)) return { ok: true, kind: 'zec', address: value }
    return { ok: false, error: 'unrecognised_address' }
  }
  if (/^penumbra:/i.test(raw)) {
    const value = raw.replace(/^penumbra:/i, '').split('?')[0].trim()
    if (looksUmBech32(value)) return { ok: true, kind: 'um', address: value }
    return { ok: false, error: 'unrecognised_address' }
  }
  if (looksUmBech32(raw)) return { ok: true, kind: 'um', address: raw }
  if (looksShieldedZec(raw)) return { ok: true, kind: 'zec', address: raw }
  return { ok: false, error: 'unrecognised_address' }
}
