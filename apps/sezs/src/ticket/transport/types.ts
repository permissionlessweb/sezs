/** Modular check-in transport: how proof bytes move from holder to usher. */

export type ConsentKind = 'live' | 'printed'

export type ProofBundle = {
  v: 2
  proof: Uint8Array
  root: Uint8Array
  nullifier: Uint8Array
  eventId: Uint8Array
  domain: Uint8Array
  rkX: Uint8Array
  rkY: Uint8Array
  consent: { kind: ConsentKind; payload: Uint8Array }
}

export type TransportFrame = {
  index: number
  total: number
  /** Bech32-like or UR text shown in a QR. */
  payload: string
}

export type PresentHandle = {
  frames: TransportFrame[]
  note: string
  /** Hint for UI: animate through frames, or print a static grid. */
  mode: 'animate' | 'grid' | 'nfc'
}

export interface ProofTransport {
  id: 'animated-ur' | 'printed-raptorq' | 'nfc'
  label: string
  implemented: boolean
  present(bundle: ProofBundle): Promise<PresentHandle>
  collect(frames: TransportFrame[]): Promise<ProofBundle>
}

export class TransportNotImplemented extends Error {
  constructor(id: string) {
    super(`${id} is not implemented yet`)
    this.name = 'TransportNotImplemented'
  }
}

const u8 = (n: number) => new Uint8Array([n])

export const encodeBundle = (b: ProofBundle): Uint8Array => {
  const parts = [
    u8(b.v),
    b.proof,
    b.root,
    b.nullifier,
    b.eventId,
    b.domain,
    b.rkX,
    b.rkY,
    u8(b.consent.kind === 'live' ? 1 : 2),
    b.consent.payload,
  ]
  // length-prefixed sections so collect can reassemble unambiguously
  const out: number[] = []
  for (const p of parts) {
    const len = p.length
    out.push((len >> 8) & 0xff, len & 0xff)
    out.push(...p)
  }
  return Uint8Array.from(out)
}

export const decodeBundle = (bytes: Uint8Array): ProofBundle => {
  const parts: Uint8Array[] = []
  let i = 0
  while (i + 2 <= bytes.length) {
    const len = (bytes[i] << 8) | bytes[i + 1]
    i += 2
    if (i + len > bytes.length) throw new Error('truncated proof bundle')
    parts.push(bytes.slice(i, i + len))
    i += len
  }
  if (parts.length < 10) throw new Error('short proof bundle')
  const v = parts[0][0] || 2
  return {
    v: v as 2,
    proof: parts[1],
    root: parts[2],
    nullifier: parts[3],
    eventId: parts[4],
    domain: parts[5],
    rkX: parts[6],
    rkY: parts[7],
    consent: {
      kind: parts[8][0] === 1 ? 'live' : 'printed',
      payload: parts[9],
    },
  }
}

export const hex = (u: Uint8Array) =>
  Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join('')

export const unhex = (s: string) => {
  const t = s.replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '')
  if (t.length % 2) throw new Error('odd hex')
  const out = new Uint8Array(t.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16)
  return out
}
