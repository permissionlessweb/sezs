/**
 * Local-chain e2e for the usher-device auth chain, using SimulatedTransport
 * (no radio). Loopback only. Does not print secrets or key material.
 *
 * Buy a ticket → admin signs a device grant → simulated phone signs a
 * ticket frame → desk proves → usher signs SEZS-CONSUME-V3-DEVICE →
 * /sezs/v2/door/consume admits on the local chain. A replayed frame and
 * a forged frame are refused.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { secp256k1 } from '@noble/curves/secp256k1'
import { doorAuthPubkeyString } from '../src/ticket/v2/door-auth.mjs'
import { loadTicketV2Node } from '../src/ticket/v2/node.mjs'
import { encodeGuestQr, parseGuestQr, eventTagMatches, guestQrSize } from '../src/ticket/v2/guest-qr.mjs'
import { signAuth, proofHash, DEFAULT_TTL_SEC } from '../src/ticket/v2/usher-auth.mjs'
import { encodeGrant, encodeFrame, encodeConsumeDevice, newDeviceKey, signFrame, newNonce, hex } from '../src/ble/messages.mjs'
import { newAdmin, signAdr036, terpAddress } from '../src/ble/lab-sign.mjs'
import { sessionCoordinator } from './session-coord-sign.mjs'
import { signExecuteAs } from './session-usher-tx.mjs'
import { staffLogin } from './staff-login.mjs'
import { createSimulatedTransport } from '../src/ble/simulated-transport.mjs'
import { BLE_ERRORS } from '../src/ble/verify.mjs'

const root = process.env.SEZS_SESSION_ROOT || '/tmp/sezs-session-walkthrough'
const bootPath = `${root}/terp-boot.json`
assert.ok(existsSync(bootPath), 'walkthrough session is not up')
const boot = JSON.parse(readFileSync(bootPath, 'utf8'))
assert.equal(String(boot.lcd || '').includes('127.0.0.1'), true, 'loopback lcd only')

const APP = process.env.SEZS_APP || 'http://127.0.0.1:3051'
const statePath = `${root}/splash/state.json`
const stateEvent = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')).v2 || {}).eventId : ''
const EVENT = process.env.SEZS_EVENT_ID || stateEvent || 'speakez-sessions'
console.log('event', EVENT)

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

const grantsProbe = await get('/sezs/v2/door/device/grants')
assert.equal(
  grantsProbe.ok === true || ['not_member', 'not_coordinator'].includes(String(grantsProbe.error || '')),
  true,
  'device grant API is not mounted on the running splash (restart splash after this change)',
)
const staff = await staffLogin(APP)
const staffGet = async (path) => {
  const res = await fetch(APP + path, { headers: { 'x-sezs-splash': '1', cookie: staff.header } })
  return res.json()
}
const staffPost = async (path, body) => {
  const res = await fetch(APP + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sezs-splash': '1', 'x-sezs-frost': '1', cookie: staff.header },
    body: JSON.stringify(body),
  })
  return res.json()
}

// Simulated phone + admin grant (ADR-36).
const transport = createSimulatedTransport({ label: 'e2e-phone' })
const phone = transport.addPhone({})
const session = await transport.connect(phone.id)
const admin = sessionCoordinator()

// Guest ticket
const secret = t.newSecret()
const C = t.commitment(secret, SKU, EVENT)
const qr = encodeGuestQr({ secret, sku: SKU, eventId: EVENT })
assert.equal(guestQrSize(qr).withinBudget, true)
const parsed = parseGuestQr(qr)
assert.equal(parsed.ok, true)
assert.equal(eventTagMatches(EVENT, parsed.eventTag), true)

const inv = await post('/__splash/api/v2/invoice', { rail: 'zec', sku: SKU, eventId: EVENT, commitment: toHex(C) })
assert.equal(inv.ok, true, inv.error)
const paid = await post('/__splash/api/v2/watch/pay', { commitment: toHex(C) })
assert.equal(paid?.ok, true, 'could not mark the invoice paid (no secret printed)')
let pub
for (let i = 0; i < 6; i++) {
  pub = await post('/__splash/api/v2/root/publish', { reason: 'force' })
  if (pub.published || pub.skipped) break
  await new Promise((r) => setTimeout(r, 2000))
}
assert.ok(pub.published || pub.skipped, pub.error || 'root publish failed')

const evRes = await fetch(`http://127.0.0.1:1317/cosmwasm/wasm/v1/contract/${boot.contract}/smart/${Buffer.from(JSON.stringify({ event_view: {} })).toString('base64')}`)
const evJson = await evRes.json()
const evData = evJson.data || evJson
const consumeCfg = evData.consume || {}
assert.ok(consumeCfg.zkid && consumeCfg.event_id_fp && consumeCfg.domain_fp, 'event consume config missing')

const leaves = await get('/sezs/v2/leaves')
assert.ok(leaves.ok && leaves.leaves?.length, 'guest list is empty')

const proven = t.prove({ secret, sku: SKU, eventId: EVENT, domain: DOMAIN, leaves: leaves.leaves })
const bundle = proven.bundle
const fields = t.consumeFields(bundle)
const cfg = await get('/sezs/v2/door/config')
assert.equal(cfg.ok, true, cfg.error)
const usher = cfg.usher
assert.ok(usher && usher.startsWith('terp1'), 'door config missing usher')

const rolesProbe = await get('/sezs/v2/event/roles')
assert.equal(rolesProbe.ok, true, 'event roles API is not mounted on the running splash (restart splash after this change)')
const onChainUshers = (rolesProbe.ushers || []).map((u) => u.terp || u).filter((a) => String(a).startsWith('terp1'))
assert.ok(onChainUshers.length > 0, 'on-chain usher set is empty')
assert.ok(onChainUshers.every((a) => a.startsWith('terp1')), 'roles API returned a non-terp usher')
assert.ok(!(rolesProbe.signing && rolesProbe.signing.u1_signs), 'u1 role book is still advertised')
console.log('roles event', rolesProbe.eventId || EVENT, 'ushers', onChainUshers.length, 'coordinators', (rolesProbe.coordinators || []).length)
const { encodeUsherReg } = await import('../src/ble/messages.mjs')
const stranger = newAdmin()
const badReg = encodeUsherReg({
  eventId: EVENT,
  usher,
  expiry: Math.floor(Date.now() / 1000) + 3600,
  nonce: newNonce(),
})
const refusedOnboard = await post('/sezs/v2/event/roles/usher', {
  text: badReg.text,
  sig: signAdr036(stranger.address, badReg.bytes, stranger.secret),
  signer: stranger.address,
})
assert.equal(refusedOnboard.ok, false, 'backend must not execute membership updates')
assert.equal(refusedOnboard.error, 'use_wallet_execute', refusedOnboard.error)
// Pages are client-rendered (nextExport); assert the compiled chunks, not the empty SSR shell.
const adminJs = await (await fetch(APP + '/_next/static/chunks/pages/admin.js')).text()
assert.match(adminJs, /Phones/)
assert.match(adminJs, /UsherBlePanel/)
const doorHtml = await (await fetch(APP + '/door')).text()
const doorChunks = [...doorHtml.matchAll(/\/_next\/static\/chunks\/pages\/[^"']+/g)].map((m) => m[0])
let doorHasUsherPhones = /Usher phones/.test(doorHtml)
for (const src of doorChunks) {
  const js = await (await fetch(APP + src)).text()
  if (/Usher phones/.test(js)) doorHasUsherPhones = true
}
assert.equal(doorHasUsherPhones, false, 'door still exposes the usher-phones control')
console.log('admin Phones tab present; door no longer has Usher phones')


const grant2 = encodeGrant({
  deviceSignPubkey: phone.publicHex,
  deviceNoiseStatic: phone.noiseHex,
  usher,
  eventId: EVENT,
  expiry: Math.floor(Date.now() / 1000) + 3600,
  nonce: newNonce(),
})
const adminSig = admin.sign(grant2.bytes)
const registered = await post('/sezs/v2/door/device/grant', {
  grantText: grant2.text,
  adminSig,
  admin: admin.address,
  label: 'e2e simulated phone',
})
assert.equal(registered.ok, true, registered.error)

const N = t.nullifier(secret, EVENT)
const printed = t.signPrinted({
  secret,
  eventId: EVENT,
  domain: consumeCfg.domain || DOMAIN,
  alphaNonce: proven.alphaNonce,
  nullifier: N,
  doorAuthPubkey: doorAuthPubkeyString(consumeCfg.door_auth_pubkey),
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

const now = Math.floor(Date.now() / 1000)
const frame = encodeFrame({
  grantHash: grant2.hash,
  deviceSignPubkey: phone.publicHex,
  eventId: EVENT,
  seq: 1,
  ts: now,
  payload: qr,
})
const frameSig = signFrame(frame.bytes, phone.device.secret)
transport.injectFrame(phone.id, { text: frame.text, sig: frameSig, payload: qr })
const delivered = await session.nextFrame()
assert.equal(delivered.payload, qr)

const prepared = await post('/sezs/v2/door/prepare', { ...consume, usher, eventId: EVENT, proofHash: consume.proofHash })
assert.equal(prepared.ok, true, prepared.error)
const expiry = prepared.expiresAt || (now + DEFAULT_TTL_SEC)
const authMsg = encodeConsumeDevice({
  usher,
  eventId: EVENT,
  nullifier: consume.nullifier,
  root: consume.root,
  proofHash: consume.proofHash,
  expiry,
  grantHash: grant2.hash,
  frameHash: frame.hash,
  frameSig,
  frameSeq: 1,
})
const priv = secp256k1.utils.randomPrivateKey()
const signed = signAuth(authMsg.bytes, priv)
const auth = { ...signed, signer: usher, usher, message: authMsg.text, expiresAt: expiry }

const other = newDeviceKey()
const forgedSig = signFrame(frame.bytes, other.secret)
const forgedMsg = encodeConsumeDevice({
  usher,
  eventId: EVENT,
  nullifier: consume.nullifier,
  root: consume.root,
  proofHash: consume.proofHash,
  expiry,
  grantHash: grant2.hash,
  frameHash: frame.hash,
  frameSig: forgedSig,
  frameSeq: 1,
})
const forgedAuth = { ...signAuth(forgedMsg.bytes, priv), signer: usher, usher, message: forgedMsg.text, expiresAt: expiry }
const forged = await post('/sezs/v2/door/consume', {
  consume,
  auth: forgedAuth,
  frameText: frame.text,
  frameSig: forgedSig,
  grantHash: grant2.hash,
})
assert.equal(forged.ok, false)
assert.equal(
  forged.error === BLE_ERRORS.bad_frame_sig || /bad_frame|signature|refused|not accepted/i.test(String(forged.error || '')),
  true,
  forged.error,
)
console.log('forged frame refused:', forged.error)

const consumeMsg = {
  consume_ticket: {
    proof: String(consume.proof).length === 8384 ? Buffer.from(consume.proof, 'hex').toString('base64') : consume.proof,
    root: consume.root,
    nullifier: consume.nullifier,
    event_id: consume.event_id,
    domain: consume.domain,
    rk_x: consume.rk_x,
    rk_y: consume.rk_y,
    consent: consume.consent,
  },
}
const signedTx = signExecuteAs({ contract: boot.contract, msg: consumeMsg })
assert.ok(signedTx, 'session usher could not sign ConsumeTicket')

const first = await post('/sezs/v2/door/consume', {
  consume,
  auth,
  signedTx,
  frameText: frame.text,
  frameSig,
  grantHash: grant2.hash,
})
assert.equal(first.ok, true, first.error)
assert.ok(first.txhash, 'missing admit txhash')
console.log('ble admit txhash', first.txhash, 'height', first.height)

const replay = await post('/sezs/v2/door/consume', {
  consume,
  auth,
  frameText: frame.text,
  frameSig,
  grantHash: grant2.hash,
})
assert.equal(replay.ok, false)
assert.match(String(replay.error || ''), /replay|already admitted|already spent|replayed_frame/i)
console.log('replay refused:', replay.error)

const cleaned = await staffPost('/sezs/v2/door/device/revoke', { hash: grant2.hash })
assert.equal(cleaned.ok || cleaned.deleted, true, cleaned.error)
const left = await staffGet('/sezs/v2/door/device/grants')
assert.equal((left.devices || []).some((d) => d.hash === grant2.hash), false, 'e2e grant was retained')
console.log('e2e ble ok')

