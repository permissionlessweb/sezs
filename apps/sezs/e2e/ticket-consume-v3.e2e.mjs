/**
 * Usher-proves consume, walkthrough session, loopback only.
 *
 * Buy (or inject a paid leaf) → compact guest QR → usher device proves with
 * the wasm prover → canonical usher authorization → splash relay →
 * ConsumeTicket on the local terpd → second consume is refused.
 *
 * Does not print secrets, destinations, or key material.
 */
import assert from 'node:assert/strict'
import { doorAuthPubkeyString } from '../src/ticket/v2/door-auth.mjs'
import { readFileSync, existsSync, writeFileSync, chmodSync } from 'node:fs'
import { secp256k1 } from '@noble/curves/secp256k1'
import { loadTicketV2Node } from '../src/ticket/v2/node.mjs'
import { encodeGuestQr, parseGuestQr, eventTagMatches, guestQrSize } from '../src/ticket/v2/guest-qr.mjs'
import { encodeAuthMessage, signAuth, proofHash, DEFAULT_TTL_SEC } from '../src/ticket/v2/usher-auth.mjs'
import { issueInvoiceV2, markPaidV2, leavesV2, ensureV2, hydrateV2 } from '../dev/splash/ticket-v2.mjs'

const root = process.env.SEZS_SESSION_ROOT || '/tmp/sezs-session-walkthrough'
const bootPath = `${root}/terp-boot.json`
assert.ok(existsSync(bootPath), 'walkthrough session is not up')
const boot = JSON.parse(readFileSync(bootPath, 'utf8'))
assert.equal(String(boot.lcd || '').includes('127.0.0.1'), true, 'loopback lcd only')

const APP = process.env.SEZS_APP || 'http://127.0.0.1:3051'
const EVENT = process.env.SEZS_EVENT_ID || 'speakez-sessions'
const SKU = process.env.SEZS_SKU || 'ga'
const DOMAIN = APP
const t = loadTicketV2Node()

const toHex = (u) => Buffer.from(u).toString('hex')
const post = async (path, body) => {
  const res = await fetch(APP + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sezs-splash': '1', 'x-sezs-frost': '1' },
    body: JSON.stringify(body),
  })
  return res.json()
}
const get = async (path) => {
  const res = await fetch(APP + path, { headers: { 'x-sezs-splash': '1' } })
  return res.json()
}

const secret = t.newSecret()
const C = t.commitment(secret, SKU, EVENT)
const qr = encodeGuestQr({ secret, sku: SKU, eventId: EVENT })
const size = guestQrSize(qr)
console.log('guest QR chars', size.chars, 'within budget', size.withinBudget)
assert.equal(size.withinBudget, true)
const parsed = parseGuestQr(qr)
assert.equal(parsed.ok, true)
assert.equal(eventTagMatches(EVENT, parsed.eventTag), true)
assert.deepEqual(parsed.secret, secret)

// Pay: use the live v2 invoice API if splash is up, else fail clearly.
const inv = await post('/__splash/api/v2/invoice', { rail: 'zec', sku: SKU, eventId: EVENT, commitment: toHex(C) })
if (!inv.ok) {
  console.error('invoice failed', inv.error || inv)
  process.exit(2)
}
// Lab mark-paid is an internal splash route used by the walkthrough seed.
const paid = await post('/__splash/api/v2/watch/pay', { commitment: toHex(C) })
if (!paid?.ok) {
  // fallback: try the documented force-pay if present
  const alt = await post('/__splash/api/v2/watch/pay', { commitment: toHex(C) })
  if (!alt?.ok) {
    console.error('could not mark the invoice paid on the walkthrough (no secret printed)')
    process.exit(2)
  }
}

const pub = await post('/__splash/api/v2/root/publish', { reason: 'force' })
if (!pub.published && !pub.skipped) {
  console.error('root publish failed', pub.error || pub)
  process.exit(2)
}
console.log('root publish', pub.published ? 'ok' : 'skipped', pub.reason || pub.skipped || '', pub.txhash || '')

// Keep a second paid, unconsumed ticket for the operator. The secret is
// written to a 0600 session file and is never printed.
{
  const unusedSecret = t.newSecret()
  const unusedC = t.commitment(unusedSecret, SKU, EVENT)
  const unusedInv = await post('/__splash/api/v2/invoice', { rail: 'zec', sku: SKU, eventId: EVENT, commitment: toHex(unusedC) })
  if (!unusedInv.ok) {
    console.error('unused invoice failed', unusedInv.error || unusedInv)
    process.exit(2)
  }
  const unusedPaid = await post('/__splash/api/v2/watch/pay', { commitment: toHex(unusedC) })
  if (!unusedPaid?.ok) {
    console.error('could not mark the unused invoice paid (no secret printed)')
    process.exit(2)
  }
  // Re-publish so the unused leaf is in the on-chain root the usher will prove against.
  const pub2 = await post('/__splash/api/v2/root/publish', { reason: 'force' })
  if (!pub2.published && !pub2.skipped) {
    console.error('unused root publish failed', pub2.error || pub2)
    process.exit(2)
  }
  const unusedPath = `${root}/unused-ticket.json`
  writeFileSync(unusedPath, JSON.stringify({
    eventId: EVENT,
    sku: SKU,
    commitment: toHex(unusedC),
    secret: toHex(unusedSecret),
  }) + '\n', { mode: 0o600 })
  chmodSync(unusedPath, 0o600)
  console.log('unused ticket saved at', unusedPath, 'commitment', toHex(unusedC))
}

const evRes = await fetch(`http://127.0.0.1:1317/cosmwasm/wasm/v1/contract/${boot.contract}/smart/${Buffer.from(JSON.stringify({ event_view: {} })).toString('base64')}`)
const evJson = await evRes.json()
const evData = evJson.data || evJson
const consumeCfg = evData.consume || {}
assert.ok(consumeCfg.zkid && consumeCfg.event_id_fp && consumeCfg.domain_fp, 'event consume config missing')
assert.ok(consumeCfg.door_auth_pubkey, 'door auth pubkey missing')

const leaves = await get('/sezs/v2/leaves')
assert.ok(leaves.ok && leaves.leaves?.length, 'guest list is empty')
assert.ok(leaves.leaves.includes(toHex(C)) || leaves.leaves.includes(toHex(C).toLowerCase()), 'paid leaf missing from tree')

const t0 = performance.now()
const proven = t.prove({ secret, sku: SKU, eventId: EVENT, domain: DOMAIN, leaves: leaves.leaves })
const proveMs = Math.round(performance.now() - t0)
console.log('usher-device prove (node wasm) ms', proveMs)
const bundle = proven.bundle
const fields = t.consumeFields(bundle)
const cfg = await get('/sezs/v2/door/config')
assert.equal(cfg.ok, true, cfg.error)
const doorAuth = consumeCfg.door_auth_pubkey
const N = t.nullifier(secret, EVENT)
const printed = t.signPrinted({
  secret,
  eventId: EVENT,
  domain: consumeCfg.domain || DOMAIN,
  alphaNonce: proven.alphaNonce,
  nullifier: N,
  doorAuthPubkey: doorAuthPubkeyString(doorAuth),
})
const consume = {
  proof: fields.proof,
  root: fields.root,
  nullifier: fields.nullifier,
  event_id: consumeCfg.event_id_fp,
  domain: consumeCfg.domain_fp,
  rk_x: fields.rk_x,
  rk_y: fields.rk_y,
  consent: { printed: { sig: Buffer.from(printed).toString('base64') } },
  eventId: EVENT,
  proofHash: proofHash(bundle),
}

const prepared = await post('/sezs/v2/door/prepare', { ...consume, usher: cfg.usher, eventId: EVENT, proofHash: consume.proofHash })
assert.equal(prepared.ok, true, prepared.error)
const { text, bytes } = encodeAuthMessage({
  usher: prepared.usher,
  eventId: EVENT,
  nullifier: consume.nullifier,
  root: consume.root,
  proofHash: consume.proofHash,
  expiry: prepared.expiresAt,
})
const priv = secp256k1.utils.randomPrivateKey()
const signed = signAuth(bytes, priv)
const auth = { ...signed, signer: prepared.usher, usher: prepared.usher, message: text, expiresAt: prepared.expiresAt, ...encodeAuthMessage({
  usher: prepared.usher, eventId: EVENT, nullifier: consume.nullifier, root: consume.root, proofHash: consume.proofHash, expiry: prepared.expiresAt,
}) && { eventId: EVENT, nullifier: consume.nullifier, root: consume.root, proofHash: consume.proofHash, expiry: prepared.expiresAt } }

const first = await post('/sezs/v2/door/consume', { consume, auth })
assert.equal(first.ok, true, first.error)
assert.ok(first.txhash, 'missing admit txhash')
console.log('admit txhash', first.txhash, 'height', first.height)

const second = await post('/sezs/v2/door/consume', { consume, auth })
assert.equal(second.ok, false)
assert.match(String(second.error || ''), /already admitted|replay|already spent/i)
// The node refuses a spent nullifier in CheckTx, so the tx is not
// included in a block and usually has no committed txhash.
if (second.txhash) console.log('second scan refused:', second.error, 'txhash', second.txhash, 'height', second.height)
else console.log('second scan refused on chain (CheckTx, not included):', second.error)
console.log('e2e ok')
