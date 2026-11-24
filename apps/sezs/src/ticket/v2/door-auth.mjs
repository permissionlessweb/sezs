/**
 * Decode the on-chain HexBinary door_auth_pubkey into the UTF-8 string
 * that wasm signPrinted / printedMessage pass to .as_bytes().
 *
 * The contract (door_auth_of) stores exactly 32 bytes. Those bytes must
 * be valid UTF-8 so they survive the wasm string ABI; the lab default is
 * 32 ASCII bytes. Do not latin-1-widen raw digest bytes — bytes above
 * 127 would UTF-8-expand and fail on-chain printed consent.
 */
export function doorAuthPubkeyString(hex) {
  const h = String(hex || '').trim().replace(/^0x/i, '')
  if (!h) return ''
  if (!/^[0-9a-fA-F]+$/.test(h) || h.length % 2) {
    throw new Error('door_auth_pubkey is not hex')
  }
  const bytes = Uint8Array.from({ length: h.length / 2 }, (_, i) =>
    parseInt(h.slice(i * 2, i * 2 + 2), 16),
  )
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
