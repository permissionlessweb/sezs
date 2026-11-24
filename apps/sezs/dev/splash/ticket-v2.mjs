/**
 * Ticket v2 payment backend (lab loopback). See apps/sezs/docs/BACKEND-ROLE.md
 * and TICKET-V2-SPEC.md §7.
 *
 * What changed from v1:
 * - The invoice records only { C, rail, sku, eventId }. It refuses a ticket
 *   public key or a nullifier: those were correlators from the door back to C.
 * - Paid commitments go into an append-only depth-10 tree with the standard
 *   P128Pow5T3 Poseidon (the circuit's hash), built by the same wasm the
 *   browser proves with.
 * - The full leaf list + current root are public (GET /sezs/v2/leaves). Holders
 *   download all of it and find their own leaf locally.
 * - Sealed ZID backups are stored and fetched by invoice id only, never by C.
 * - The backend is not at the door. Admission is the event contract.
 *
 * The backend never sees the ticket secret (guards.mjs refuses those fields).
 */
import { memoOf, EVENT_ID, DEFAULT_SKU } from '../../src/ticket/commitment.mjs'
import { buildZip321 } from '../../src/ticket/zip321.mjs'
import { zecUriLabOk, penumbraDestOk } from '../../src/pay/network.ts'
import { loadTicketV2Node } from '../../src/ticket/v2/node.mjs'
import { refuseSecretFields, scrubLog } from './guards.mjs'
import { LAB_ZEC, LAB_UM, priceCents, ticketZecDest, ticketUmDest } from './ticket-pay.mjs'
import {
  loadTree, saveTree, mergeLeaves, mergePayments, rebuildFromPayments, publicInvoiceSnapshot,
} from './ticket-leaves.mjs'

export const SUITE = 'P128Pow5T3'
export const TREE_DEPTH = 10
export const CAPACITY = 1 << TREE_DEPTH
/** Fields a v2 invoice must not carry (door correlators). */
export const V2_CORRELATOR_KEYS = ['ticketPubkey', 'ticket_pubkey', 'ticketPublicKey', 'pubkey', 'nullifier', 'n', 'rk']

const PALLAS_P = 0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001n
/** Poseidon/Pallas field element in 32-byte big-endian hex. */
export const isCanonicalLeaf = (raw) => {
  const s = String(raw ?? '').trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/.test(s)) return false
  try {
    // Ticket leaves are Poseidon/Pallas field bytes in little-endian hex.
    const b = Uint8Array.from(s.match(/../g), (x) => parseInt(x, 16))
    let n = 0n
    for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) + BigInt(b[i])
    return n < PALLAS_P
  } catch { return false }
}
const hex32 = (raw) => {
  const s = String(raw ?? '').trim().toLowerCase().replace(/^0x/, '')
  return isCanonicalLeaf(s) ? s : null
}
const fromHex = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16))
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

export const ensureV2 = (s, { eventId = EVENT_ID } = {}) => {
  if (!s.v2 || typeof s.v2 !== 'object') s.v2 = {}
  const v = s.v2
  v.eventId ||= eventId
  if (!Array.isArray(v.invoices)) v.invoices = []
  if (!Array.isArray(v.leaves)) v.leaves = []
  if (!Array.isArray(v.envelopes)) v.envelopes = []
  if (!Array.isArray(v.published)) v.published = []
  if (!v.root) v.root = toHex(loadTicketV2Node().treeRoot([]))
  if (!Array.isArray(s.log)) s.log = []
  return v
}

const log = (s, kind, msg) => {
  s.log.push({ t: Date.now(), kind, msg: scrubLog(String(msg)).slice(0, 240) })
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400)
}

const rebuildRoot = (v) => {
  v.root = toHex(loadTicketV2Node().treeRoot(v.leaves.map(fromHex)))
  return v.root
}


const sessionRootOf = () => process.env.SEZS_SESSION_ROOT || ''

const persistV2 = (s, root) => {
  const dir = root || sessionRootOf()
  if (!dir) return
  const v = ensureV2(s)
  const prev = loadTree(dir)
  saveTree(dir, {
    ...prev,
    eventId: v.eventId || prev.eventId,
    contract: process.env.SEZS_V2_ROOT_CONTRACT || prev.contract,
    leaves: mergeLeaves(prev.leaves, v.leaves),
    invoices: (() => {
      const byC = new Map()
      for (const inv of [...(prev.invoices || []), ...(v.invoices || []).map(publicInvoiceSnapshot)]) {
        const snap = publicInvoiceSnapshot(inv)
        if (snap) byC.set(snap.commitment, { ...(byC.get(snap.commitment) || {}), ...snap })
      }
      return [...byC.values()]
    })(),
    published: (v.published && v.published.length ? v.published : prev.published) || [],
    payments: mergePayments(prev.payments, v.payments || []),
    root: v.root || prev.root,
  })
}

/** Load the session tree into splash state. Safe to call more than once. */
export const hydrateV2 = (s, { root, eventId } = {}) => {
  const v = ensureV2(s, eventId ? { eventId } : {})
  const disk = loadTree(root || sessionRootOf())
  if (disk.eventId && !s.v2.eventId) v.eventId = disk.eventId
  v.leaves = mergeLeaves(disk.leaves, v.leaves)
  const byC = new Map((v.invoices || []).map((i) => [i.commitment, i]))
  for (const inv of disk.invoices || []) {
    if (!inv?.commitment) continue
    const cur = byC.get(inv.commitment)
    if (!cur) {
      v.invoices.push({ ...inv })
      byC.set(inv.commitment, inv)
    } else if (inv.status === 'paid' && cur.status !== 'paid') {
      Object.assign(cur, inv)
    }
  }
  if (disk.published?.length && !v.published.length) v.published = disk.published.slice()
  v.payments = mergePayments(disk.payments, v.payments || [])
  rebuildRoot(v)
  return v
}

/**
 * Record a paid commitment from the watcher or chain history.
 * Known invoices go through markPaidV2; unknown paid memos still append a leaf
 * so the tree can be rebuilt after a restart.
 */
export const ingestPaidLeafV2 = (s, hit = {}, { now = Date.now() } = {}) => {
  const v = hydrateV2(s)
  const c = (hit.commitment || '').toString()
  const marked = markPaidV2(s, c, { amountCents: hit.amountCents, txid: hit.txid, rail: hit.rail, height: hit.height, now })
  if (marked.ok) return marked
  const hex = String(c).trim().toLowerCase().replace(/^0x/, '').replace(/^sezs1:/, '')
  if (!/^[0-9a-f]{64}$/.test(hex) || !isCanonicalLeaf(hex)) return { ok: false, error: 'bad_commitment' }
  if (v.leaves.length >= CAPACITY && !v.leaves.includes(hex)) return { ok: false, error: 'tree_full' }
  if (!v.leaves.includes(hex)) v.leaves.push(hex)
  v.payments = mergePayments(v.payments || [], [{ commitment: hex, txid: hit.txid, rail: hit.rail, height: hit.height, amountCents: hit.amountCents, at: now }])
  if (!v.invoices.some((i) => i.commitment === hex)) {
    v.invoices.push({
      id: `rebuilt-${hex.slice(0, 12)}`,
      rail: hit.rail || 'unknown',
      sku: 'rebuilt',
      eventId: v.eventId,
      amountCents: hit.amountCents == null ? null : Number(hit.amountCents),
      commitment: hex,
      dest: hit.dest || null,
      memo: `sezs1:${hex}`,
      uri: null,
      status: 'paid',
      paidAt: now,
      txid: hit.txid || null,
    })
  }
  rebuildRoot(v)
  persistV2(s)
  return { ok: true, rebuilt: true, root: v.root, leafCount: v.leaves.length }
}

export const issueInvoiceV2 = (s, body = {}, now = Date.now()) => {
  const refused = refuseSecretFields(body)
  if (refused) return refused
  const extra = V2_CORRELATOR_KEYS.filter((k) => body[k] != null && body[k] !== '')
  if (extra.length) return { ok: false, error: 'v2_no_correlators', fields: extra }
  const v = ensureV2(s)
  const rail = String(body.rail || '')
  if (rail !== 'zec' && rail !== 'penumbra') return { ok: false, error: 'bad_rail' }
  const c = hex32(body.commitment)
  if (!c) return { ok: false, error: 'bad_commitment' }
  const eventId = body.eventId || v.eventId
  if (eventId !== v.eventId) return { ok: false, error: 'wrong_event' }
  const existing = v.invoices.find((i) => i.commitment === c && i.status !== 'void')
  if (existing) return { ok: true, invoice: publicInvoiceV2(existing), reused: true }
  const dest = rail === 'zec' ? ticketZecDest() : ticketUmDest()
  if (rail === 'zec' && !zecUriLabOk(`zcash:${dest}`)) return { ok: false, error: 'bad_dest' }
  if (rail === 'penumbra' && !penumbraDestOk(dest)) return { ok: false, error: 'bad_dest' }
  const memo = memoOf(fromHex(c))
  const uri = rail === 'zec' ? buildZip321({ address: dest, memo, message: 'Speakez Sessions' }) : null
  const inv = {
    id: `inv2-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    rail,
    sku: String(body.sku || DEFAULT_SKU),
    eventId,
    amountCents: priceCents(rail),
    commitment: c,
    dest,
    memo,
    uri,
    status: 'pending',
    issuedAt: now,
    paidAt: null,
  }
  v.invoices.push(inv)
  log(s, 'pay', `v2 invoice ${inv.id} · ${rail} · ${inv.amountCents} cents`)
  return { ok: true, invoice: publicInvoiceV2(inv) }
}

/** No leaf index: the holder finds its own leaf in the public list. */
export const publicInvoiceV2 = (i) => ({
  id: i.id,
  rail: i.rail,
  sku: i.sku,
  eventId: i.eventId,
  amountCents: i.amountCents,
  commitment: i.commitment,
  dest: i.dest,
  memo: i.memo,
  uri: i.uri,
  status: i.status,
  paidAt: i.paidAt,
  txid: i.txid || null,
  phase: i.status === 'paid' ? 'Settled' : i.seenAt ? 'Mempool' : 'waiting',
})

export const markPaidV2 = (s, raw, { amountCents, now = Date.now(), txid, rail, height } = {}) => {
  const v = ensureV2(s)
  const c = hex32(raw) || hex32(String(raw || '').replace(/^sezs1:/, ''))
  if (!c) return { ok: false, error: 'bad_commitment' }
  const inv = v.invoices.find((i) => i.commitment === c && i.status !== 'void')
  if (!inv) return { ok: false, error: 'unknown_invoice' }
  if (inv.status === 'paid') {
    if (txid) {
      inv.txid = inv.txid || txid
      v.payments = mergePayments(v.payments || [], [{ commitment: c, txid, rail: rail || inv.rail, height, amountCents: inv.amountCents, at: inv.paidAt }])
      persistV2(s)
    }
    return { ok: true, invoice: publicInvoiceV2(inv), already: true }
  }
  if (amountCents != null && Number(amountCents) !== inv.amountCents) {
    log(s, 'refuse', `v2 pay for ${inv.id} refused: amount mismatch`)
    return { ok: false, error: 'amount_mismatch' }
  }
  if (v.leaves.length >= CAPACITY) return { ok: false, error: 'tree_full' }
  inv.status = 'paid'
  inv.paidAt = now
  if (txid) inv.txid = txid
  v.payments = mergePayments(v.payments || [], [{ commitment: c, txid, rail: rail || inv.rail, height, amountCents: inv.amountCents, at: now }])
  if (!v.leaves.includes(c)) v.leaves.push(c)
  rebuildRoot(v)
  persistV2(s)
  log(s, 'pay', `v2 payment recorded · leaves ${v.leaves.length}`)
  return { ok: true, invoice: publicInvoiceV2(inv), root: v.root, leafCount: v.leaves.length }
}


/** Mempool sighting only. Never marks the invoice paid or appends a leaf. */
export const markSeenV2 = (s, raw, { txid, rail, now = Date.now() } = {}) => {
  const v = ensureV2(s)
  const c = hex32(raw) || hex32(String(raw || '').replace(/^sezs1:/, ''))
  if (!c) return { ok: false, error: 'bad_commitment' }
  const inv = v.invoices.find((i) => i.commitment === c && i.status !== 'void')
  if (!inv) return { ok: false, error: 'unknown_invoice' }
  if (inv.status === 'paid') return { ok: true, invoice: publicInvoiceV2(inv), already: true, paid: true }
  if (!inv.seenAt) inv.seenAt = now
  if (txid) inv.txid = inv.txid || txid
  if (rail && !inv.rail) inv.rail = rail
  persistV2(s)
  return { ok: true, invoice: publicInvoiceV2(inv), paid: false, phase: 'Mempool' }
}

/** Public leaf list for proving. Same answer for everyone; no per-holder query. */
export const leavesV2 = (s) => {
  const v = ensureV2(s)
  const last = v.published[v.published.length - 1] || null
  return {
    ok: true,
    eventId: v.eventId,
    suite: SUITE,
    depth: TREE_DEPTH,
    leafCount: v.leaves.length,
    leaves: v.leaves.slice(),
    root: v.root,
    published: last && { root: last.root, epoch: last.epoch, leafCount: last.leafCount, txhash: last.txhash || null, at: last.at },
  }
}

/** Sealed ZID backup, keyed by invoice id only. Ciphertext only; never opened here. */
export const putEnvelopeV2 = (s, body = {}, now = Date.now()) => {
  const refused = refuseSecretFields(body)
  if (refused) return refused
  const v = ensureV2(s)
  if (body.commitment != null) return { ok: false, error: 'v2_envelope_by_invoice_only' }
  const inv = v.invoices.find((i) => i.id === body.invoiceId)
  if (!inv) return { ok: false, error: 'unknown_invoice' }
  if (!body.ciphertext) return { ok: false, error: 'bad_ciphertext' }
  const rec = {
    invoiceId: inv.id,
    ciphertext: String(body.ciphertext),
    ephemeral_pubkey: body.ephemeral_pubkey == null ? '' : String(body.ephemeral_pubkey),
    pq_epoch: body.pq_epoch == null ? 0 : Number(body.pq_epoch),
    pq_suite: body.pq_suite || null,
    origin: body.origin || null,
    storedAt: now,
  }
  v.envelopes.push(rec)
  log(s, 'pay', `v2 sealed backup stored for ${inv.id}`)
  return { ok: true, invoiceId: inv.id, count: v.envelopes.filter((e) => e.invoiceId === inv.id).length }
}

export const getEnvelopesV2 = (s, invoiceId) => {
  const v = ensureV2(s)
  const id = String(invoiceId || '')
  if (hex32(id)) return { ok: false, error: 'v2_envelope_by_invoice_only' }
  if (!v.invoices.some((i) => i.id === id)) return { ok: false, error: 'unknown_invoice' }
  return { ok: true, invoiceId: id, envelopes: v.envelopes.filter((e) => e.invoiceId === id) }
}

export const recordPublishV2 = (s, rec) => {
  const v = ensureV2(s)
  v.published.push(rec)
  if (v.published.length > 200) v.published.splice(0, v.published.length - 200)
  persistV2(s)
  log(s, 'root', `guest root published · epoch ${rec.epoch} · ${rec.leafCount} leaves${rec.txhash ? ` · tx ${rec.txhash.slice(0, 10)}…` : ''}`)
}

export { toHex as hexOf, fromHex as bytesOf, persistV2, rebuildFromPayments }
