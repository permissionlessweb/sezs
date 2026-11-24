import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const hashesDir = join(dirname(fileURLToPath(import.meta.url)), 'node_modules/@noble/hashes')
const { blake2b } = await import(pathToFileURL(join(hashesDir, 'blake2.js')).href)

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const BECH32M_CONST = 0x2bc830a3
const OUTBYTES = 64

function bech32mPolymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const b = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i]
  }
  return chk
}
function bech32mHrpExpand(hrp) {
  const ret = []
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >>> 5)
  ret.push(0)
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31)
  return ret
}
function bech32mCreateChecksum(hrp, data) {
  const values = bech32mHrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0])
  const polymod = bech32mPolymod(values) ^ BECH32M_CONST
  const ret = []
  for (let i = 0; i < 6; i++) ret.push((polymod >>> (5 * (5 - i))) & 31)
  return ret
}
function convertBits(data, fromBits, toBits, pad) {
  let acc = 0, bits = 0
  const maxv = (1 << toBits) - 1
  const result = []
  for (const byte of data) {
    acc = (acc << fromBits) | byte
    bits += fromBits
    while (bits >= toBits) {
      bits -= toBits
      result.push((acc >>> bits) & maxv)
    }
  }
  if (pad && bits > 0) result.push((acc << (toBits - bits)) & maxv)
  return result
}
function bech32mEncode(hrp, data) {
  const words = convertBits(data, 8, 5, true)
  const checksum = bech32mCreateChecksum(hrp, words)
  let result = hrp + '1'
  for (const w of words.concat(checksum)) result += CHARSET[w]
  return result
}
const hPers = (round) => {
  const p = new Uint8Array(16)
  const tag = 'UA_F4Jumble_H'
  for (let i = 0; i < tag.length; i++) p[i] = tag.charCodeAt(i)
  p[13] = round
  return p
}
const gPers = (round, chunkJ) => {
  const p = new Uint8Array(16)
  const tag = 'UA_F4Jumble_G'
  for (let i = 0; i < tag.length; i++) p[i] = tag.charCodeAt(i)
  p[13] = round
  p[14] = chunkJ & 0xff
  p[15] = (chunkJ >>> 8) & 0xff
  return p
}
function hRound(round, input, outputLen) {
  return blake2b(input, { dkLen: outputLen, personalization: hPers(round) })
}
function gRound(round, input, outputLen) {
  const result = new Uint8Array(outputLen)
  let offset = 0, j = 0
  while (offset < outputLen) {
    const chunk = blake2b(input, { dkLen: OUTBYTES, personalization: gPers(round, j) })
    const take = Math.min(OUTBYTES, outputLen - offset)
    result.set(chunk.subarray(0, take), offset)
    offset += take
    j++
  }
  return result
}
function xorInPlace(a, b) {
  for (let i = 0; i < a.length; i++) a[i] ^= b[i]
}
function f4Jumble(M) {
  const l = M.length
  const lL = Math.min(Math.floor(l / 2), OUTBYTES)
  const lR = l - lL
  const left = M.slice(0, lL)
  const right = M.slice(lL)
  xorInPlace(right, gRound(0, left, lR))
  xorInPlace(left, hRound(0, right, lL))
  xorInPlace(right, gRound(1, left, lR))
  xorInPlace(left, hRound(1, right, lL))
  const result = new Uint8Array(l)
  result.set(left, 0)
  result.set(right, lL)
  return result
}

export function encodeOrchardUnifiedAddress(rawBytes, hrp = 'utest') {
  if (rawBytes.length !== 43) throw new Error('orchard receiver must be 43 bytes')
  const body = [0x03, rawBytes.length, ...rawBytes]
  const container = new Uint8Array(body.length + 16)
  container.set(body, 0)
  for (let i = 0; i < hrp.length; i++) container[body.length + i] = hrp.charCodeAt(i)
  return bech32mEncode(hrp, f4Jumble(container))
}

export function rawFromDebugOrHex(s) {
  if (!s) return null
  const debug = /^(?:u|utest|uregtest)1orchard:/i
  if (debug.test(s)) return Uint8Array.from(Buffer.from(s.split(':')[1], 'hex'))
  if (/^[0-9a-f]{86}$/i.test(s)) return Uint8Array.from(Buffer.from(s, 'hex'))
  return null
}

function bech32mDecode(addr) {
  const raw = String(addr || '').trim()
  const pos = raw.lastIndexOf('1')
  if (pos < 1) return null
  const hrp = raw.slice(0, pos)
  const body = raw.slice(pos + 1)
  const data = []
  for (const c of body) {
    const i = CHARSET.indexOf(c)
    if (i < 0) return null
    data.push(i)
  }
  if (data.length < 7) return null
  if (bech32mPolymod(bech32mHrpExpand(hrp).concat(data)) !== BECH32M_CONST) return null
  const bytes = convertBits(data.slice(0, -6), 5, 8, false)
  if (!bytes) return null
  return { hrp, bytes: Uint8Array.from(bytes) }
}

function convertBitsStrict(data, fromBits, toBits, pad) {
  let acc = 0, bits = 0
  const maxv = (1 << toBits) - 1
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1
  const result = []
  for (const value of data) {
    if (value < 0 || value >> fromBits) return null
    acc = ((acc << fromBits) | value) & maxAcc
    bits += fromBits
    while (bits >= toBits) {
      bits -= toBits
      result.push((acc >> bits) & maxv)
    }
  }
  if (pad) {
    if (bits) result.push((acc << (toBits - bits)) & maxv)
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    return null
  }
  return result
}

function f4Unjumble(M) {
  const l = M.length
  const lL = Math.min(Math.floor(l / 2), OUTBYTES)
  const lR = l - lL
  const left = M.slice(0, lL)
  const right = M.slice(lL)
  xorInPlace(left, hRound(1, right, lL))
  xorInPlace(right, gRound(1, left, lR))
  xorInPlace(left, hRound(0, right, lL))
  xorInPlace(right, gRound(0, left, lR))
  const result = new Uint8Array(l)
  result.set(left, 0)
  result.set(right, lL)
  return result
}

/** Decode an orchard-only (or leading orchard) unified address. */
export function decodeOrchardUnifiedAddress(addr) {
  const dec = bech32mDecode(addr)
  if (!dec) return null
  const padded = convertBits(dec.bytes, 8, 8, false) // already bytes
  const unjumbled = f4Unjumble(dec.bytes)
  // container is receivers || HRP padded to 16 bytes
  if (unjumbled.length < 2 + 43) return null
  let i = 0
  while (i + 2 <= unjumbled.length) {
    const type = unjumbled[i]
    const len = unjumbled[i + 1]
    // trailing HRP padding starts when remaining looks like ascii hrp + zeros
    if (type === 0 && i > 0) break
    if (i + 2 + len > unjumbled.length) break
    const payload = unjumbled.slice(i + 2, i + 2 + len)
    if ((type === 0x03 || type === 0x06) && len === 43) {
      return { hrp: dec.hrp, raw: payload, type }
    }
    i += 2 + len
    if (i >= unjumbled.length - 16) break
  }
  return null
}

/** Re-encode a UA so zafu wasm (u / utest only) can decode the same receiver. */
export function uaForWasm(addr) {
  const s = String(addr || '').trim()
  if (!s) return null
  const raw = rawFromDebugOrHex(s) || decodeOrchardUnifiedAddress(s)?.raw
  if (!raw) return s.startsWith('utest1') || s.startsWith('u1') ? s : null
  return encodeOrchardUnifiedAddress(raw, 'utest')
}
