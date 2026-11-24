import assert from 'node:assert/strict'
import test from 'node:test'

import { newTicketMaterial, toHex, commitmentOf, nullifierOf, qrPayload } from './commitment.mjs'
import {
  ticketKeypair,
  signChallenge,
  signPrintAuth,
  verifyEd25519,
  parseChallengeUri,
  encodeChallengeUri,
  encodeAdmitUri,
  parseAdmitUri,
  isSecretTicketUri,
  normalizeOrigin,
  challengeBytes,
  printAuthBytes,
  generateDoorAuthSeed,
  doorAuthKeypair,
  CHALLENGE_TTL_MS,
} from './auth.mjs'

const domain = 'http://127.0.0.1:3051/'
const eventId = 'speakez-sessions'
const sku = 'ga'

test('origin normalizes to scheme, host, and port only', () => {
  assert.equal(normalizeOrigin('http://127.0.0.1:3051/'), 'http://127.0.0.1:3051')
  assert.equal(normalizeOrigin('http://127.0.0.1:3051'), 'http://127.0.0.1:3051')
  assert.equal(normalizeOrigin('https://tickets.example/path'), null)
  assert.equal(normalizeOrigin('http://127.0.0.1:3051/?x=1'), null)
  assert.equal(normalizeOrigin('localhost'), null)
})

test('ticket signing key is determined by the secret, event, and domain; secret stays off tokens', async () => {
  const material = await newTicketMaterial({ eventId, sku, invoiceNonce: 'aa'.repeat(8) })
  const a = await ticketKeypair({ secret: material.secret, eventId, domain })
  const b = await ticketKeypair({ secret: material.secret, eventId, domain: 'http://127.0.0.1:3051' })
  assert.equal(a.publicHex, b.publicHex)
  const other = await ticketKeypair({
    secret: material.secret,
    eventId,
    domain: 'http://localhost:3051',
  })
  assert.notEqual(a.publicHex, other.publicHex)

  const admin = await doorAuthKeypair(generateDoorAuthSeed(() => new Uint8Array(32).fill(2)))
  const signed = await signPrintAuth({
    secret: material.secret,
    eventId,
    domain,
    adminPubkey: admin.publicHex,
    sku,
  })
  const uri = encodeAdmitUri({
    eventId,
    domain,
    sku,
    ticketPubkey: signed.publicHex,
    signature: signed.signatureHex,
    commitment: toHex(commitmentOf(material.secret, sku, eventId)),
  })
  assert.equal(uri.startsWith('sezs1://admit?'), true)
  assert.equal(isSecretTicketUri(uri), false)
  assert.ok(!uri.includes(toHex(material.secret)))
  assert.ok(!uri.includes('k='))
  const parsed = parseAdmitUri(uri)
  assert.equal(parsed.ok, true)
  const ok = await verifyEd25519(
    parsed.ticketPubkey,
    printAuthBytes({ eventId, domain, adminPubkey: admin.publicHex, sku }),
    parsed.signature,
  )
  assert.equal(ok, true)
})

test('live challenge signature verifies and a secret QR is not a challenge', async () => {
  const material = await newTicketMaterial({ eventId, sku, invoiceNonce: 'bb'.repeat(8) })
  const challenge = {
    eventId,
    domain: normalizeOrigin(domain),
    nonce: 'ab'.repeat(16),
    usherPubkey: 'cd'.repeat(32),
    timestamp: 1_800_000_000_000,
  }
  const uri = encodeChallengeUri(challenge)
  const parsed = parseChallengeUri(uri)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.domain, 'http://127.0.0.1:3051')
  const signed = await signChallenge({ secret: material.secret, ...challenge })
  const ok = await verifyEd25519(
    signed.publicHex,
    challengeBytes(challenge),
    signed.signatureHex,
  )
  assert.equal(ok, true)
  const bad = await verifyEd25519(
    signed.publicHex,
    challengeBytes({ ...challenge, nonce: '00'.repeat(16) }),
    signed.signatureHex,
  )
  assert.equal(bad, false)
  const secretQr = qrPayload(material.secret, sku, eventId)
  assert.equal(isSecretTicketUri(secretQr), true)
  assert.equal(parseChallengeUri(secretQr).ok, false)
  assert.equal(parseAdmitUri(secretQr).ok, false)
  assert.ok(CHALLENGE_TTL_MS >= 60_000)
  assert.ok(!JSON.stringify(signed).includes(toHex(material.secret)))
  const n = toHex(nullifierOf(material.secret, eventId))
  assert.equal(n.length, 64)
})
