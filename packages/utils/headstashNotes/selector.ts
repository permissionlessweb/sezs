/**
 * One-hot PIR selector + pad strip — pure TS, no network.
 * Server does XOR; client only builds selector and strips NUL pad.
 */

/**
 * Build one-hot selector over sorted keys for `addr`.
 * Throws if addr not found.
 */
export function buildOneHotSelector(
  sortedKeys: readonly string[],
  addr: string
): number[] {
  const idx = sortedKeys.indexOf(addr)
  if (idx < 0) {
    throw new Error(`addr not in keys: ${addr}`)
  }
  return sortedKeys.map((_, i) => (i === idx ? 1 : 0))
}

/**
 * Sort keys lexicographically (must match hash-market list_note_keys).
 */
export function sortNoteKeys(keys: readonly string[]): string[] {
  return [...keys].sort()
}

/**
 * Strip trailing NUL (0x00) pad from equal-length PIR blobs.
 * Mirrors seam_note_out::pir_get_note_envelope.
 */
export function stripTrailingNulPad(blob: Uint8Array): Uint8Array {
  let end = blob.length
  while (end > 0 && blob[end - 1] === 0) {
    end--
  }
  return blob.subarray(0, end)
}

/**
 * Validate selector is one-hot of length `n` (exactly one 1, rest 0).
 */
export function isValidOneHot(selector: readonly number[], n: number): boolean {
  if (selector.length !== n) return false
  let ones = 0
  for (const s of selector) {
    if (s !== 0 && s !== 1) return false
    if (s === 1) ones++
  }
  return ones === 1
}
