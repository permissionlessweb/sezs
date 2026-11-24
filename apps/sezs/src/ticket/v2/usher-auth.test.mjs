import assert from 'node:assert/strict'
import { test } from 'node:test'
import { secp256k1 } from '@noble/curves/secp256k1'
import {
  encodeAuthMessage,
  decodeAuthMessage,
  signAuth,
  verifyAuth,
  proofHash,
  authBindsConsume,
} from './usher-auth.mjs'

const usher = 'terp1' + 'x'.repeat(38)
const fields = {
  usher,
  eventId: 'speakez-sessions',
  nullifier: 'ab'.repeat(32),
  root: 'cd'.repeat(32),
  proofHash: 'ef'.repeat(32),
  expiry: 1_800_000_000,
}

test('canonical auth message round-trips', () => {
  const { text, bytes } = encodeAuthMessage(fields)
  assert.match(text, /^SEZS-CONSUME-V3\n/)
  const got = decodeAuthMessage(bytes)
  assert.equal(got.usher, usher)
  assert.equal(got.eventId, 'speakez-sessions')
  assert.equal(got.nullifier, fields.nullifier)
  assert.equal(got.root, fields.root)
  assert.equal(got.proofHash, fields.proofHash)
  assert.equal(got.expiry, fields.expiry)
})

test('secp256k1 signature over the canonical message verifies', () => {
  const priv = secp256k1.utils.randomPrivateKey()
  const { bytes } = encodeAuthMessage(fields)
  const sig = signAuth(bytes, priv)
  assert.equal(verifyAuth(bytes, sig), true)
  const other = encodeAuthMessage({ ...fields, expiry: fields.expiry + 1 }).bytes
  assert.equal(verifyAuth(other, sig), false)
})

test('authBindsConsume checks expiry, nullifier, root, and proof hash', () => {
  const consume = {
    nullifier: fields.nullifier,
    root: fields.root,
    proof: new Uint8Array(32),
    proofHash: fields.proofHash,
    eventId: fields.eventId,
  }
  assert.equal(authBindsConsume(fields, consume, { now: fields.expiry - 10 }).ok, true)
  assert.equal(authBindsConsume(fields, consume, { now: fields.expiry + 1 }).error, 'expired')
  assert.equal(authBindsConsume(fields, { ...consume, nullifier: '11'.repeat(32) }, { now: 1 }).error, 'nullifier_mismatch')
  assert.equal(authBindsConsume(fields, { ...consume, root: '11'.repeat(32) }, { now: 1 }).error, 'root_mismatch')
})

test('proofHash is sha256 of the proof bytes', () => {
  const proof = new Uint8Array(8).map((_, i) => i + 1)
  const h = proofHash(proof)
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.equal(proofHash(h), proofHash(proof) === h ? proofHash(Buffer.from(h, 'hex')) : proofHash(proof))
  assert.equal(proofHash(proof), h)
})
