import assert from 'node:assert/strict'
import test from 'node:test'

import {
  STORE_KEY,
  STORE_KEY_V2,
  newSecret,
  ticketRecord,
  readTickets,
  writeStore,
  writeTickets,
  mergeTickets,
  toHex,
} from './commitment.mjs'
import { appendPurchase, purchaseCount, reconcileCounts } from './purchase.mjs'

const memStorage = () => {
  const mem = new Map()
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
  }
}

const recOf = (n, extra = {}) => {
  const secret = new Uint8Array(32)
  secret[0] = n
  return ticketRecord({ secret, invoiceNonce: String(n).padStart(2, '0'), ...extra })
}

const fakeInvoice = async ({ commitment }) => ({
  ok: true,
  invoice: {
    id: 'inv-' + commitment.slice(0, 8),
    rail: 'zec',
    sku: 'ga',
    eventId: 'speakez-sessions',
    amountCents: 2000,
    commitment,
    dest: 'uets1test',
    memo: 'sezs1:' + commitment,
    uri: 'zcash:uets1test?memo=' + commitment.slice(0, 8),
    status: 'pending',
  },
})

test('purchaseCount clamps to a positive integer', () => {
  assert.equal(purchaseCount(0), 1)
  assert.equal(purchaseCount(-2), 1)
  assert.equal(purchaseCount(3), 3)
  assert.equal(purchaseCount(99, { max: 8 }), 8)
})

test('buy 2 then buy 3 keeps 5 distinct tickets', async () => {
  const storage = memStorage()
  let n = 0
  const buildRecord = async () => recOf(++n)
  const first = await appendPurchase({
    count: 2,
    rail: 'zec',
    sku: 'ga',
    eventId: 'speakez-sessions',
    buildRecord,
    requestInvoice: fakeInvoice,
    storage,
  })
  assert.equal(first.ok, true)
  assert.equal(first.added, 2)
  assert.equal(first.after, 2)
  const second = await appendPurchase({
    count: 3,
    rail: 'zec',
    sku: 'ga',
    eventId: 'speakez-sessions',
    buildRecord,
    requestInvoice: fakeInvoice,
    storage,
  })
  assert.equal(second.ok, true)
  assert.equal(second.added, 3)
  const all = readTickets(storage)
  assert.equal(all.length, 5)
  assert.equal(new Set(all.map((t) => t.commitmentHex)).size, 5)
  assert.equal(new Set(all.map((t) => t.secretHex)).size, 5)
})

test('re-sync by commitment does not duplicate', async () => {
  const storage = memStorage()
  let n = 0
  const buildRecord = async () => recOf(++n)
  await appendPurchase({
    count: 2,
    rail: 'zec',
    sku: 'ga',
    eventId: 'speakez-sessions',
    buildRecord,
    requestInvoice: fakeInvoice,
    storage,
  })
  await appendPurchase({
    count: 3,
    rail: 'zec',
    sku: 'ga',
    eventId: 'speakez-sessions',
    buildRecord,
    requestInvoice: fakeInvoice,
    storage,
  })
  const local = readTickets(storage)
  const sync = mergeTickets(local, local.map((t) => ({ ...t })))
  writeTickets(sync, storage)
  assert.equal(readTickets(storage).length, 5)
  const skinny = local.map((t) => ({ version: 2, commitmentHex: t.commitmentHex, secretHex: t.secretHex, eventId: t.eventId, sku: t.sku }))
  const again = mergeTickets(readTickets(storage), skinny)
  writeTickets(again, storage)
  const after = readTickets(storage)
  assert.equal(after.length, 5)
  assert.ok(after.every((t) => t.uri), 'existing invoice fields survive a skinny re-sync')
})

test('writeStore upserts the same commitment and does not drop others', () => {
  const storage = memStorage()
  const a = recOf(1)
  const b = recOf(2)
  writeStore(a, storage)
  writeStore(b, storage)
  writeStore({ ...a, invoiceId: 'inv-a' }, storage)
  const all = readTickets(storage)
  assert.equal(all.length, 2)
  const got = all.find((t) => t.commitmentHex === a.commitmentHex)
  assert.equal(got.invoiceId, 'inv-a')
  assert.ok(all.some((t) => t.commitmentHex === b.commitmentHex))
})

test('empty v2 list still keeps a v1 ticket', () => {
  const storage = memStorage()
  const a = recOf(1)
  storage.setItem(STORE_KEY, JSON.stringify(a))
  storage.setItem(STORE_KEY_V2, JSON.stringify({ version: 2, tickets: [] }))
  const all = readTickets(storage)
  assert.equal(all.length, 1)
  assert.equal(all[0].commitmentHex, a.commitmentHex)
})

test('reconcileCounts matches local commitments to a backend leaf list', () => {
  const a = recOf(1)
  const b = recOf(2)
  const r = reconcileCounts([a, b], [a.commitmentHex])
  assert.deepEqual(r, { local: 2, backend: 1, matched: 1 })
})

void toHex
