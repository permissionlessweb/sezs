/**
 * Append a batch of new tickets to the local store and ask the lab for one
 * invoice per ticket. Never deletes earlier tickets. Idempotent on commitment.
 */
import { readTickets, writeStore } from './commitment.mjs'

export const purchaseCount = (raw, { max = 32 } = {}) => {
  const n = Math.floor(Number(raw) || 0)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(max, n)
}

export async function appendPurchase({
  count = 1,
  rail,
  sku,
  eventId,
  buildRecord,
  requestInvoice,
  storage = undefined,
}) {
  const n = purchaseCount(count)
  const before = readTickets(storage)
  const seen = new Set(before.map((t) => t.commitmentHex))
  const issued = []
  for (let i = 0; i < n; i++) {
    const rec = await buildRecord()
    const c = rec?.commitmentHex
    if (!c || !/^[0-9a-f]{64}$/.test(c)) {
      issued.push({ rec: rec || null, invoice: null, error: 'bad_commitment' })
      continue
    }
    if (seen.has(c)) {
      issued.push({ rec, invoice: null, error: 'duplicate_commitment' })
      continue
    }
    writeStore(rec, storage)
    seen.add(c)
    let invoice = null
    let error = null
    try {
      const got = await requestInvoice({ rail, commitment: c, sku, eventId })
      if (!got?.ok || !got.invoice) {
        error = got?.error || 'The lab invoice did not issue.'
      } else {
        invoice = got.invoice
        writeStore(
          {
            ...rec,
            invoiceId: invoice.id || rec.invoiceId,
            dest: invoice.dest || rec.dest,
            memo: invoice.memo || rec.memo,
            uri: invoice.uri || rec.uri,
          },
          storage,
        )
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Checkout failed.'
    }
    issued.push({ rec, invoice, error })
  }
  const after = readTickets(storage)
  return {
    ok: issued.length === n && issued.every((x) => x.invoice && !x.error),
    issued,
    before: before.length,
    after: after.length,
    added: after.length - before.length,
  }
}

/** Local tickets whose commitments also appear on the backend list. */
export const reconcileCounts = (localTickets, backendCommitments) => {
  const local = new Set((localTickets || []).map((t) => t.commitmentHex).filter(Boolean))
  const back = new Set((backendCommitments || []).map((c) => String(c || '').toLowerCase().replace(/^0x/, '')))
  let matched = 0
  for (const c of local) if (back.has(c)) matched += 1
  return { local: local.size, backend: back.size, matched }
}
