// node --test src/ticket/v2/ticket-v2.test.mjs   (needs scripts/build-ticket-v2-wasm.sh)
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTicketV2Node, ticketV2WasmAvailable } from './node.mjs'

const haveWasm = ticketV2WasmAvailable()
const t = haveWasm ? loadTicketV2Node() : null
const E = 'speakez-sessions', D = 'http://127.0.0.1:3051'
const hex = (b) => Buffer.from(b).toString('hex')

test('circuit info and vk hash (compare with on-chain footer vk_hash)', async (tt) => {
  if (!haveWasm) { tt.skip('ticket v2 wasm not built; run apps/sezs/scripts/build-ticket-v2-wasm.sh'); return }

  assert.deepEqual(t.info(), { circuit: 'sezs_consume_v2', depth: 10, k: 11, numPublic: 6, bundleVersion: 2 })
  assert.match(t.vkHash(), /^[0-9a-f]{64}$/)
})

test('prove, local verify, live + printed consent under rk', async (tt) => {
  if (!haveWasm) { tt.skip('ticket v2 wasm not built; run apps/sezs/scripts/build-ticket-v2-wasm.sh'); return }

  const secret = t.newSecret()
  const C = t.commitment(secret, 'ga', E)
  assert.match(t.memo(C), /^sezs1:[0-9a-f]{64}$/)
  const leaves = [t.newSecret(), C, t.newSecret()]
  const p = t.prove({ secret, sku: 'ga', eventId: E, domain: D, leaves })
  assert.equal(p.bundle.length, 4321)
  assert.equal(hex(p.nullifier), hex(t.nullifier(secret, E)))
  assert.equal(t.verifyBundle({ bundle: p.bundle, eventId: E, domain: D }), true)
  const f = t.consumeFields(p.bundle)
  const ch = t.liveChallenge({ eventId: E, domain: D, usher: 'terp1usher' })
  assert.equal(t.parseChallenge(ch).usher, 'terp1usher')
  const sig = t.signLive({ secret, eventId: E, domain: D, alphaNonce: p.alphaNonce, challenge: ch })
  assert.equal(t.verifyConsent({ rk: f.rk, message: ch, sig }), true)
  const wrong = t.liveChallenge({ eventId: 'other-event', domain: D, usher: 'terp1usher' })
  assert.throws(() => t.signLive({ secret, eventId: E, domain: D, alphaNonce: p.alphaNonce, challenge: wrong }), /another event/)
  const ps = t.signPrinted({ secret, eventId: E, domain: D, alphaNonce: p.alphaNonce, nullifier: p.nullifier, doorAuthPubkey: 'door' })
  assert.equal(t.verifyConsent({ rk: f.rk, message: t.printedMessage({ eventId: E, domain: D, nullifier: p.nullifier, doorAuthPubkey: 'door' }), sig: ps }), true)
  // two proofs of one ticket: same N, unlinkable rk
  const p2 = t.prove({ secret, sku: 'ga', eventId: E, domain: D, leaves })
  assert.equal(hex(p2.nullifier), hex(p.nullifier))
  assert.notEqual(t.consumeFields(p2.bundle).rk, f.rk)
})

test('unpaid ticket cannot prove', async (tt) => {
  if (!haveWasm) { tt.skip('ticket v2 wasm not built; run apps/sezs/scripts/build-ticket-v2-wasm.sh'); return }

  assert.throws(() => t.prove({ secret: t.newSecret(), sku: 'ga', eventId: E, domain: D, leaves: [t.newSecret()] }), /not in this leaf list/)
})
