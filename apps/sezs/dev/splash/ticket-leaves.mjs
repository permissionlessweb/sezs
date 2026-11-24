/**
 * Durable, rebuildable paid-ticket leaf list.
 *
 * The append-only commitment list is written under SEZS_SESSION_ROOT
 * (ticket-v2-tree.json) so a splash restart does not drop leaves. The same
 * file can be rebuilt from watcher/chain payment history: known leaves keep
 * their original order, and newly seen paid commitments are appended in
 * (height, txid) order. Leaves are never removed or reordered.
 *
 * Public data only (commitments, invoice ids, rails, txids). No keys.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const TREE_FILE = 'ticket-v2-tree.json'

export const treePath = (root) => {
  const r = root || process.env.SEZS_SESSION_ROOT || ''
  return r ? join(r, TREE_FILE) : null
}

export const emptyTree = () => ({
  version: 1,
  eventId: null,
  contract: null,
  leaves: [],
  invoices: [],
  published: [],
  payments: [],
  root: null,
  updatedAt: 0,
})

const hex32 = (raw) => {
  const s = String(raw ?? '').trim().toLowerCase().replace(/^0x/, '').replace(/^sezs1:/, '')
  return /^[0-9a-f]{64}$/.test(s) ? s : null
}

export const loadTree = (root) => {
  const p = treePath(root)
  if (!p || !existsSync(p)) return emptyTree()
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    const t = { ...emptyTree(), ...(j && typeof j === 'object' ? j : {}) }
    t.leaves = Array.isArray(t.leaves) ? t.leaves.map(hex32).filter(Boolean) : []
    t.invoices = Array.isArray(t.invoices) ? t.invoices : []
    t.published = Array.isArray(t.published) ? t.published : []
    t.payments = Array.isArray(t.payments) ? t.payments : []
    return t
  } catch {
    return emptyTree()
  }
}

export const saveTree = (root, tree) => {
  const p = treePath(root)
  if (!p) return null
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 })
  const out = { ...emptyTree(), ...tree, updatedAt: Date.now() }
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, p)
  return p
}

export const mergeLeaves = (existing, incoming) => {
  const out = []
  const have = new Set()
  for (const src of [existing, incoming]) {
    for (const raw of src || []) {
      const c = hex32(raw)
      if (!c || have.has(c)) continue
      out.push(c)
      have.add(c)
    }
  }
  return out
}

const payKey = (p) => `${p.txid || ''}:${hex32(p.commitment) || ''}`

export const mergePayments = (existing, incoming) => {
  const out = []
  const have = new Set()
  for (const src of [existing, incoming]) {
    for (const p of src || []) {
      const c = hex32(p?.commitment)
      if (!c || !p?.txid) continue
      const rec = {
        commitment: c,
        txid: String(p.txid),
        rail: p.rail || null,
        height: Number.isFinite(Number(p.height)) ? Number(p.height) : null,
        amountCents: p.amountCents == null ? null : Number(p.amountCents),
        at: p.at || null,
      }
      const k = payKey(rec)
      if (have.has(k)) continue
      have.add(k)
      out.push(rec)
    }
  }
  return out
}

const paymentOrder = (a, b) => {
  const ha = a.height == null ? Number.MAX_SAFE_INTEGER : a.height
  const hb = b.height == null ? Number.MAX_SAFE_INTEGER : b.height
  if (ha !== hb) return ha - hb
  const tx = String(a.txid || '').localeCompare(String(b.txid || ''))
  if (tx) return tx
  return String(a.commitment).localeCompare(String(b.commitment))
}

/** Keep existing leaf order; append paid commitments not yet in the list. */
export const rebuildFromPayments = (tree, payments) => {
  const t = { ...emptyTree(), ...tree }
  t.payments = mergePayments(t.payments, payments)
  const sorted = [...t.payments].sort(paymentOrder)
  t.leaves = mergeLeaves(t.leaves, sorted.map((p) => p.commitment))
  return t
}

export const publicInvoiceSnapshot = (inv) => {
  if (!inv || !hex32(inv.commitment)) return null
  return {
    id: inv.id || null,
    rail: inv.rail || null,
    sku: inv.sku || null,
    eventId: inv.eventId || null,
    amountCents: inv.amountCents == null ? null : Number(inv.amountCents),
    commitment: hex32(inv.commitment),
    dest: inv.dest || null,
    memo: inv.memo || null,
    status: inv.status || null,
    paidAt: inv.paidAt || null,
    txid: inv.txid || null,
    seenAt: inv.seenAt || null,
  }
}
