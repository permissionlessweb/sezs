/**
 * SEZS Poseidon-128 over Pallas Fp (t=3, α=5, RF=8, RP=56).
 * Must match terp-rs tools/onboard-authz/src/poseidon.rs (and the consume circuit).
 *
 * leaf = Poseidon(ticketSecret, sku, event_id)
 * nullifier = Poseidon(ticketSecret, event_id)
 * Parent = Poseidon(left, right)
 *
 * Round constants: SHA256("sezs-poseidon-pallas-t3-v1" || i_le) reduced into Fp.
 * MDS: Cauchy 1/(i+j+3). from_bytes: 32-byte LE, b[31] &= 0x3f.
 */

/** Compact SHA-256 (sync). Same digest as node crypto / Web Crypto. */
const SHA_K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]
const rotr = (x, n) => (x >>> n) | (x << (32 - n))
const sha256 = (bytes) => {
  const src = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
  const bitLen = src.length * 8
  const padLen = ((src.length + 9 + 63) & ~63)
  const buf = new Uint8Array(padLen)
  buf.set(src)
  buf[src.length] = 0x80
  const view = new DataView(buf.buffer)
  view.setUint32(padLen - 4, bitLen, false)
  // high 32 of length: messages here are tiny, stay 0
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Uint32Array(64)
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + SHA_K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  const out = new Uint8Array(32)
  const ov = new DataView(out.buffer)
  ov.setUint32(0, h0, false); ov.setUint32(4, h1, false)
  ov.setUint32(8, h2, false); ov.setUint32(12, h3, false)
  ov.setUint32(16, h4, false); ov.setUint32(20, h5, false)
  ov.setUint32(24, h6, false); ov.setUint32(28, h7, false)
  return out
}

const P = [0x992d30ed00000001n, 0x224698fc094cf91bn, 0x0000000000000000n, 0x4000000000000000n]
const MASK64 = 0xffffffffffffffffn
const T = 3
const RF = 8
const RP = 56
const ROUNDS = RF + RP
const ZERO = [0n, 0n, 0n, 0n]
const ONE = [1n, 0n, 0n, 0n]

const gte4 = (a, b) => {
  for (let i = 3; i >= 0; i--) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return true
}

const sub4 = (a, b) => {
  let borrow = 0n
  const out = [0n, 0n, 0n, 0n]
  for (let i = 0; i < 4; i++) {
    const v = a[i] - b[i] - borrow
    if (v < 0n) {
      out[i] = v + (1n << 64n)
      borrow = 1n
    } else {
      out[i] = v
      borrow = 0n
    }
  }
  return out
}

const add4raw = (a, b) => {
  let carry = 0n
  const out = [0n, 0n, 0n, 0n]
  for (let i = 0; i < 4; i++) {
    const s = a[i] + b[i] + carry
    out[i] = s & MASK64
    carry = s >> 64n
  }
  return { out, carry }
}

const addFp = (a, b) => {
  const { out, carry } = add4raw(a, b)
  if (carry > 0n || gte4(out, P)) return sub4(out, P)
  return out
}

const subFp = (a, b) => {
  let borrow = 0n
  const out = [0n, 0n, 0n, 0n]
  for (let i = 0; i < 4; i++) {
    const v = a[i] - b[i] - borrow
    if (v < 0n) {
      out[i] = v + (1n << 64n)
      borrow = 1n
    } else {
      out[i] = v
      borrow = 0n
    }
  }
  if (borrow !== 0n) {
    const s = add4raw(out, P)
    return s.out
  }
  return out
}

const gte8 = (a, b) => {
  for (let i = 7; i >= 0; i--) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return true
}

const sub8 = (a, b) => {
  let borrow = 0n
  for (let i = 0; i < 8; i++) {
    const v = a[i] - b[i] - borrow
    if (v < 0n) {
      a[i] = v + (1n << 64n)
      borrow = 1n
    } else {
      a[i] = v
      borrow = 0n
    }
  }
}

const mulWide = (a, b) => {
  const r = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]
  for (let i = 0; i < 4; i++) {
    let carry = 0n
    for (let j = 0; j < 4; j++) {
      const s = r[i + j] + a[i] * b[j] + carry
      r[i + j] = s & MASK64
      carry = s >> 64n
    }
    r[i + 4] = carry
  }
  return r
}

const pShl = (shift) => {
  const out = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]
  const word = Math.floor(shift / 64)
  const bit = shift % 64
  for (let i = 0; i < 4; i++) {
    const v = P[i]
    if (word + i < 8) out[word + i] |= (v << BigInt(bit)) & MASK64
    if (bit > 0 && word + i + 1 < 8) out[word + i + 1] |= v >> BigInt(64 - bit)
  }
  return out
}

let P_SHIFTED = null
const pShifted = () => {
  if (!P_SHIFTED) P_SHIFTED = Array.from({ length: 257 }, (_, s) => pShl(s))
  return P_SHIFTED
}

const remP = (wIn) => {
  const w = wIn.slice()
  const table = pShifted()
  for (let s = 256; s >= 0; s--) {
    if (gte8(w, table[s])) sub8(w, table[s])
  }
  let out = [w[0], w[1], w[2], w[3]]
  if (gte4(out, P)) out = sub4(out, P)
  return out
}

const mulFp = (a, b) => remP(mulWide(a, b))
const squareFp = (a) => mulFp(a, a)
const pow5 = (a) => {
  const s = squareFp(a)
  return mulFp(squareFp(s), a)
}

const invFp = (a) => {
  const e = [0x992d30ecffffffffn, 0x224698fc094cf91bn, 0x0000000000000000n, 0x4000000000000000n]
  let base = a
  let acc = ONE
  for (const limb of e) {
    let x = limb
    for (let i = 0; i < 64; i++) {
      if (x & 1n) acc = mulFp(acc, base)
      base = squareFp(base)
      x >>= 1n
    }
  }
  return acc
}

export const fromBytes = (bytes) => {
  const b = new Uint8Array(32)
  const src = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
  b.set(src.subarray(0, Math.min(32, src.length)))
  b[31] &= 0x3f
  const limb = (off) => {
    let v = 0n
    for (let i = 0; i < 8; i++) v |= BigInt(b[off + i]) << BigInt(8 * i)
    return v
  }
  return [limb(0), limb(8), limb(16), limb(24)]
}

export const fromStrBytes = (s) => fromBytes(new TextEncoder().encode(s))

export const fromU64 = (x) => [BigInt(x), 0n, 0n, 0n]

export const toBytes = (fp) => {
  const b = new Uint8Array(32)
  for (let i = 0; i < 4; i++) {
    let v = fp[i]
    for (let j = 0; j < 8; j++) {
      b[i * 8 + j] = Number(v & 0xffn)
      v >>= 8n
    }
  }
  return b
}

export const toHex = (bytes) =>
  Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('')

export const fromHex = (s) => {
  const t = s.trim().replace(/^0x/i, '')
  if (t.length % 2) throw new Error('odd_hex')
  const out = new Uint8Array(t.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16)
  return out
}

let RC = null
let MDS = null

const roundConstants = () => {
  if (RC) return RC
  const prefix = new TextEncoder().encode('sezs-poseidon-pallas-t3-v1')
  RC = []
  let i = 0
  while (RC.length < ROUNDS * T) {
    const le = new Uint8Array(4)
    le[0] = i & 0xff
    le[1] = (i >> 8) & 0xff
    le[2] = (i >> 16) & 0xff
    le[3] = (i >> 24) & 0xff
    const buf = new Uint8Array(prefix.length + 4)
    buf.set(prefix)
    buf.set(le, prefix.length)
    RC.push(fromBytes(sha256(buf)))
    i += 1
  }
  return RC
}

const mds = () => {
  if (MDS) return MDS
  MDS = Array.from({ length: T }, () => Array.from({ length: T }, () => ZERO))
  for (let i = 0; i < T; i++) {
    for (let j = 0; j < T; j++) MDS[i][j] = invFp(fromU64(i + j + 3))
  }
  return MDS
}

const mix = (state) => {
  const m = mds()
  const out = [ZERO, ZERO, ZERO]
  for (let i = 0; i < T; i++) {
    let acc = ZERO
    for (let j = 0; j < T; j++) acc = addFp(acc, mulFp(m[i][j], state[j]))
    out[i] = acc
  }
  state[0] = out[0]
  state[1] = out[1]
  state[2] = out[2]
}

const permute = (state) => {
  const rc = roundConstants()
  let k = 0
  const half = RF / 2
  for (let r = 0; r < half; r++) {
    for (let s = 0; s < T; s++) state[s] = addFp(state[s], rc[k++])
    for (let s = 0; s < T; s++) state[s] = pow5(state[s])
    mix(state)
  }
  for (let r = 0; r < RP; r++) {
    for (let s = 0; s < T; s++) state[s] = addFp(state[s], rc[k++])
    state[0] = pow5(state[0])
    mix(state)
  }
  for (let r = 0; r < half; r++) {
    for (let s = 0; s < T; s++) state[s] = addFp(state[s], rc[k++])
    for (let s = 0; s < T; s++) state[s] = pow5(state[s])
    mix(state)
  }
}

export const poseidonHash = (inputs) => {
  const state = [ZERO, ZERO, ZERO]
  state[0] = fromU64(inputs.length)
  if (inputs.length === 0) {
    permute(state)
    return state[1]
  }
  let i = 0
  while (i < inputs.length) {
    let r = 1
    while (r < T && i < inputs.length) {
      state[r] = addFp(state[r], inputs[i])
      i += 1
      r += 1
    }
    permute(state)
  }
  return state[1]
}

export const poseidon2 = (a, b) => poseidonHash([a, b])
export const poseidon3 = (a, b, c) => poseidonHash([a, b, c])

export const ticketLeaf = (secret, sku, eventId) =>
  toBytes(poseidon3(fromBytes(secret), fromStrBytes(sku), fromStrBytes(eventId)))

export const doorNullifier = (secret, eventId) =>
  toBytes(poseidon2(fromBytes(secret), fromStrBytes(eventId)))

export const TREE_DEPTH = 8

export const emptyAt = (depth) => {
  const empty = [ZERO]
  for (let d = 0; d < depth; d++) empty.push(poseidon2(empty[d], empty[d]))
  return empty
}

export const makeTree = (depth = TREE_DEPTH) => {
  const empty = emptyAt(depth)
  const nodes = new Map()
  const key = (level, index) => `${level}:${index}`
  const node = (level, index) => nodes.get(key(level, index)) || empty[level]
  const tree = {
    depth,
    next: 0,
    root() {
      return node(depth, 0)
    },
    rootBytes() {
      return toBytes(this.root())
    },
    len() {
      return this.next
    },
    append(leafBytes) {
      const max = 1 << depth
      if (this.next >= max) throw new Error('tree_full')
      const leaf = Array.isArray(leafBytes) ? leafBytes : fromBytes(leafBytes)
      const idx = this.next
      this.next += 1
      nodes.set(key(0, idx), leaf)
      let i = idx
      let cur = leaf
      for (let level = 0; level < depth; level++) {
        const sib = node(level, i ^ 1)
        const [l, r] = i % 2 === 0 ? [cur, sib] : [sib, cur]
        cur = poseidon2(l, r)
        i = Math.floor(i / 2)
        nodes.set(key(level + 1, i), cur)
      }
      return idx
    },
  }
  return tree
}

export { sha256 as sha256ForTest }
