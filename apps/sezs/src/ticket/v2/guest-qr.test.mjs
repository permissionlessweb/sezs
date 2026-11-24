import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sha256 } from '@noble/hashes/sha256'
import {
  GUEST_QR_CHAR_BUDGET,
  GUEST_QR_VERSION,
  encodeGuestQr,
  encodeGuestQrBytes,
  decodeGuestQrText,
  decodeGuestQrBytes,
  parseGuestQr,
  eventTag,
  eventTagMatches,
  guestQrSize,
  DEFAULT_SKU,
} from './guest-qr.mjs'

const secret = sha256(new TextEncoder().encode('sezs-guest-qr-test-secret'))
const eventId = 'speakez-sessions'

test('encodes a default-sku ticket within the Version 4 QR budget', () => {
  const text = encodeGuestQr({ secret, sku: DEFAULT_SKU, eventId })
  assert.match(text, /^sezs31[a-z0-9]+$/)
  const size = guestQrSize(text)
  assert.equal(size.withinBudget, true)
  assert.ok(size.chars <= GUEST_QR_CHAR_BUDGET, `chars ${size.chars} > ${GUEST_QR_CHAR_BUDGET}`)
  const raw = encodeGuestQrBytes({ secret, sku: DEFAULT_SKU, eventId })
  assert.equal(raw[0], GUEST_QR_VERSION)
  assert.equal(raw.length, 42)
})

test('round-trips secret, sku, and event tag', () => {
  const text = encodeGuestQr({ secret, sku: DEFAULT_SKU, eventId })
  const got = decodeGuestQrText(text)
  assert.equal(got.version, 3)
  assert.deepEqual(got.secret, secret)
  assert.equal(got.sku, DEFAULT_SKU)
  assert.equal(eventTagMatches(eventId, got.eventTag), true)
  assert.equal(eventTagMatches('other-event', got.eventTag), false)
})

test('includes a non-default sku and still fits the budget', () => {
  const text = encodeGuestQr({ secret, sku: 'vip', eventId })
  assert.equal(guestQrSize(text).withinBudget, true)
  const got = parseGuestQr(text)
  assert.equal(got.ok, true)
  assert.equal(got.sku, 'vip')
  assert.deepEqual(got.secret, secret)
})

test('parseGuestQr still accepts a v1 URI', () => {
  const k = Buffer.from(secret).toString('hex')
  const uri = `sezs1://ticket?e=${eventId}&t=ga&k=${k}`
  const got = parseGuestQr(uri)
  assert.equal(got.ok, true)
  assert.equal(got.version, 1)
  assert.equal(got.eventId, eventId)
  assert.deepEqual(got.secret, secret)
  assert.equal(eventTagMatches(eventId, got.eventTag), true)
})

test('refuses a truncated or wrong-version payload', () => {
  const raw = encodeGuestQrBytes({ secret, eventId })
  assert.throws(() => decodeGuestQrBytes(raw.slice(0, 20)))
  const bad = raw.slice()
  bad[0] = 2
  assert.throws(() => decodeGuestQrBytes(bad))
  const parsed = parseGuestQr('not-a-ticket')
  assert.equal(parsed.ok, false)
})

test('event tag is sha256(eventId)[0:8]', () => {
  const tag = eventTag(eventId)
  const expect = sha256(new TextEncoder().encode(eventId)).slice(0, 8)
  assert.deepEqual(tag, expect)
})
