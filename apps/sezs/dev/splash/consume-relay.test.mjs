import assert from 'node:assert/strict'
import { test } from 'node:test'
import { secp256k1 } from '@noble/curves/secp256k1'
import { encodeAuthMessage, signAuth, proofHash } from '../../src/ticket/v2/usher-auth.mjs'
import { relayChecks, rememberNullifier, relayErrors, doorNoteFor } from './consume-relay.mjs'

const usher = 'terp1' + 'y'.repeat(38)
const other = 'terp1' + 'z'.repeat(38)
const proof = new Uint8Array(64).map((_, i) => i)
const consume = {
  proof,
  root: 'cd'.repeat(32),
  nullifier: 'ab'.repeat(32),
  eventId: 'speakez-sessions',
  proofHash: proofHash(proof),
  consent: { printed: { sig: 'aa' } },
}

const signed = (priv, extra = {}) => {
  const { text, bytes } = encodeAuthMessage({
    usher,
    eventId: consume.eventId,
    nullifier: consume.nullifier,
    root: consume.root,
    proofHash: consume.proofHash,
    expiry: 1_800_000_000,
    ...extra,
  })
  const sig = signAuth(bytes, priv)
  return { bytes, text, ...sig, signer: usher }
}

test('relay accepts a live usher with a valid unexpired signature', async () => {
  const priv = secp256k1.utils.randomPrivateKey()
  const auth = signed(priv)
  const r = await relayChecks({
    consume,
    auth,
    now: 1_799_999_000,
    isUsher: (a) => a === usher,
    seenNullifiers: new Set(),
    proofOk: () => true,
  })
  assert.equal(r.ok, true)
  assert.equal(r.signer, usher)
})

test('relay refuses a non-usher', async () => {
  const priv = secp256k1.utils.randomPrivateKey()
  const r = await relayChecks({
    consume,
    auth: signed(priv),
    now: 1,
    isUsher: (a) => a === other,
    seenNullifiers: new Set(),
    proofOk: () => true,
  })
  assert.equal(r.ok, false)
  assert.equal(r.error, relayErrors.non_usher)
})

test('relay refuses an expired authorization', async () => {
  const priv = secp256k1.utils.randomPrivateKey()
  const r = await relayChecks({
    consume,
    auth: signed(priv, { expiry: 100 }),
    now: 200,
    isUsher: () => true,
    seenNullifiers: new Set(),
    proofOk: () => true,
  })
  assert.equal(r.ok, false)
  assert.equal(r.error, relayErrors.expired)
})

test('relay refuses a replayed nullifier', async () => {
  const priv = secp256k1.utils.randomPrivateKey()
  const seen = rememberNullifier(new Set(), consume.nullifier)
  const r = await relayChecks({
    consume,
    auth: signed(priv),
    now: 1,
    isUsher: () => true,
    seenNullifiers: seen,
    proofOk: () => true,
  })
  assert.equal(r.ok, false)
  assert.equal(r.error, relayErrors.replay)
})

test('relay refuses a bad proof', async () => {
  const priv = secp256k1.utils.randomPrivateKey()
  const r = await relayChecks({
    consume,
    auth: signed(priv),
    now: 1,
    isUsher: () => true,
    seenNullifiers: new Set(),
    proofOk: () => false,
  })
  assert.equal(r.ok, false)
  assert.equal(r.error, relayErrors.bad_proof)
})

test('relay refuses a signature over a different message', async () => {
  const priv = secp256k1.utils.randomPrivateKey()
  const auth = signed(priv)
  const otherMsg = encodeAuthMessage({
    usher,
    eventId: consume.eventId,
    nullifier: consume.nullifier,
    root: consume.root,
    proofHash: consume.proofHash,
    expiry: 1_900_000_000,
  })
  const r = await relayChecks({
    consume,
    auth: { ...auth, bytes: otherMsg.bytes, message: otherMsg.bytes },
    now: 1,
    isUsher: () => true,
    seenNullifiers: new Set(),
    proofOk: () => true,
  })
  assert.equal(r.ok, false)
  assert.equal(r.error, relayErrors.bad_signature)
})

test('door notes stay plain', () => {
  assert.equal(doorNoteFor('', { ok: true }), 'Admitted. A second scan will be refused.')
  assert.equal(doorNoteFor('replay'), 'Already admitted.')
  assert.equal(doorNoteFor('nullifier already spent: execute wasm contract failed'), 'Already admitted.')
  assert.equal(doorNoteFor('unknown or historical root is missing: execute wasm contract failed [ <workspace> ]'), 'Not on the guest list.')
  assert.equal(doorNoteFor('rpc error: code = Unknown desc = boom'), 'Please try again.')
})
