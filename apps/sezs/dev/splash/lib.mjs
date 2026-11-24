import { scrubLog } from './guards.mjs'
import { ensureEnvelopes } from './envelopes.mjs'
import { ensureUsherGroup } from './usher-group.mjs'
/**
 * Splash board core: DEV ONLY. Pure state logic plus test-key helpers.
 * Everything here is a local mock: no chain, no funds, no real credentials.
 * Private keys live only in .splash/keys/<id>.json (0600, gitignored) and are
 * never part of the public state, the API, or the event log.
 */
import { createECDH, createHash, randomBytes } from 'node:crypto'
import * as Pay from './ticket-pay.mjs'

// ── bech32 (BIP-173) ─────────────────────────────────────────────
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
const polymod = (values) => {
  let chk = 1
  for (const v of values) {
    const b = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i]
  }
  return chk
}
const hrpExpand = (hrp) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)]
const toWords = (bytes) => {
  let acc = 0, bits = 0
  const out = []
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out.push((acc >> bits) & 31)
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31)
  return out
}
export const bech32 = (hrp, bytes) => {
  const data = toWords(bytes)
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1
  const chk = Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31)
  return hrp + '1' + [...data, ...chk].map((d) => CHARSET[d]).join('')
}

/** Cosmos address: bech32(hrp, ripemd160(sha256(compressed pubkey))). */
export const addressOf = (pub, hrp = 'terp') =>
  bech32(hrp, createHash('ripemd160').update(createHash('sha256').update(pub).digest()).digest())

/** Fresh TEST secp256k1 key. Returns the secret separately so callers can't leak it by spreading. */
export const newTestKey = () => {
  const ecdh = createECDH('secp256k1')
  ecdh.generateKeys()
  const pub = ecdh.getPublicKey(null, 'compressed')
  return { secretHex: ecdh.getPrivateKey('hex'), pubHex: pub.toString('hex'), address: addressOf(pub) }
}

/** Re-derive public facts from a stored TEST key. */
export const publicOf = (secretHex) => {
  const ecdh = createECDH('secp256k1')
  ecdh.setPrivateKey(Buffer.from(secretHex, 'hex'))
  const pub = ecdh.getPublicKey(null, 'compressed')
  return { pubHex: pub.toString('hex'), address: addressOf(pub) }
}

export const tag = (n = 4) => randomBytes(n).toString('hex')

// ── state ────────────────────────────────────────────────────────
export const KINDS = ['keplr', 'zafu', 'ephemeral']
export const ROLES = ['admin', 'coordinator', 'usher', 'guest']
export const RAILS = ['zec', 'eth', 'base', 'penumbra']
export const SEAT = /^[a-z][a-z0-9-]{0,31}$/

export const emptyState = () => ({
  v: 1,
  scenario: null,
  event: { name: 'Splash test event', capacity: 40, test: true },
  identities: [],
  tickets: [],
  invoices: [],
  leaves: [],
  spent: {},
  envelopes: [],
  usherGroup: { members: [], room: null, rooms: [] },
  usherMessages: [],
  guestRoot: null,
  qr: 'auto',
  dregg: { zec: 'idle', funded: false },
  log: [],
  checklist: null,
})

/** Append to the event log. Messages are built from ids and public facts only. */
export const log = (s, kind, msg) => {
  s.log.push({ t: Date.now(), kind, msg: scrubLog(String(msg)).slice(0, 240) })
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400)
  return s
}

export const allowlistOf = (s) => ({
  note: 'TEST ONLY. Dev splash board allowlist. Not read by any production service.',
  updatedAt: Date.now(),
  admins: s.identities.filter((i) => i.role === 'admin').map(({ id, address, credId }) => ({ id, address, credId })),
  coordinators: s.identities.filter((i) => i.role === 'coordinator').map(({ id, address, credId }) => ({ id, address, credId })),
  ushers: s.identities.filter((i) => i.role === 'usher').map(({ id, address, credId }) => ({ id, address, credId })),
})

export const roleOf = (s, id) => {
  const al = allowlistOf(s)
  if (al.admins.some((a) => a.id === id)) return 'admin'
  if (al.coordinators.some((c) => c.id === id)) return 'coordinator'
  if (al.ushers.some((u) => u.id === id)) return 'usher'
  return s.identities.some((i) => i.id === id) ? 'guest' : null
}

export const issueTicket = (s, holder, { rail = 'zec', status = 'paid', now = Date.now() } = {}) => {
  const who = s.identities.find((i) => i.id === holder)
  if (!who) return { ok: false, error: 'unknown_identity' }
  if (!RAILS.includes(rail)) return { ok: false, error: 'bad_rail' }
  const live = s.tickets.filter((t) => t.status !== 'void').length
  if (live >= s.event.capacity) {
    log(s, 'refuse', `issue to ${holder} refused: sold out (${live}/${s.event.capacity})`)
    return { ok: false, error: 'sold_out' }
  }
  const t = {
    id: `tkt-test-${tag(3)}`,
    holder,
    rail,
    status: status === 'pending' ? 'pending' : 'paid',
    issuedAt: now,
    paidAt: status === 'pending' ? null : now,
    usedAt: null,
    usedBy: null,
    attempts: 0,
  }
  s.tickets.push(t)
  log(s, 'ticket', `issued ${t.id} to ${holder} · ${rail} (mock) · ${t.status}`)
  return { ok: true, ticket: t }
}

/** Mock loopback watcher fact: pending → paid. */
export const markPaid = (s, ticketId, now = Date.now()) => {
  const t = s.tickets.find((x) => x.id === ticketId)
  if (!t) return { ok: false, error: 'unknown_ticket' }
  if (t.status !== 'pending') return { ok: false, error: 'not_pending' }
  t.status = 'paid'
  t.paidAt = now
  log(s, 'pay', `${t.id} paid · mock ${t.rail} watcher fact (loopback, no funds)`)
  return { ok: true, ticket: t }
}

const REFUSAL = {
  not_usher: 'Refused: this identity is not an usher on the list.',
  unknown_ticket: 'Refused: no such ticket.',
  unpaid: 'Refused: ticket is not paid.',
  already_used: 'Refused: ticket already used.',
}
export const refusalText = (code) => REFUSAL[code] || 'Refused.'

/** Door rule: usher on the list, ticket exists, paid, unused. One use only. */
export const consume = async (s, usherId, ticketId, now = Date.now()) => {
  const tid = String(ticketId || '').trim()
  const fail = (error) => {
    log(s, 'refuse', `check-in ${tid || '∅'} by ${usherId || '∅'} refused: ${error}`)
    return { ok: false, error, message: refusalText(error) }
  }
  if (roleOf(s, usherId) !== 'usher') return fail('not_usher')
  const t = s.tickets.find((x) => x.id === tid)
  if (!t) {
    if (/^sezs1:\/\//.test(tid)) return await Pay.consumeProof(s, usherId, tid, roleOf, now)
    return fail('unknown_ticket')
  }
  t.attempts += 1
  if (t.status === 'used') return fail('already_used')
  if (t.status !== 'paid') return fail('unpaid')
  t.status = 'used'
  t.usedAt = now
  t.usedBy = usherId
  log(s, 'door', `checked in ${t.id} (${t.holder}) by ${usherId}`)
  return { ok: true, ticket: t, message: 'Checked in. A second try will be refused.' }
}

// ── scenarios ────────────────────────────────────────────────────
/** Identity specs per preset. Keys are created (or reused) by the caller. */
const CLEAN = [
  { id: 'admin-1', kind: 'keplr', role: 'admin' },
  { id: 'coord-1', kind: 'zafu', role: 'coordinator' },
  { id: 'usher-1', kind: 'ephemeral', role: 'usher' },
  { id: 'guest-keplr', kind: 'keplr', role: 'guest' },
  { id: 'guest-zafu', kind: 'zafu', role: 'guest' },
  { id: 'guest-eph', kind: 'ephemeral', role: 'guest' },
]

export const SCENARIOS = {
  clean: {
    label: 'Clean event',
    note: 'One admin, one coordinator, one usher, three guests (Keplr, Zafu, ephemeral), one paid ticket each. Nothing used.',
    identities: CLEAN,
    capacity: 40,
    tickets: [
      { holder: 'guest-keplr', rail: 'zec' },
      { holder: 'guest-zafu', rail: 'penumbra' },
      { holder: 'guest-eph', rail: 'base' },
    ],
  },
  'door-rush': {
    label: 'Door rush',
    note: 'Two ushers, fifteen guests with paid tickets, four already checked in.',
    identities: [
      ...CLEAN,
      { id: 'usher-2', kind: 'ephemeral', role: 'usher' },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `rush-${String(i + 1).padStart(2, '0')}`, kind: KINDS[i % 3], role: 'guest' })),
    ],
    capacity: 40,
    tickets: 'all-guests',
    used: 4,
  },
  'sold-out': {
    label: 'Sold out',
    note: 'Capacity 6 (test number). Six paid tickets issued; the next issue is refused.',
    identities: [
      ...CLEAN,
      { id: 'late-1', kind: 'keplr', role: 'guest' },
      { id: 'late-2', kind: 'zafu', role: 'guest' },
      { id: 'late-3', kind: 'ephemeral', role: 'guest' },
    ],
    capacity: 6,
    tickets: 'fill',
  },
  'payment-pending': {
    label: 'Payment pending',
    note: 'Guest tickets wait on a mock ZEC loopback watcher. Check-in refuses them until a watcher fact lands.',
    identities: CLEAN,
    capacity: 40,
    tickets: [
      { holder: 'guest-keplr', rail: 'zec', status: 'pending' },
      { holder: 'guest-zafu', rail: 'zec', status: 'pending' },
      { holder: 'guest-eph', rail: 'eth' },
    ],
    dregg: 'pending',
  },
  replay: {
    label: 'Replay',
    note: 'guest-keplr is already checked in; a second scan of the same ticket is replayed and refused.',
    identities: CLEAN,
    capacity: 40,
    tickets: [
      { holder: 'guest-keplr', rail: 'zec' },
      { holder: 'guest-zafu', rail: 'penumbra' },
      { holder: 'guest-eph', rail: 'base' },
    ],
    used: 1,
    replay: true,
  },
}

/**
 * Build a fresh state for a preset. `identityFor(spec)` returns the public
 * identity (it creates or loads the TEST key out of band).
 */
export const seed = (id, identityFor, now = Date.now()) => {
  const p = SCENARIOS[id]
  if (!p) return { ok: false, error: 'unknown_scenario' }
  const s = emptyState()
  s.scenario = id
  s.event.capacity = p.capacity
  for (const spec of p.identities) s.identities.push(identityFor(spec))
  log(s, 'scenario', `seeded "${p.label}" · ${s.identities.length} test identities`)
  const guests = s.identities.filter((i) => i.role === 'guest')
  const plan =
    p.tickets === 'all-guests' ? guests.map((g, i) => ({ holder: g.id, rail: RAILS[i % 4] }))
    : p.tickets === 'fill' ? guests.slice(0, p.capacity).map((g, i) => ({ holder: g.id, rail: RAILS[i % 4] }))
    : p.tickets
  for (const t of plan) issueTicket(s, t.holder, { rail: t.rail, status: t.status, now })
  // Sold out: one more request than capacity, so the refusal is in the log.
  if (p.tickets === 'fill') issueTicket(s, (guests[p.capacity] || guests[0]).id, { now })
  const usher = s.identities.find((i) => i.role === 'usher')
  for (const t of s.tickets.slice(0, p.used || 0)) consume(s, usher.id, t.id, now)
  if (p.replay && s.tickets[0]) consume(s, usher.id, s.tickets[0].id, now)
  if (p.dregg) s.dregg.zec = p.dregg
  return { ok: true, state: s }
}

/** What leaves the server. Identities carry public facts only. */
export const publicState = (s, active = null) => ({
  scenario: s.scenario,
  scenarioLabel: s.scenario ? SCENARIOS[s.scenario]?.label : null,
  event: s.event,
  identities: s.identities.map(({ id, kind, role, address, pubHex, credId, createdAt }) => ({ id, kind, role, address, pubHex, credId, createdAt })),
  tickets: s.tickets,
  qr: s.qr,
  dregg: s.dregg,
  log: s.log.slice(-120),
  checklist: s.checklist,
  active,
  activeRole: active ? roleOf(s, active) : null,
  pay: Pay.publicPay(s),
  scenarios: Object.entries(SCENARIOS).map(([k, v]) => ({ id: k, label: v.label, note: v.note })),
})

/** Public AuthSession for a tab acting as a test identity (no secrets). */
export const tabSession = (who, now = Date.now()) => ({
  credId: who.credId,
  authenticators: [{ credId: who.credId, label: 'splash-test', addedAt: now }],
  policy: 'anyOf',
  role: 'guest',
  alias: who.id,
  createdAt: now,
  wallet: {
    kind: who.kind === 'ephemeral' ? 'browser' : who.kind,
    address: who.address,
    connectedAt: now,
    ...(who.kind === 'ephemeral'
      ? { browserPubkey: Buffer.from(who.pubHex, 'hex').toString('base64'), registered: { txhash: 'splash-dev-mock', authenticatorId: 'splash-dev-mock', at: now } }
      : {}),
  },
})

export const issueInvoice = Pay.issueInvoice
export const markPaidByCommitment = Pay.markPaidByCommitment
export const paidOf = Pay.paidOf
export const consumeProof = Pay.consumeProof
export const ensureDoorAuth = Pay.ensureDoorAuth
export const issueChallenge = Pay.issueChallenge
export const doorConfig = Pay.doorConfig

export const publicPay = Pay.publicPay
export const ensurePay = Pay.ensurePay
