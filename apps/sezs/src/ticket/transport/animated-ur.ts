/**
 * Live phone-to-usher transport: animated QR using UR-shaped part strings.
 *
 * Production will call Zafu `ur_encode_frames` / animated-qr-display for a
 * BC-UR fountain (`ur:sezs-ticket-v2`). This lab encoder uses the same part
 * syntax (`ur:sezs-ticket-v2/<i>-<n>/<hex>`) over equal slices so the UI and
 * the collect path can be wired end-to-end before the wasm lands.
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

const HRP = 'ur:sezs-ticket-v2'
const FRAME = 400

const split = (bytes: Uint8Array): string[] => {
  const n = Math.max(1, Math.ceil(bytes.length / FRAME))
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const slice = bytes.slice(i * FRAME, (i + 1) * FRAME)
    parts.push(`${HRP}/${i + 1}-${n}/${hex(slice)}`)
  }
  return parts
}

export const animatedUrTransport: ProofTransport = {
  id: 'animated-ur',
  label: 'Animated QR (BC-UR)',
  implemented: true,
  async present(bundle: ProofBundle): Promise<PresentHandle> {
    const payloads = split(encodeBundle(bundle))
    return {
      mode: 'animate',
      note: 'Hold this moving code to the usher scanner. Production uses Zafu BC-UR fountain frames.',
      frames: payloads.map((payload, i) => ({
        index: i + 1,
        total: payloads.length,
        payload,
      })),
    }
  },
  async collect(frames: TransportFrame[]): Promise<ProofBundle> {
    if (!frames.length) throw new Error('no frames')
    const parsed = frames.map((f) => {
      const m = /^ur:sezs-ticket-v2\/(\d+)-(\d+)\/([0-9a-f]+)$/i.exec(f.payload.trim())
      if (!m) throw new Error('not an sezs-ticket-v2 UR frame')
      return { i: Number(m[1]), n: Number(m[2]), bytes: unhex(m[3]) }
    })
    const n = parsed[0].n
    const slots: (Uint8Array | undefined)[] = Array(n)
    for (const p of parsed) slots[p.i - 1] = p.bytes
    if (slots.some((s) => !s)) throw new Error('missing UR frames')
    const total = slots.reduce((a, s) => a + (s as Uint8Array).length, 0)
    const out = new Uint8Array(total)
    let o = 0
    for (const s of slots) {
      out.set(s as Uint8Array, o)
      o += (s as Uint8Array).length
    }
    return decodeBundle(out)
  },
}
