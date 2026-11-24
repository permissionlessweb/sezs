/** Hex helpers (lowercase) for notes envelope + PIR blobs. */

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0')
  }
  return out
}

export function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  if (s.length % 2 !== 0) {
    throw new Error(`odd-length hex (${s.length})`)
  }
  if (!/^[0-9a-fA-F]*$/.test(s)) {
    throw new Error('non-hex characters')
  }
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function isHex(s: string): boolean {
  const h = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s
  return h.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(h)
}
