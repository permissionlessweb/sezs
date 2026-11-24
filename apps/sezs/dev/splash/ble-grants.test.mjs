import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { secp256k1 } from '@noble/curves/secp256k1'
import { encodeGrant, encodeFrame, encodeConsumeDevice, newDeviceKey, signFrame, newNonce, hex } from '../../src/ble/messages.mjs'
import { newAdmin, signAdr036, terpAddress } from '../../src/ble/lab-sign.mjs'
import { openGrantStore, checkStoredChain } from './ble-grants.mjs'
import { BLE_ERRORS } from '../../src/ble/verify.mjs'

const eventId = 'speakez-sessions'
const body = 'sezs3qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
const now = 1_800_000_000
const expiry = now + 3600

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sezs-ble-'))
  const store = openGrantStore(join(dir, 'ble-grants.json'))
  const admin = newAdmin()
  const usherKey = secp256k1.utils.randomPrivateKey()
  const usher = terpAddress(usherKey)
  const device = newDeviceKey()
  const g = encodeGrant({
    deviceSignPubkey: device.publicHex,
    deviceNoiseStatic: hex(crypto.getRandomValues(new Uint8Array(32))),
    usher,
    eventId,
    expiry,
    nonce: newNonce(),
  })
  const adminSig = signAdr036(admin.address, g.bytes, admin.secret)
  const isAdmin = (a) => a === admin.address
  const isUsher = (a) => a === usher
  return { store, admin, adminSig, usher, usherKey, device, g, isAdmin, isUsher }
}

test('store accepts a good grant, lists it, renames, and revokes', async () => {
  const s = fixture()
  const put = await s.store.putGrant({
    grantText: s.g.text, adminSig: s.adminSig, admin: s.admin.address, label: 'door-north', isAdmin: s.isAdmin, now,
  })
  assert.equal(put.ok, true, put.error)
  assert.equal(put.grant.label, 'door-north')
  assert.equal(s.store.list().length, 1)
  assert.equal(s.store.rename(s.g.hash, 'floor-2').grant.label, 'floor-2')
  const rev = s.store.revoke(s.g.hash)
  assert.equal(rev.deleted, true)
  assert.equal(s.store.list().length, 0)
  const again = await s.store.putGrant({
    grantText: s.g.text, adminSig: s.adminSig, admin: s.admin.address, isAdmin: s.isAdmin, now,
  })
  assert.equal(again.ok, true, again.error)
  assert.equal(s.store.list().length, 1)
})

test('checkStoredChain admits once and refuses a replayed counter', async () => {
  const s = fixture()
  await s.store.putGrant({
    grantText: s.g.text, adminSig: s.adminSig, admin: s.admin.address, isAdmin: s.isAdmin, now,
  })
  const frame = encodeFrame({
    grantHash: s.g.hash, deviceSignPubkey: s.device.publicHex, eventId, seq: 1, ts: now, payload: body,
  })
  const sig = signFrame(frame.bytes, s.device.secret)
  const consume = { proof: '00', nullifier: 'ab'.repeat(32), root: 'cd'.repeat(32), proofHash: 'ef'.repeat(32), eventId }
  const authText = encodeConsumeDevice({
    usher: s.usher, eventId, nullifier: consume.nullifier, root: consume.root, proofHash: consume.proofHash,
    expiry, grantHash: s.g.hash, frameHash: frame.hash, frameSig: sig, frameSeq: 1,
  })
  const auth = signAdr036(s.usher, authText.bytes, s.usherKey)
  const bodyReq = { consume, auth: { ...auth, message: authText.text }, frameText: frame.text, frameSig: sig, grantHash: s.g.hash }
  const first = await checkStoredChain(s.store, bodyReq, { isAdmin: s.isAdmin, isUsher: s.isUsher, now, expectedEvent: eventId })
  assert.equal(first.ok, true, first.error)
  const second = await checkStoredChain(s.store, bodyReq, { isAdmin: s.isAdmin, isUsher: s.isUsher, now, expectedEvent: eventId })
  assert.equal(second.ok, false)
  assert.equal(second.error, BLE_ERRORS.replayed_frame)
})

test('forged frame (wrong device key) is refused', async () => {
  const s = fixture()
  await s.store.putGrant({
    grantText: s.g.text, adminSig: s.adminSig, admin: s.admin.address, isAdmin: s.isAdmin, now,
  })
  const other = newDeviceKey()
  const frame = encodeFrame({
    grantHash: s.g.hash, deviceSignPubkey: s.device.publicHex, eventId, seq: 1, ts: now, payload: body,
  })
  const sig = signFrame(frame.bytes, other.secret)
  const consume = { proof: '00', nullifier: 'ab'.repeat(32), root: 'cd'.repeat(32), proofHash: 'ef'.repeat(32), eventId }
  const authText = encodeConsumeDevice({
    usher: s.usher, eventId, nullifier: consume.nullifier, root: consume.root, proofHash: consume.proofHash,
    expiry, grantHash: s.g.hash, frameHash: frame.hash, frameSig: sig, frameSeq: 1,
  })
  const auth = signAdr036(s.usher, authText.bytes, s.usherKey)
  const r = await checkStoredChain(s.store, {
    consume, auth: { ...auth, message: authText.text }, frameText: frame.text, frameSig: sig,
  }, { isAdmin: s.isAdmin, isUsher: s.isUsher, now, expectedEvent: eventId })
  assert.equal(r.ok, false)
  assert.equal(r.error, BLE_ERRORS.bad_frame_sig)
})

test('expired grants are dropped from the store', async () => {
  const s = fixture()
  const put = await s.store.putGrant({
    grantText: s.g.text, adminSig: s.adminSig, admin: s.admin.address, isAdmin: s.isAdmin, now,
  })
  assert.equal(put.ok, true, put.error)
  const raw = JSON.parse(readFileSync(s.store.persistPath, 'utf8'))
  raw.grants[s.g.hash].grant.expiry = Math.floor(Date.now() / 1000) - 10
  writeFileSync(s.store.persistPath, JSON.stringify(raw) + '\n')
  assert.equal(s.store.list().length, 0)
  assert.equal(s.store.get(s.g.hash), null)
})
