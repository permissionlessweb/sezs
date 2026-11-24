import assert from 'node:assert/strict'
import { test } from 'node:test'
import { secp256k1 } from '@noble/curves/secp256k1'
import { verifyAdr036 } from '../ticket/v2/adr036.mjs'
import { signAuth } from '../ticket/v2/usher-auth.mjs'
import {
  encodeGrant,
  encodeFrame,
  encodeConsumeDevice,
  newDeviceKey,
  signFrame,
  newNonce,
  hex,
} from './messages.mjs'
import { newAdmin, signAdr036, terpAddress } from './lab-sign.mjs'
import { verifyGrant, verifyFrame, verifyDeviceChain, BLE_ERRORS } from './verify.mjs'

const eventId = 'speakez-sessions'
const body = 'sezs3qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
const now = 1_800_000_000
const expiry = now + 3600

const setup = () => {
  const admin = newAdmin()
  const usherKey = secp256k1.utils.randomPrivateKey()
  const usher = terpAddress(usherKey)
  const device = newDeviceKey()
  const noise = hex(crypto.getRandomValues(new Uint8Array(32)))
  const g = encodeGrant({
    deviceSignPubkey: device.publicHex,
    deviceNoiseStatic: noise,
    usher,
    eventId,
    expiry,
    nonce: newNonce(),
  })
  const adminSig = signAdr036(admin.address, g.bytes, admin.secret)
  const frameAt = (seq, extra = {}) => {
    const f = encodeFrame({
      grantHash: g.hash,
      deviceSignPubkey: device.publicHex,
      eventId,
      seq,
      ts: now,
      payload: body,
      ...extra,
    })
    return { ...f, sig: signFrame(f.bytes, device.secret) }
  }
  const consume = {
    proof: '00',
    nullifier: 'ab'.repeat(32),
    root: 'cd'.repeat(32),
    proofHash: 'ef'.repeat(32),
    eventId,
  }
  const consumeAuth = (frame, usherSigKey = usherKey) => {
    const c = encodeConsumeDevice({
      usher,
      eventId,
      nullifier: consume.nullifier,
      root: consume.root,
      proofHash: consume.proofHash,
      expiry,
      grantHash: g.hash,
      frameHash: frame.hash,
      frameSig: frame.sig,
      frameSeq: frame.seq ?? 1,
    })
    const auth = signAdr036(usher, c.bytes, usherSigKey)
    return { ...c, auth }
  }
  return { admin, usher, usherKey, device, g, adminSig, frameAt, consume, consumeAuth }
}

test('adr036 helper round-trips against verifyAdr036', () => {
  const a = newAdmin()
  const data = new TextEncoder().encode('hello')
  const sig = signAdr036(a.address, data, a.secret)
  assert.equal(verifyAdr036('terp', a.address, data, sig), true)
})

test('good grant is accepted', async () => {
  const s = setup()
  const r = await verifyGrant({
    grantText: s.g.text,
    adminSig: s.adminSig,
    admin: s.admin.address,
    now,
    isAdmin: (addr) => addr === s.admin.address,
  })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.grant.hash, s.g.hash)
})

test('bad admin signature is refused', async () => {
  const s = setup()
  const other = newAdmin()
  const bad = signAdr036(other.address, s.g.bytes, other.secret)
  const r = await verifyGrant({
    grantText: s.g.text,
    adminSig: bad,
    admin: s.admin.address, // claimed admin does not match the signature
    now,
    isAdmin: () => true,
  })
  assert.equal(r.ok, false)
  assert.equal(r.error, BLE_ERRORS.bad_admin_sig)
})

test('revoked device is refused', async () => {
  const s = setup()
  const r = await verifyGrant({
    grantText: s.g.text,
    adminSig: s.adminSig,
    admin: s.admin.address,
    status: 'revoked',
    now,
    isAdmin: () => true,
  })
  assert.equal(r.ok, false)
  assert.equal(r.error, BLE_ERRORS.revoked_device)
})

test('expired grant is refused', async () => {
  const s = setup()
  const r = await verifyGrant({
    grantText: s.g.text,
    adminSig: s.adminSig,
    admin: s.admin.address,
    now: expiry + 1,
    isAdmin: () => true,
  })
  assert.equal(r.ok, false)
  assert.equal(r.error, BLE_ERRORS.expired_grant)
})

test('wrong event is refused on the grant and on the frame', async () => {
  const s = setup()
  const g = await verifyGrant({
    grantText: s.g.text,
    adminSig: s.adminSig,
    admin: s.admin.address,
    expectedEvent: 'other-event',
    now,
    isAdmin: () => true,
  })
  assert.equal(g.ok, false)
  assert.equal(g.error, BLE_ERRORS.wrong_event)

  const okG = await verifyGrant({
    grantText: s.g.text,
    adminSig: s.adminSig,
    admin: s.admin.address,
    now,
    isAdmin: () => true,
  })
  const f = verifyFrame({
    grant: okG.grant,
    frameText: s.frameAt(1).text,
    frameSig: s.frameAt(1).sig,
    now,
    expectedEvent: 'other-event',
  })
  // A new sign each call — use one frame
  const one = s.frameAt(1)
  const f2 = verifyFrame({
    grant: okG.grant,
    frameText: one.text,
    frameSig: one.sig,
    now,
    expectedEvent: 'other-event',
  })
  assert.equal(f2.ok, false)
  assert.equal(f2.error, BLE_ERRORS.wrong_event)
})

test('replayed frame counter is refused', async () => {
  const s = setup()
  const one = s.frameAt(1)
  const g = (await verifyGrant({
    grantText: s.g.text, adminSig: s.adminSig, admin: s.admin.address, now, isAdmin: () => true,
  })).grant
  const first = verifyFrame({ grant: g, frameText: one.text, frameSig: one.sig, lastSeq: 0, now })
  assert.equal(first.ok, true, first.error)
  const again = verifyFrame({ grant: g, frameText: one.text, frameSig: one.sig, lastSeq: 1, now })
  assert.equal(again.ok, false)
  assert.equal(again.error, BLE_ERRORS.replayed_frame)
  const seen = new Set([`${s.g.hash}:1`])
  const seenHit = verifyFrame({ grant: g, frameText: one.text, frameSig: one.sig, lastSeq: 0, seen, now })
  assert.equal(seenHit.ok, false)
  assert.equal(seenHit.error, BLE_ERRORS.replayed_frame)
})

test('tampered payload fails the device signature', async () => {
  const s = setup()
  const one = s.frameAt(1)
  const g = (await verifyGrant({
    grantText: s.g.text, adminSig: s.adminSig, admin: s.admin.address, now, isAdmin: () => true,
  })).grant
  const tweaked = encodeFrame({
    grantHash: s.g.hash,
    deviceSignPubkey: s.device.publicHex,
    eventId,
    seq: 1,
    ts: now,
    payload: body.slice(0, -1) + 'p',
  })
  const r = verifyFrame({ grant: g, frameText: tweaked.text, frameSig: one.sig, now })
  assert.equal(r.ok, false)
  assert.equal(r.error, BLE_ERRORS.bad_frame_sig)
})

test('full chain admits a good ticket and binds grant, frame, and consume', async () => {
  const s = setup()
  const one = s.frameAt(1)
  const c = s.consumeAuth(one)
  const r = await verifyDeviceChain({
    grantText: s.g.text,
    adminSig: s.adminSig,
    admin: s.admin.address,
    status: 'active',
    frameText: one.text,
    frameSig: one.sig,
    lastSeq: 0,
    consume: s.consume,
    consumeAuthText: c.text,
    auth: c.auth,
    expectedEvent: eventId,
    now,
    isAdmin: (addr) => addr === s.admin.address,
    isUsher: (addr) => addr === s.usher,
  })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.replayKey, `${s.g.hash}:1`)
})

test('lab secp256k1-sha256 usher auth is accepted on the consume only', async () => {
  const s = setup()
  const one = s.frameAt(1)
  const c = encodeConsumeDevice({
    usher: s.usher,
    eventId,
    nullifier: s.consume.nullifier,
    root: s.consume.root,
    proofHash: s.consume.proofHash,
    expiry,
    grantHash: s.g.hash,
    frameHash: one.hash,
    frameSig: one.sig,
    frameSeq: 1,
  })
  const signed = signAuth(c.bytes, s.usherKey)
  const r = await verifyDeviceChain({
    grantText: s.g.text,
    adminSig: s.adminSig,
    admin: s.admin.address,
    frameText: one.text,
    frameSig: one.sig,
    consume: s.consume,
    consumeAuthText: c.text,
    auth: { ...signed, signer: s.usher },
    now,
    isAdmin: () => true,
    isUsher: () => true,
  })
  assert.equal(r.ok, true, r.error)
})
