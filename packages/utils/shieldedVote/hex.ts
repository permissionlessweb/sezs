/**
 * Lowercase hex helpers for ea_pk / ciphertext wire fields.
 */

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0')
  }
  return out
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  if (h.length % 2 !== 0) {
    throw new Error(`odd hex length: ${h.length}`)
  }
  if (!/^[0-9a-fA-F]*$/.test(h)) {
    throw new Error('invalid hex characters')
  }
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function isHexString(value: string, expectedBytes?: number): boolean {
  const h =
    value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
  if (!/^[0-9a-fA-F]*$/.test(h) || h.length % 2 !== 0) {
    return false
  }
  if (expectedBytes !== undefined && h.length !== expectedBytes * 2) {
    return false
  }
  return true
}
