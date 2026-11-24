/**
 * Verify a device grant, a ticket frame, and the consume envelope that
 * binds them. Pure: the caller supplies the stored grant, the last
 * accepted frame counter, the current time, and admin/usher predicates.
 */
import { verifyAdr036 } from '../ticket/v2/adr036.mjs'
import { verifyAuth, authBindsConsume, proofHash } from '../ticket/v2/usher-auth.mjs'
import {
  decodeGrant,
  decodeFrame,
  decodeConsumeDevice,
  verifyFrameSig,
  eventTagHex,
  CONSUME_DEVICE_DOMAIN,
  CAP_SCAN_TICKET,
} from './messages.mjs'

export const BLE_ERRORS = Object.freeze({
  bad_grant: 'bad_grant',
  bad_admin_sig: 'bad_admin_sig',
  revoked_device: 'revoked_device',
  expired_grant: 'expired_grant',
  wrong_event: 'wrong_event',
  missing_capability: 'missing_capability',
  bad_frame: 'bad_frame',
  bad_frame_sig: 'bad_frame_sig',
  replayed_frame: 'replayed_frame',
  stale_frame: 'stale_frame',
  tampered_payload: 'tampered_payload',
  grant_mismatch: 'grant_mismatch',
  bad_consume: 'bad_consume',
  bind: 'auth_mismatch',
  expired: 'expired',
  bad_signature: 'bad_signature',
  non_admin: 'non_admin',
  non_usher: 'non_usher',
})

const SK = (grantHash, seq) => `${String(grantHash).toLowerCase()}:${Number(seq)}`

const asText = (message) => (typeof message === 'string' ? message : new TextDecoder().decode(message))

const adr36Wire = (auth) => {
  let pub = auth.pub_key || auth.pubKey
  if (typeof pub === 'string') pub = { type: 'tendermint/PubKeySecp256k1', value: pub }
  if (pub && !pub.type) pub = { type: 'tendermint/PubKeySecp256k1', value: pub.value }
  return { pub_key: pub, signature: String(auth.signature || '') }
}

export const verifyAdminAdr036 = (grantText, auth, signer) => {
  const typ = String(auth?.typ || '')
  if (!(typ === 'zafu-adr36' || typ === 'adr36' || typ === 'signArbitrary' || typ === '')) {
    // Lab typ is not acceptable for a capability grant.
    if (typ === 'secp256k1-sha256') return false
  }
  const addr = String(signer || auth?.signer || '')
  const prefix = addr.split('1')[0] || 'terp'
  const bytes = typeof grantText === 'string' ? new TextEncoder().encode(grantText) : grantText
  return verifyAdr036(prefix, addr, bytes, adr36Wire(auth))
}

/**
 * @param {object} args
 * @param {string|Uint8Array} args.grantText
 * @param {object} args.adminSig
 * @param {string} [args.admin]
 * @param {string} [args.status]  'active' | 'revoked'
 * @param {string} [args.expectedEvent]
 * @param {number} [args.now]
 * @param {(addr: string) => boolean|Promise<boolean>} [args.isAdmin]
 */
export const verifyGrant = async ({
  grantText,
  adminSig,
  admin,
  status = 'active',
  expectedEvent,
  now = Math.floor(Date.now() / 1000),
  isAdmin,
}) => {
  let grant
  try {
    grant = decodeGrant(grantText)
  } catch {
    return { ok: false, error: BLE_ERRORS.bad_grant }
  }
  if (String(status) === 'revoked') return { ok: false, error: BLE_ERRORS.revoked_device, grant }
  if (Number(grant.expiry) <= now) return { ok: false, error: BLE_ERRORS.expired_grant, grant }
  if (expectedEvent && grant.eventId !== expectedEvent) return { ok: false, error: BLE_ERRORS.wrong_event, grant }
  const caps = String(grant.capabilities || '').split(',').map((x) => x.trim())
  if (!caps.includes(CAP_SCAN_TICKET)) return { ok: false, error: BLE_ERRORS.missing_capability, grant }
  const signer = String(admin || adminSig?.signer || '')
  if (!verifyAdminAdr036(grant.text, adminSig, signer)) {
    return { ok: false, error: BLE_ERRORS.bad_admin_sig, grant }
  }
  if (isAdmin) {
    const ok = await isAdmin(signer)
    if (!ok) return { ok: false, error: BLE_ERRORS.non_admin, grant }
  }
  return { ok: true, grant }
}

/**
 * @param {object} args
 * @param {object} args.grant  decoded grant
 * @param {string|Uint8Array} args.frameText
 * @param {string} args.frameSig
 * @param {number} [args.lastSeq]  last accepted seq for this grant (0 if none)
 * @param {Iterable<string>} [args.seen]  grantHash:seq keys already used
 * @param {number} [args.now]
 * @param {number} [args.maxSkewSec]  default 300
 * @param {string} [args.expectedEvent]
 * @param {string} [args.expectedPayload]  if set, payload must equal this string
 */
export const verifyFrame = ({
  grant,
  frameText,
  frameSig,
  lastSeq = 0,
  seen,
  now = Math.floor(Date.now() / 1000),
  maxSkewSec = 300,
  expectedEvent,
  expectedPayload,
}) => {
  let frame
  try {
    frame = decodeFrame(frameText)
  } catch {
    return { ok: false, error: BLE_ERRORS.bad_frame }
  }
  if (frame.grantHash !== grant.hash) return { ok: false, error: BLE_ERRORS.grant_mismatch, frame }
  if (frame.deviceSignPubkey.toLowerCase() !== grant.deviceSignPubkey.toLowerCase()) {
    return { ok: false, error: BLE_ERRORS.grant_mismatch, frame }
  }
  const eventId = expectedEvent || grant.eventId
  if (frame.eventId !== eventId || frame.eventId !== grant.eventId) {
    return { ok: false, error: BLE_ERRORS.wrong_event, frame }
  }
  if (frame.eventTag !== eventTagHex(frame.eventId)) {
    return { ok: false, error: BLE_ERRORS.wrong_event, frame }
  }
  if (expectedPayload != null && frame.payload !== expectedPayload) {
    return { ok: false, error: BLE_ERRORS.tampered_payload, frame }
  }
  if (Math.abs(frame.ts - now) > maxSkewSec) return { ok: false, error: BLE_ERRORS.stale_frame, frame }
  if (frame.seq <= Number(lastSeq || 0)) return { ok: false, error: BLE_ERRORS.replayed_frame, frame }
  if (seen && (seen.has?.(SK(frame.grantHash, frame.seq)) || [...(seen || [])].includes(SK(frame.grantHash, frame.seq)))) {
    return { ok: false, error: BLE_ERRORS.replayed_frame, frame }
  }
  if (!verifyFrameSig(frame.bytes, frameSig, grant.deviceSignPubkey)) {
    return { ok: false, error: BLE_ERRORS.bad_frame_sig, frame }
  }
  return { ok: true, frame }
}

export const verifyConsumeDeviceAuth = ({ consumeAuthText, auth, consume, now = Math.floor(Date.now() / 1000) }) => {
  let parsed
  try {
    parsed = decodeConsumeDevice(consumeAuthText)
  } catch {
    return { ok: false, error: BLE_ERRORS.bad_consume }
  }
  const typ = String(auth?.typ || '')
  const message = typeof consumeAuthText === 'string' ? new TextEncoder().encode(consumeAuthText) : consumeAuthText
  if (typ === 'zafu-adr36' || typ === 'adr36' || typ === 'signArbitrary') {
    const signer = String(parsed.usher || auth?.signer || '')
    const prefix = signer.split('1')[0] || 'terp'
    if (!verifyAdr036(prefix, signer, message, adr36Wire(auth))) {
      return { ok: false, error: BLE_ERRORS.bad_signature, parsed }
    }
  } else if (typ === 'secp256k1-sha256') {
    if (!verifyAuth(message, auth)) return { ok: false, error: BLE_ERRORS.bad_signature, parsed }
  } else {
    return { ok: false, error: BLE_ERRORS.bad_signature, parsed }
  }
  const bind = authBindsConsume(
    {
      usher: parsed.usher,
      eventId: parsed.eventId,
      nullifier: parsed.nullifier,
      root: parsed.root,
      proofHash: parsed.proofHash,
      expiry: parsed.expiry,
    },
    {
      nullifier: consume.nullifier,
      root: consume.root,
      proof: consume.proof,
      proofHash: consume.proofHash || (consume.proof ? proofHash(consume.proof) : undefined),
      eventId: consume.eventId || consume.event_id_text,
    },
    { now },
  )
  if (!bind.ok) {
    return { ok: false, error: bind.error === 'expired' ? BLE_ERRORS.expired : bind.error || BLE_ERRORS.bind, parsed }
  }
  return { ok: true, parsed }
}

/**
 * Full chain used by the desk and by POST /sezs/v2/door/consume when a
 * BLE frame is present.
 */
export const verifyDeviceChain = async ({
  grantText,
  adminSig,
  admin,
  status,
  frameText,
  frameSig,
  lastSeq,
  seen,
  consume,
  consumeAuthText,
  auth,
  expectedEvent,
  now = Math.floor(Date.now() / 1000),
  isAdmin,
  isUsher,
  sameRole,
  maxSkewSec,
}) => {
  const g = await verifyGrant({ grantText, adminSig, admin, status, expectedEvent, now, isAdmin })
  if (!g.ok) return g
  const f = verifyFrame({
    grant: g.grant,
    frameText,
    frameSig,
    lastSeq,
    seen,
    now,
    maxSkewSec,
    expectedEvent: expectedEvent || g.grant.eventId,
  })
  if (!f.ok) return { ...f, grant: g.grant }
  const c = verifyConsumeDeviceAuth({ consumeAuthText, auth, consume, now })
  if (!c.ok) return { ...c, grant: g.grant, frame: f.frame }
  if (c.parsed.grantHash !== g.grant.hash) return { ok: false, error: BLE_ERRORS.grant_mismatch, grant: g.grant, frame: f.frame, parsed: c.parsed }
  if (c.parsed.frameHash !== f.frame.hash) return { ok: false, error: BLE_ERRORS.tampered_payload, grant: g.grant, frame: f.frame, parsed: c.parsed }
  if (c.parsed.frameSig.toLowerCase() !== String(frameSig).toLowerCase()) {
    return { ok: false, error: BLE_ERRORS.bad_frame_sig, grant: g.grant, frame: f.frame, parsed: c.parsed }
  }
  if (c.parsed.frameSeq !== f.frame.seq) return { ok: false, error: BLE_ERRORS.replayed_frame, grant: g.grant, frame: f.frame, parsed: c.parsed }
  if (c.parsed.eventId !== g.grant.eventId || (expectedEvent && c.parsed.eventId !== expectedEvent)) {
    return { ok: false, error: BLE_ERRORS.wrong_event, grant: g.grant, frame: f.frame, parsed: c.parsed }
  }
  const ushersMatch = c.parsed.usher === g.grant.usher || (typeof sameRole === 'function' && sameRole(c.parsed.usher, g.grant.usher))
  if (!ushersMatch) return { ok: false, error: BLE_ERRORS.grant_mismatch, grant: g.grant, frame: f.frame, parsed: c.parsed }
  if (isUsher) {
    const ok = await isUsher(c.parsed.usher)
    if (!ok) return { ok: false, error: BLE_ERRORS.non_usher, grant: g.grant, frame: f.frame, parsed: c.parsed }
  }
  return { ok: true, grant: g.grant, frame: f.frame, parsed: c.parsed, replayKey: SK(g.grant.hash, f.frame.seq) }
}

export const isDeviceConsumeMessage = (text) => String(text || '').startsWith(CONSUME_DEVICE_DOMAIN)
export { SK as frameReplayKey }
