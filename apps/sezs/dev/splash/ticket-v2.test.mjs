// node --test dev/splash/ticket-v2.test.mjs   (needs scripts/build-ticket-v2-wasm.sh)
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTicketV2Node, ticketV2WasmAvailable } from '../../src/ticket/v2/node.mjs'
import { issueInvoiceV2, markPaidV2, markSeenV2, leavesV2, putEnvelopeV2, getEnvelopesV2, ensureV2, hexOf, hydrateV2, ingestPaidLeafV2, publicInvoiceV2 } from './ticket-v2.mjs'
import { loadTree } from './ticket-leaves.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRootPublisher, updateGuestRootMsg, cliSigner } from './root-publisher.mjs'

const haveWasm = ticketV2WasmAvailable()
const t2 = haveWasm ? loadTicketV2Node() : null
const EVENT = 'speakez-sessions'
const holder = () => {
  const secret = t2.newSecret() // stays in this "browser"; never passed to the backend
  return { secret, C: hexOf(t2.commitment(secret, 'ga', EVENT)) }
}
const fresh = () => ({ log: [] })

test('v2 invoice records only C, rail, sku, eventId and refuses correlators', async (tt) => {
  if (!haveWasm) { tt.skip('ticket v2 wasm not built; run apps/sezs/scripts/build-ticket-v2-wasm.sh'); return }

  const s = fresh()
  const { C } = holder()
  assert.deepEqual(issueInvoiceV2(s, { rail: 'zec', commitment: C, nullifier: 'aa'.repeat(32) }), { ok: false, error: 'v2_no_correlators', fields: ['nullifier'] })
  assert.equal(issueInvoiceV2(s, { rail: 'zec', commitment: C, ticketPubkey: 'bb'.repeat(32) }).error, 'v2_no_correlators')
  assert.equal(issueInvoiceV2(s, { rail: 'zec', commitment: C, secret: 'cc'.repeat(32) }).ok, false)
  const r = issueInvoiceV2(s, { rail: 'zec', commitment: C, sku: 'ga', eventId: EVENT })
  assert.equal(r.ok, true)
  const stored = s.v2.invoices[0]
  assert.deepEqual(Object.keys(stored).sort(), ['amountCents', 'commitment', 'dest', 'eventId', 'id', 'issuedAt', 'memo', 'paidAt', 'rail', 'sku', 'status', 'uri'].sort())
  assert.equal(issueInvoiceV2(s, { rail: "zec", commitment: C }).reused, true, "same C reuses")
  assert.equal(issueInvoiceV2(s, { rail: 'zec', commitment: holder().C, eventId: 'other-event' }).error, 'wrong_event')
})

test('paid leaves build the standard-Poseidon root; holder proves from the public list', async (tt) => {
  if (!haveWasm) { tt.skip('ticket v2 wasm not built; run apps/sezs/scripts/build-ticket-v2-wasm.sh'); return }

  const s = fresh()
  const hs = [holder(), holder(), holder()]
  for (const h of hs) {
    const inv = issueInvoiceV2(s, { rail: 'zec', commitment: h.C }).invoice
    assert.equal(markPaidV2(s, h.C, { amountCents: inv.amountCents + 1 }).error, 'amount_mismatch')
    assert.equal(markPaidV2(s, h.C, { amountCents: inv.amountCents }).ok, true)
  }
  const L = leavesV2(s)
  assert.equal(L.leafCount, 3)
  assert.equal(L.root, hexOf(t2.treeRoot(L.leaves)))
  assert.equal(L.suite, 'P128Pow5T3')
  assert.equal(JSON.stringify(L).includes('invoice'), false, 'leaf list carries no invoice link')
  const p = t2.prove({ secret: hs[1].secret, sku: 'ga', eventId: EVENT, domain: 'http://127.0.0.1:3051', leaves: L.leaves })
  assert.equal(hexOf(p.root), L.root)
  assert.equal(p.leafIndex, 1)
  assert.equal(t2.verifyBundle({ bundle: p.bundle, eventId: EVENT, domain: 'http://127.0.0.1:3051' }), true)
})

test('sealed backup by invoice id only', async (tt) => {
  if (!haveWasm) { tt.skip('ticket v2 wasm not built; run apps/sezs/scripts/build-ticket-v2-wasm.sh'); return }

  const s = fresh()
  const { C } = holder()
  const inv = issueInvoiceV2(s, { rail: 'penumbra', commitment: C }).invoice
  assert.equal(putEnvelopeV2(s, { commitment: C, ciphertext: 'x' }).error, 'v2_envelope_by_invoice_only')
  assert.equal(putEnvelopeV2(s, { invoiceId: inv.id, ciphertext: 'sealed' }).ok, true)
  assert.equal(getEnvelopesV2(s, C).error, 'v2_envelope_by_invoice_only')
  assert.equal(getEnvelopesV2(s, inv.id).envelopes.length, 1)
  assert.equal(putEnvelopeV2(s, { invoiceId: inv.id, plaintext: 'no' }).ok, false)
})

test('root publisher cadence, monotonic epochs, unchanged root skipped', async (tt) => {
  if (!haveWasm) { tt.skip('ticket v2 wasm not built; run apps/sezs/scripts/build-ticket-v2-wasm.sh'); return }

  const s = fresh()
  ensureV2(s)
  const sent = []
  let now = 1_000_000
  const signer = { execute: async (contract, msg) => (sent.push({ contract, msg }), { ok: true, txhash: 'AB'.repeat(32), height: 9 }) }
  const pub = createRootPublisher({ signer, contract: 'terp1manifold', clock: () => now })
  const pay = () => { const h = holder(); issueInvoiceV2(s, { rail: 'zec', commitment: h.C }); markPaidV2(s, h.C) }
  pay()
  assert.equal((await pub.maybePublish(s)).published, true)
  assert.equal((await pub.maybePublish(s)).skipped, 'root_unchanged')
  pay()
  now += 60_000
  assert.equal((await pub.maybePublish(s)).skipped, 'interval')
  assert.equal((await pub.maybePublish(s, 'doors-open')).published, true)
  pay()
  now += 15 * 60 * 1000
  const r = await pub.maybePublish(s)
  assert.equal(r.published, true)
  assert.deepEqual(sent.map((x) => x.msg.update_guest_root.epoch), [1, 2, 3])
  assert.deepEqual(sent[2].msg, updateGuestRootMsg({ root: s.v2.root, leafCount: 3, epoch: 3 }))
  assert.equal(leavesV2(s).published.epoch, 3)
})

test('lab signer refuses non-loopback nodes', async (tt) => {
  if (!haveWasm) { tt.skip('ticket v2 wasm not built; run apps/sezs/scripts/build-ticket-v2-wasm.sh'); return }

  assert.throws(() => cliSigner({ terpd: 'terpd', home: '/tmp/x', keyName: 'admin', node: 'tcp://rpc.terp.network:26657', chainId: 'x' }), /non-loopback/)
})


test('paid leaves persist under the session root and rebuild after a restart', async (tt) => {
  if (!haveWasm) { tt.skip('ticket v2 wasm not built; run apps/sezs/scripts/build-ticket-v2-wasm.sh'); return }

  const root = mkdtempSync(join(tmpdir(), 'sezs-v2-persist-'))
  const prev = process.env.SEZS_SESSION_ROOT
  process.env.SEZS_SESSION_ROOT = root
  try {
    const s1 = {}
    const c = holder().C
    const issued = issueInvoiceV2(s1, { rail: 'zec', commitment: c, eventId: EVENT })
    assert.equal(issued.ok, true)
    const paid = markPaidV2(s1, c)
    assert.equal(paid.ok, true)
    const disk = loadTree(root)
    assert.ok(disk.leaves.includes(c))
    const s2 = {}
    hydrateV2(s2)
    const leaves = leavesV2(s2)
    assert.equal(leaves.leafCount, 1)
    assert.deepEqual(leaves.leaves, [c])
  } finally {
    if (prev == null) delete process.env.SEZS_SESSION_ROOT
    else process.env.SEZS_SESSION_ROOT = prev
    rmSync(root, { recursive: true, force: true })
  }
})

test('ingestPaidLeafV2 rebuilds a leaf from chain history without a live invoice', async (tt) => {
  if (!haveWasm) { tt.skip('ticket v2 wasm not built; run apps/sezs/scripts/build-ticket-v2-wasm.sh'); return }

  const root = mkdtempSync(join(tmpdir(), 'sezs-v2-rebuild-'))
  const prev = process.env.SEZS_SESSION_ROOT
  process.env.SEZS_SESSION_ROOT = root
  try {
    const c = holder().C
    const s = {}
    const r = ingestPaidLeafV2(s, { commitment: c, txid: 'abcd'.repeat(16), rail: 'zec', height: 12 })
    assert.equal(r.ok, true)
    assert.equal(r.rebuilt, true)
    const s2 = {}
    hydrateV2(s2)
    assert.deepEqual(leavesV2(s2).leaves, [c])
  } finally {
    if (prev == null) delete process.env.SEZS_SESSION_ROOT
    else process.env.SEZS_SESSION_ROOT = prev
    rmSync(root, { recursive: true, force: true })
  }
})

test('markSeenV2 records mempool without paying or appending a leaf', async (tt) => {
  if (!haveWasm) { tt.skip('ticket v2 wasm not built; run apps/sezs/scripts/build-ticket-v2-wasm.sh'); return }

  const root = mkdtempSync(join(tmpdir(), 'sezs-v2-seen-'))
  const prev = process.env.SEZS_SESSION_ROOT
  process.env.SEZS_SESSION_ROOT = root
  try {
    const c = holder().C
    const s = {}
    const issued = issueInvoiceV2(s, { rail: 'zec', commitment: c, sku: 'ga', eventId: EVENT })
    assert.equal(issued.ok, true)
    const seen = markSeenV2(s, c, { txid: 'ab'.repeat(32) })
    assert.equal(seen.ok, true)
    assert.equal(seen.paid, false)
    assert.equal(seen.invoice.phase, 'Mempool')
    assert.equal(seen.invoice.status, 'pending')
    assert.deepEqual(leavesV2(s).leaves, [])
    const paid = markPaidV2(s, c)
    assert.equal(paid.ok, true)
    assert.equal(paid.invoice.phase, 'Settled')
    assert.equal(paid.invoice.status, 'paid')
  } finally {
    if (prev == null) delete process.env.SEZS_SESSION_ROOT
    else process.env.SEZS_SESSION_ROOT = prev
    rmSync(root, { recursive: true, force: true })
  }
})
