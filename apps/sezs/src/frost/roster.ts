/** Match terp_onboard_authz::sezs_frost::roster_commit (SHA-256, BE ints). */

const ROSTER_DOMAIN = new TextEncoder().encode('sezs-frost-roster-v1')
export const SPEND_MEMO_PREFIX = 'sezs-frost-memo-v1:'

const hexOf = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

const be32 = (n: number) => {
  const u = new DataView(new ArrayBuffer(4))
  u.setUint32(0, n >>> 0, false)
  return new Uint8Array(u.buffer)
}

const be16 = (n: number) => {
  const u = new DataView(new ArrayBuffer(2))
  u.setUint16(0, n & 0xffff, false)
  return new Uint8Array(u.buffer)
}

export async function rosterCommit(args: {
  epoch: number
  t: number
  n: number
  groupVk: string
  seats: string[]
}): Promise<string> {
  const seats = [...args.seats.map((s) => s.trim()).filter(Boolean)].sort()
  const parts: Uint8Array[] = [
    ROSTER_DOMAIN,
    be32(args.epoch),
    be16(args.t),
    be16(args.n),
    new TextEncoder().encode(args.groupVk),
    new Uint8Array([0]),
  ]
  for (const s of seats) {
    parts.push(new TextEncoder().encode(s), new Uint8Array([0]))
  }
  const len = parts.reduce((n, p) => n + p.length, 0)
  const buf = new Uint8Array(len)
  let o = 0
  for (const p of parts) {
    buf.set(p, o)
    o += p.length
  }
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return hexOf(new Uint8Array(digest))
}

export const spendMemo = (commitHex: string) =>
  `${SPEND_MEMO_PREFIX}${commitHex}`

/** Node-confirmed 32-byte hex. Aligns with require_node_txid. */
export function requireNodeTxid(txid: string): string | null {
  const t = txid.trim()
  const lower = t.toLowerCase()
  if (!t) return 'no_txid'
  if (lower.startsWith('txid') || lower.includes('fixture') || lower.includes('dummy')) {
    return 'fixture_txid'
  }
  const h = lower.startsWith('0x') ? lower.slice(2) : lower
  if (h.length !== 64) return 'txid_len'
  if (![...h].every((c) => '0123456789abcdef'.includes(c))) return 'txid_hex'
  if (h === 'a'.repeat(64) || h === '0'.repeat(64)) return 'fixture_txid'
  return null
}
