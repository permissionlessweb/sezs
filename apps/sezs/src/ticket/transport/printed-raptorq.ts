/**
 * Printed fallback: a grid of 5–9 static QR codes, Zigner-shaped.
 *
 * Zigner uses RaptorQ with CHUNK_SIZE
 * 1072, 5 source + 4 repair, any 5 packets sufficient. This lab framer
 * matches that layout (5 source slices + 4 XOR repair packets) so the print
 * grid and the collect path can be wired now. A holder who scans all 5
 * source packets always recovers. XOR repair recovers some loss patterns.
 * Production should swap in `raptorq` 1.8.1 `make_data_packs`.
 */
import {
  decodeBundle,
  encodeBundle,
  hex,
  ProofBundle,
  ProofTransport,
  PresentHandle,
  TransportFrame,
  unhex,
} from './types'

export const SOURCE = 5
export const REPAIR = 4
export const GRID = SOURCE + REPAIR
export const CHUNK = 1072
const HRP = 'sezs2rq'

const xor = (a: Uint8Array, b: Uint8Array) => {
  const n = Math.max(a.length, b.length)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = (a[i] || 0) ^ (b[i] || 0)
  return out
}

const padChunks = (bytes: Uint8Array): Uint8Array[] => {
  const raw = new Uint8Array(4 + bytes.length)
  raw[0] = (bytes.length >> 24) & 0xff
  raw[1] = (bytes.length >> 16) & 0xff
  raw[2] = (bytes.length >> 8) & 0xff
  raw[3] = bytes.length & 0xff
  raw.set(bytes, 4)
  const chunks: Uint8Array[] = []
  for (let i = 0; i < SOURCE; i++) {
    const c = new Uint8Array(CHUNK)
    const start = i * CHUNK
    c.set(raw.slice(start, start + CHUNK))
    chunks.push(c)
  }
  if (raw.length > SOURCE * CHUNK) {
    throw new Error('proof is larger than the printed 5-chunk budget')
  }
  return chunks
}

const repairsOf = (src: Uint8Array[]): Uint8Array[] => [
  src.reduce((a, c) => xor(a, c)),
  xor(src[0], xor(src[2], src[4])),
  xor(src[1], xor(src[2], src[3])),
  xor(src[0], xor(src[1], src[4])),
]

export const printedRaptorqTransport: ProofTransport = {
  id: 'printed-raptorq',
  label: 'Printed grid (5–9 codes)',
  implemented: true,
  async present(bundle: ProofBundle): Promise<PresentHandle> {
    const src = padChunks(encodeBundle(bundle))
    const repair = repairsOf(src)
    const packets = [...src, ...repair]
    return {
      mode: 'grid',
      note: 'Print this grid and bring it to the door. Any complete set of the five source codes is enough. Repair codes cover some loss. Production uses Zigner RaptorQ.',
      frames: packets.map((bytes, i) => ({
        index: i + 1,
        total: GRID,
        payload: `${HRP}/${i + 1}-${GRID}/${hex(bytes)}`,
      })),
    }
  },
  async collect(frames: TransportFrame[]): Promise<ProofBundle> {
    const slots: (Uint8Array | undefined)[] = Array(GRID)
    for (const f of frames) {
      const m = /^sezs2rq\/(\d+)-(\d+)\/([0-9a-f]+)$/i.exec(f.payload.trim())
      if (!m) throw new Error('not a printed sezs2rq frame')
      slots[Number(m[1]) - 1] = unhex(m[3])
    }
    const src = slots.slice(0, SOURCE)
    if (src.every(Boolean)) {
      return unpack(src as Uint8Array[])
    }
    // best-effort XOR recovery when all-xor repair (index 5) and 4 of 5 source exist
    const allXor = slots[SOURCE]
    const missing = src.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0)
    if (allXor && missing.length === 1) {
      const i = missing[0]
      let acc = allXor
      src.forEach((c, j) => {
        if (j !== i && c) acc = xor(acc, c)
      })
      src[i] = acc
      return unpack(src as Uint8Array[])
    }
    throw new Error('not enough printed codes to recover the proof')
  },
}

const unpack = (src: Uint8Array[]): ProofBundle => {
  const joined = new Uint8Array(SOURCE * CHUNK)
  src.forEach((c, i) => joined.set(c, i * CHUNK))
  const len = (joined[0] << 24) | (joined[1] << 16) | (joined[2] << 8) | joined[3]
  return decodeBundle(joined.slice(4, 4 + len))
}
