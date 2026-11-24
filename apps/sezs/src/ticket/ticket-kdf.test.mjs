import assert from 'node:assert/strict'
import { test } from 'node:test'
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto) globalThis.crypto = webcrypto

import {
  deriveTicketSecret,
  newTicketMaterial,
  newSecret,
  commitmentOf,
  nullifierOf,
  ticketRecord,
  readTickets,
  writeStore,
  writeTickets,
  memoOf,
  EVENT_ID,
  DEFAULT_SKU,
  toHex,
} from './commitment.mjs'
import { findForbiddenSecretField, refuseSecretFields, scrubLog } from './guards.mjs'
import { putEnvelope, getEnvelopes } from './envelopes.mjs'
import { refuseRelayEndpoint } from '../zafu/relay-guard.mjs'
import {
  createLabZidProvider,
  labEncryptFor,
  labDecryptFrom,
  labZidPubkey,
} from '../zafu/lab-provider.mjs'
import { decodeInner, encodeInner, innerPayload, publicEnvelope } from '../zafu/envelope.mjs'

const rngFrom = (fill) => (n) => {
  const b = new Uint8Array(n)
  b.fill(fill)
  return b
}

test('KDF secret is 32 bytes, field-fitted, and depends on event, sku, and nonce', async () => {
  const seed = rngFrom(7)(32)
  const a = await deriveTicketSecret({ seed, eventId: EVENT_ID, sku: DEFAULT_SKU, invoiceNonce: 'aa'.repeat(16) })
  const b = await deriveTicketSecret({ seed, eventId: EVENT_ID, sku: DEFAULT_SKU, invoiceNonce: 'aa'.repeat(16) })
  const otherEvent = await deriveTicketSecret({ seed, eventId: 'other-event', sku: DEFAULT_SKU, invoiceNonce: 'aa'.repeat(16) })
  const otherSku = await deriveTicketSecret({ seed, eventId: EVENT_ID, sku: 'vip', invoiceNonce: 'aa'.repeat(16) })
  const otherNonce = await deriveTicketSecret({ seed, eventId: EVENT_ID, sku: DEFAULT_SKU, invoiceNonce: 'bb'.repeat(16) })
  assert.equal(a.length, 32)
  assert.equal(a[31] & 0xc0, 0)
  assert.equal(toHex(a), toHex(b))
  assert.notEqual(toHex(a), toHex(otherEvent))
  assert.notEqual(toHex(a), toHex(otherSku))
  assert.notEqual(toHex(a), toHex(otherNonce))
  const C = commitmentOf(a, DEFAULT_SKU, EVENT_ID)
  const N = nullifierOf(a, EVENT_ID)
  assert.equal(C.length, 32)
  assert.notEqual(toHex(C), toHex(N))
})

test('two purchases with the same rng seed still differ when the nonce differs', async () => {
  let n = 0
  const rng = (len) => {
    const b = new Uint8Array(len)
    b.fill((n++ % 200) + 1)
    return b
  }
  const one = await newTicketMaterial({ eventId: EVENT_ID, sku: DEFAULT_SKU, rng })
  const two = await newTicketMaterial({ eventId: EVENT_ID, sku: DEFAULT_SKU, rng })
  assert.notEqual(toHex(one.secret), toHex(two.secret))
  assert.notEqual(one.invoiceNonce, two.invoiceNonce)
})

test('KDF context cannot be empty; seed must be 32 bytes', async () => {
  const seed = new Uint8Array(32)
  seed[0] = 3
  await assert.rejects(() => deriveTicketSecret({ seed, eventId: '', sku: 'ga', invoiceNonce: 'x' }))
  await assert.rejects(() => deriveTicketSecret({ seed: new Uint8Array(16), eventId: EVENT_ID, sku: 'ga', invoiceNonce: 'x' }))
})

test('store keeps more than one ticket by commitment', () => {
  const mem = new Map()
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
  }
  const s1 = newSecret(() => { const b = new Uint8Array(32); b[0] = 1; return b })
  const s2 = newSecret(() => { const b = new Uint8Array(32); b[0] = 2; return b })
  const a = ticketRecord({ secret: s1, invoiceNonce: '11' })
  const b = ticketRecord({ secret: s2, invoiceNonce: '22' })
  writeStore(a, storage)
  writeStore(b, storage)
  const all = readTickets(storage)
  assert.equal(all.length, 2)
  assert.equal(all[0].commitmentHex, a.commitmentHex)
  assert.equal(all[1].commitmentHex, b.commitmentHex)
  writeTickets([], storage)
  assert.equal(readTickets(storage).length, 0)
})

test('backend guards refuse secret fields and scrub QR logs', () => {
  assert.equal(findForbiddenSecretField({ rail: 'zec', commitment: 'ab'.repeat(32) }), null)
  assert.equal(findForbiddenSecretField({ secret: 'aa'.repeat(32) }), 'secret')
  assert.equal(findForbiddenSecretField({ k: 'aa'.repeat(32) }), 'k')
  assert.equal(findForbiddenSecretField({ ticket: { secretHex: 'aa' } }), 'ticket.secretHex')
  const r = refuseSecretFields({ seed: '00' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'secret_refused')
  const qr = 'sezs1://ticket?e=speakez-sessions&t=ga&k=' + 'ab'.repeat(32)
  const scrubbed = scrubLog(`admit ${qr} ok`)
  assert.ok(!scrubbed.includes('ab'.repeat(32)))
  assert.match(scrubbed, /redacted/)
})

test('relay guard refuses Rotko production and any non-loopback host', () => {
  assert.equal(refuseRelayEndpoint('http://127.0.0.1:3053'), null)
  assert.equal(refuseRelayEndpoint('http://localhost:3053'), null)
  assert.match(refuseRelayEndpoint('https://zcash.rotko.net'), /production relay/)
  assert.match(refuseRelayEndpoint('https://relay.example.org'), /loopback/)
})

test('lab ZID provider seals and opens a ticket envelope; public blob has no secret', async () => {
  const storage = {
    _m: new Map(),
    getItem(k) { return this._m.get(k) || null },
    setItem(k, v) { this._m.set(k, v) },
  }
  const alice = await createLabZidProvider({ origin: 'http://127.0.0.1:3051', storage })
  const bobStorage = { _m: new Map(), getItem(k) { return this._m.get(k) || null }, setItem(k, v) { this._m.set(k, v) } }
  const bob = await createLabZidProvider({ origin: 'http://127.0.0.1:3051', storage: bobStorage })
  const material = await newTicketMaterial({ eventId: EVENT_ID, sku: DEFAULT_SKU })
  const rec = ticketRecord({ secret: material.secret, invoiceNonce: material.invoiceNonce, invoiceId: 'inv-lab' })
  const me = await labZidPubkey(alice)
  const box = await labEncryptFor(alice, me, encodeInner(innerPayload({
    secret: material.secret,
    eventId: rec.eventId,
    sku: rec.sku,
    invoiceNonce: rec.invoiceNonce,
    invoiceId: rec.invoiceId,
    commitmentHex: rec.commitmentHex,
  })))
  const pub = publicEnvelope({
    commitment: rec.commitmentHex,
    invoiceId: rec.invoiceId,
    ciphertext: box.ciphertext,
    ephemeral_pubkey: box.ephemeral_pubkey,
    pq_epoch: box.pq_epoch,
    origin: 'http://127.0.0.1:3051',
    postQuantum: box.postQuantum,
  })
  assert.equal(JSON.stringify(pub).includes(rec.secretHex), false)
  const s = { invoices: [{ id: rec.invoiceId, commitment: rec.commitmentHex }], envelopes: [], log: [] }
  assert.equal(putEnvelope(s, { secret: rec.secretHex, commitment: rec.commitmentHex, ciphertext: 'x' }).error, 'secret_refused')
  const stored = putEnvelope(s, pub)
  assert.equal(stored.ok, true)
  const got = getEnvelopes(s, rec.commitmentHex)
  assert.equal(got.envelopes.length, 1)
  const opened = decodeInner(await labDecryptFrom(alice, got.envelopes[0]))
  assert.equal(opened.secretHex, rec.secretHex)
  await assert.rejects(() => labDecryptFrom(bob, got.envelopes[0]))
  // transfer: alice re-seals to bob
  const bobPk = await labZidPubkey(bob)
  const xfer = await labEncryptFor(alice, bobPk, encodeInner(innerPayload({
    secret: material.secret,
    eventId: rec.eventId,
    sku: rec.sku,
    invoiceNonce: rec.invoiceNonce,
    invoiceId: rec.invoiceId,
    commitmentHex: rec.commitmentHex,
  })))
  const pub2 = publicEnvelope({
    commitment: rec.commitmentHex,
    invoiceId: rec.invoiceId,
    ciphertext: xfer.ciphertext,
    ephemeral_pubkey: xfer.ephemeral_pubkey,
    origin: 'http://127.0.0.1:3051',
    postQuantum: xfer.postQuantum,
  })
  assert.equal(putEnvelope(s, pub2).ok, true)
  assert.equal(getEnvelopes(s, rec.commitmentHex).envelopes.length, 2)
  const bobInner = decodeInner(await labDecryptFrom(bob, pub2))
  assert.equal(bobInner.commitmentHex, rec.commitmentHex)
  assert.equal(bobInner.secretHex, rec.secretHex)
  assert.ok(!memoOf(Uint8Array.from(rec.commitmentHex.match(/../g).map((x) => parseInt(x, 16)))).includes(rec.secretHex))
})
