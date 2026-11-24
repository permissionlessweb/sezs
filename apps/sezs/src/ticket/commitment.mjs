/**
 * Browser ticket secret, payment memo, and door QR.
 *
 * The purchaser's browser always generates the secret: a domain-separated KDF
 * of a fresh CSPRNG seed and the event context (see kdf.mjs). The secret never
 * goes to the backend. Commitment C is the consume-circuit leaf.
 *
 * See apps/sezs/docs/BACKEND-ROLE.md.
 */
import {
  ticketLeaf,
  doorNullifier,
  toHex,
  fromHex,
  fromBytes,
  toBytes,
} from './poseidon.mjs'
import { encodeGuestQr, parseGuestQr, eventTagMatches } from './v2/guest-qr.mjs'
import {
  deriveTicketSecret,
  fitSecretToField,
  newTicketMaterial,
  newSeed,
  newInvoiceNonce,
  SECRET_KDF_DOMAIN,
  defaultRng,
} from './kdf.mjs'

export const EVENT_ID = 'speakez-sessions'
export const DEFAULT_SKU = 'ga'
export const MEMO_PREFIX = 'sezs1:'
export const QR_SCHEME = 'sezs1://ticket'
export const STORE_KEY = 'sezs-ticket-v1'
export const STORE_KEY_V2 = 'sezs-ticket-v2'

/** Field-fitted 32 random bytes. Prefer newTicketMaterial() for a real purchase. */
export const newSecret = (rng = defaultRng) => fitSecretToField(rng(32))

export const commitmentOf = (secret, sku = DEFAULT_SKU, eventId = EVENT_ID) =>
  ticketLeaf(secret, sku, eventId)

export const nullifierOf = (secret, eventId = EVENT_ID) => doorNullifier(secret, eventId)

export const memoOf = (commitment) => MEMO_PREFIX + toHex(commitment)

export const parseMemo = (text) => {
  const s = String(text || '').trim()
  if (!s.startsWith(MEMO_PREFIX)) return null
  const hex = s.slice(MEMO_PREFIX.length).trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(hex)) return null
  return fromHex(hex)
}

export const qrPayload = (secret, sku = DEFAULT_SKU, eventId = EVENT_ID) => encodeGuestQr({ secret, sku, eventId })

export const parseQr = (text, { eventId: assumed } = {}) => {
  const got = parseGuestQr(text)
  if (!got.ok) return { ok: false, error: got.error || 'bad_qr' }
  const secret = fitSecretToField(got.secret)
  const sku = got.sku
  const eventId = got.eventId || assumed || EVENT_ID
  if (got.eventTag && !eventTagMatches(eventId, got.eventTag)) return { ok: false, error: 'wrong_event' }
  const commitment = commitmentOf(secret, sku, eventId)
  const nullifier = nullifierOf(secret, eventId)
  return { ok: true, version: got.version, eventId, sku, secret, commitment, nullifier, eventTag: got.eventTag }
}

export const ticketRecord = ({
  secret,
  sku = DEFAULT_SKU,
  eventId = EVENT_ID,
  rail,
  invoiceId,
  invoiceNonce,
  dest,
  memo,
  uri,
  sealed,
  commitment: given,
  alphaNonce,
  bundleB64,
}) => {
  const commitment = given
    ? given instanceof Uint8Array
      ? given
      : fromHex(String(given))
    : commitmentOf(secret, sku, eventId)
  return {
    version: 2,
    eventId,
    sku,
    invoiceNonce: invoiceNonce || null,
    secretHex: toHex(secret),
    commitmentHex: toHex(commitment),
    rail: rail || null,
    invoiceId: invoiceId || null,
    dest: dest || null,
    memo: memo || memoOf(commitment),
    uri: uri || null,
    qr: qrPayload(secret, sku, eventId),
    sealed: sealed || null,
    alphaNonce: alphaNonce || null,
    bundleB64: bundleB64 || null,
  }
}

const parseOne = (t) => {
  if (!t || !/^[0-9a-f]{64}$/.test(t.secretHex || '')) return null
  if (t.version !== 1 && t.version !== 2) return null
  return t
}

const defaultStorage = () => {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

const STATUS_RANK = { unused: 0, transferred: 1, consumed: 2 }

const pickField = (incoming, kept, key) => {
  const v = incoming?.[key]
  if (v != null && v !== '') return v
  return kept?.[key] ?? null
}

/** Merge two records for the same commitment. Never drops a secret or invoice field. */
export const mergeOne = (kept, incoming) => {
  if (!kept) return incoming || null
  if (!incoming) return kept
  const inRank = STATUS_RANK[incoming.status] ?? -1
  const keepRank = STATUS_RANK[kept.status] ?? -1
  const status = inRank >= keepRank ? (incoming.status || kept.status) : kept.status
  return {
    ...kept,
    ...incoming,
    secretHex: kept.secretHex || incoming.secretHex,
    qr: pickField(incoming, kept, 'qr'),
    invoiceId: pickField(incoming, kept, 'invoiceId'),
    dest: pickField(incoming, kept, 'dest'),
    memo: pickField(incoming, kept, 'memo'),
    uri: pickField(incoming, kept, 'uri'),
    sealed: incoming.sealed != null ? incoming.sealed : kept.sealed,
    paidAt: kept.paidAt || incoming.paidAt || null,
    status: status || kept.status || incoming.status,
    transferredTo: pickField(incoming, kept, 'transferredTo'),
  }
}

/** Idempotent union by commitment. Records without a secret cannot create a new ticket. */
export const mergeTickets = (existing, incoming) => {
  const byC = new Map()
  for (const t of existing || []) {
    const p = parseOne(t)
    if (p) byC.set(p.commitmentHex, p)
  }
  for (const t of incoming || []) {
    const p = parseOne(t)
    if (p) {
      byC.set(p.commitmentHex, mergeOne(byC.get(p.commitmentHex), p))
      continue
    }
    const c = String(t?.commitmentHex || '').toLowerCase().replace(/^0x/, '')
    if (!/^[0-9a-f]{64}$/.test(c) || !byC.has(c)) continue
    byC.set(c, mergeOne(byC.get(c), { ...byC.get(c), ...t, secretHex: byC.get(c).secretHex }))
  }
  return [...byC.values()]
}

const ticketsFromV2 = (raw) => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : parsed?.tickets
    return (list || []).map(parseOne).filter(Boolean)
  } catch {
    return []
  }
}

const ticketFromV1 = (raw) => {
  if (!raw) return []
  try {
    const v1 = parseOne(JSON.parse(raw))
    return v1 ? [v1] : []
  } catch {
    return []
  }
}

/** Every ticket this browser is holding, most recently written last. */
export const readTickets = (storage = defaultStorage()) => {
  if (!storage) return []
  try {
    // Always merge v1 into v2 so an empty or partial v2 cannot drop a v1 ticket.
    return mergeTickets(ticketsFromV2(storage.getItem(STORE_KEY_V2)), ticketFromV1(storage.getItem(STORE_KEY)))
  } catch {
    return []
  }
}

/** Most recently stored ticket (backward compatible). */
export const readStore = (storage = defaultStorage()) => {
  const all = readTickets(storage)
  return all.length ? all[all.length - 1] : null
}

export const writeTickets = (tickets, storage = defaultStorage()) => {
  if (!storage) return false
  const list = (tickets || []).map(parseOne).filter(Boolean)
  storage.setItem(STORE_KEY_V2, JSON.stringify({ version: 2, tickets: list }))
  if (list.length) storage.setItem(STORE_KEY, JSON.stringify(list[list.length - 1]))
  else storage.removeItem(STORE_KEY)
  return true
}

/** Insert or replace a ticket by commitment. Does not delete earlier tickets. */
export const writeStore = (record, storage = defaultStorage()) => {
  const rec = parseOne(record)
  if (!rec) return false
  const all = readTickets(storage)
  const next = mergeOne(all.find((t) => t.commitmentHex === rec.commitmentHex), rec)
  const rest = all.filter((t) => t.commitmentHex !== rec.commitmentHex)
  return writeTickets([...rest, next], storage)
}

export const upsertTicket = writeStore

export const setTicketStatus = (commitmentHex, status, extra = {}, storage = defaultStorage()) => {
  const c = String(commitmentHex || '').toLowerCase()
  const cur = readTickets(storage).find((t) => t.commitmentHex === c)
  if (!cur) return false
  return writeStore({ ...cur, status, ...extra }, storage)
}

export {
  toHex,
  fromHex,
  fromBytes,
  toBytes,
  ticketLeaf,
  doorNullifier,
  deriveTicketSecret,
  fitSecretToField,
  newTicketMaterial,
  newSeed,
  newInvoiceNonce,
  SECRET_KDF_DOMAIN,
}
