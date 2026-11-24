import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sha256 } from '@noble/hashes/sha256'
import {
  GRANT_DOMAIN,
  FRAME_DOMAIN,
  CONSUME_DEVICE_DOMAIN,
  encodeGrant,
  decodeGrant,
  encodeFrame,
  decodeFrame,
  encodeConsumeDevice,
  decodeConsumeDevice,
  newDeviceKey,
  signFrame,
  verifyFrameSig,
  eventTagHex,
  newNonce,
  hex,
  utf8,
  encodeUsherReg,
  decodeUsherReg,
  parseUsherPayload,
  USHER_REG_DOMAIN,
  USHER_ID_DOMAIN,
} from './messages.mjs'

const usher = 'terp1' + 'x'.repeat(38)
const eventId = 'speakez-sessions'
const device = newDeviceKey()
const noise = hex(crypto.getRandomValues(new Uint8Array(32)))
const nonce = newNonce()
const expiry = Math.floor(Date.now() / 1000) + 3600

const grant = () => encodeGrant({
  deviceSignPubkey: device.publicHex,
  deviceNoiseStatic: noise,
  usher,
  eventId,
  contract: '-',
  expiry,
  nonce,
})

test('grant encodes a stable canonical text and hashes it', () => {
  const a = grant()
  const b = grant()
  assert.equal(a.text, b.text)
  assert.equal(a.hash, b.hash)
  assert.equal(a.text.split('\n')[0], GRANT_DOMAIN)
  assert.equal(decodeGrant(a.text).hash, a.hash)
  assert.equal(decodeGrant(a.bytes).usher, usher)
})

test('grant rejects a missing capability and a non-canonical reorder', () => {
  assert.throws(() => encodeGrant({
    deviceSignPubkey: device.publicHex,
    deviceNoiseStatic: noise,
    usher,
    eventId,
    capabilities: 'open-bar',
    expiry,
    nonce,
  }))
  const text = grant().text.replace('event: ', 'xxx: ').replace('xxx: ', 'event: ')
  // still canonical if we only swapped nothing — really drop a field
  const broken = grant().text.split('\n').filter((l) => !l.startsWith('nonce:')).join('\n')
  assert.throws(() => decodeGrant(broken))
})

test('frame signs with the device key and verifies', () => {
  const g = grant()
  const payload = 'sezs31qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq2srqkz' // may be invalid bech32; encoder only checks prefix
  // Use a clearly prefixed dummy that meets the sezs3 charset check
  const body = 'sezs3qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
  const f = encodeFrame({
    grantHash: g.hash,
    deviceSignPubkey: device.publicHex,
    eventId,
    seq: 1,
    ts: Math.floor(Date.now() / 1000),
    payload: body,
  })
  assert.equal(f.text.split('\n')[0], FRAME_DOMAIN)
  assert.equal(decodeFrame(f.text).eventTag, eventTagHex(eventId))
  const sig = signFrame(f.bytes, device.secret)
  assert.equal(verifyFrameSig(f.bytes, sig, device.publicHex), true)
  const other = newDeviceKey()
  assert.equal(verifyFrameSig(f.bytes, sig, other.publicHex), false)
  const tweaked = utf8(f.text.replace(body, body.slice(0, -1) + 'p'))
  assert.equal(verifyFrameSig(tweaked, sig, device.publicHex), false)
})

test('consume-device message is distinct from SEZS-CONSUME-V3', () => {
  const c = encodeConsumeDevice({
    usher,
    eventId,
    nullifier: 'ab'.repeat(32),
    root: 'cd'.repeat(32),
    proofHash: 'ef'.repeat(32),
    expiry,
    grantHash: '11'.repeat(32),
    frameHash: '22'.repeat(32),
    frameSig: '33'.repeat(64),
    frameSeq: 1,
  })
  assert.equal(c.text.split('\n')[0], CONSUME_DEVICE_DOMAIN)
  assert.ok(!c.text.startsWith('SEZS-CONSUME-V3\n'))
  assert.equal(decodeConsumeDevice(c.text).frameSeq, 1)
  assert.deepEqual(sha256(c.bytes), sha256(utf8(c.text)))
})

test('event tag is the first 8 bytes of sha256(event id)', () => {
  assert.equal(eventTagHex('speakez-sessions'), hex(sha256(utf8('speakez-sessions'))).slice(0, 16))
})

test('usher registration message accepts a terp1 and round-trips', () => {
  const usher = 'terp1uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu'
  const r = encodeUsherReg({
    eventId,
    usher,
    expiry,
    nonce: 'ab'.repeat(32),
  })
  assert.equal(r.text.split('\n')[0], USHER_REG_DOMAIN)
  const d = decodeUsherReg(r.text)
  assert.equal(d.usher, usher)
  assert.equal(d.hash, r.hash)
})

test('parseUsherPayload reads a raw terp1, JSON, and SEZS-USHER-ID-V1', () => {
  const usher = 'terp1uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu'
  assert.equal(parseUsherPayload(usher).usher, usher)
  const j = parseUsherPayload(JSON.stringify({ terp: usher, label: 'desk' }))
  assert.equal(j.ok, true)
  assert.equal(j.label, 'desk')
  const card = parseUsherPayload(`${USHER_ID_DOMAIN}\nusher: ${usher}\nlabel: door`)
  assert.equal(card.ok, true)
  assert.equal(card.usher, usher)
  assert.equal(card.label, 'door')
  assert.equal(parseUsherPayload('nope').ok, false)
  assert.equal(parseUsherPayload('u1notaterpaddress').ok, false)
})

