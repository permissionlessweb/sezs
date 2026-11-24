/**
 * v3 consume relay routes. The backend never accepts a ticket secret.
 *
 * Preferred path: broadcast a ConsumeTicket already signed by the usher's
 * Zafu (signAmino / signDirect). The contract already requires the sender
 * to be in the usher group, so a relayer cannot forge an admit.
 * The canonical SEZS-CONSUME-V3 authorization plus executeAs(session usher
 * key) remains available only when SEZS_ALLOW_V3_RELAY_AUTH=1 (dev/walkthrough).
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { resolveLiveRole } from './live-roles.mjs'
import { executeAs, chainEnv, addrOf } from './chain-tx.mjs'
import { relayChecks, rememberNullifier, doorNoteFor } from './consume-relay.mjs'
import { encodeAuthMessage, DEFAULT_TTL_SEC } from '../../src/ticket/v2/usher-auth.mjs'
import { encodeConsumeDevice } from '../../src/ble/messages.mjs'
import { isDeviceConsumeMessage } from '../../src/ble/verify.mjs'
import { checkStoredChain } from './ble-grants.mjs'
import { broadcastSignedTx } from './broadcast-tx.mjs'

const seen = new Set()
// Ephemeral lab stand-in for Zafu when the extension is not in the browser.
// Generated at process start; never logged.
const labPriv = secp256k1.utils.randomPrivateKey()

const liveCfg = () => ({
  lcd: process.env.SEZS_EVENT_LCD || process.env.SEZS_LCD || process.env.SEZS_V2_LCD || 'http://127.0.0.1:1317',
  contract: process.env.SEZS_EVENT_CONTRACT || process.env.SEZS_V2_ROOT_CONTRACT || '',
  coordinatorsGroup: process.env.SEZS_COORD_GROUP || '',
  usherGroup: process.env.SEZS_USHER_GROUP || '',
})

export const isLiveUsher = async (address) => {
  if (!address) return false
  const r = await resolveLiveRole(liveCfg(), { address, sessionRole: null })
  return r.role === 'usher' || r.role === 'coordinator' || r.role === 'admin'
}

const consumeFrom = (b) => b.consume || b

export const makeConsumeHandlers = ({ cookieOf, roleOf, state, grantStore, isAdmin, isUsher, sameRole }) => {
  const liveUsher = isUsher || isLiveUsher
  const prepare = async (req, b) => {
    const consume = consumeFrom(b)
    if (!consume?.proof || !consume?.nullifier || !consume?.root) {
      return [200, { ok: false, error: 'missing_fields' }]
    }
    const e = chainEnv()
    const usher = String(b.usher || addrOf(e.usherKey) || '')
    if (!usher) return [200, { ok: false, error: 'missing_usher' }]
    const live = await liveUsher(usher)
    if (!live) return [200, { ok: false, error: 'non_usher' }]
    const expiresAt = Math.floor(Date.now() / 1000) + DEFAULT_TTL_SEC
    const { text } = encodeAuthMessage({
      usher,
      eventId: b.eventId || consume.eventId || state()?.v2?.eventId || 'speakez-sessions',
      nullifier: consume.nullifier,
      root: consume.root,
      proofHash: consume.proofHash,
      expiry: expiresAt,
    })
    let authText = text
    if (b.frameText && b.frameSig && b.grantHash) {
      const { decodeFrame } = await import('../../src/ble/messages.mjs')
      const frame = decodeFrame(b.frameText)
      const dev = encodeConsumeDevice({
        usher,
        eventId: b.eventId || consume.eventId || state()?.v2?.eventId || 'speakez-sessions',
        nullifier: consume.nullifier,
        root: consume.root,
        proofHash: consume.proofHash,
        expiry: expiresAt,
        grantHash: b.grantHash,
        frameHash: frame.hash,
        frameSig: b.frameSig,
        frameSeq: frame.seq,
      })
      authText = dev.text
    }
    return [200, { ok: true, usher, expiresAt, authText }]
  }

  const labAuthorize = async (req, b) => {
    const id = cookieOf(req)
    const role = roleOf(id)
    const e = chainEnv()
    const usher = String(b.usher || addrOf(e.usherKey) || '')
    const live = await liveUsher(usher)
    if (!(live || role === 'usher')) return [200, { ok: false, error: 'non_usher' }]
    const authText = String(b.authText || '')
    if (!authText.startsWith('SEZS-CONSUME-V3')) return [200, { ok: false, error: 'bad_auth' }]
    const { signAuth } = await import('../../src/ticket/v2/usher-auth.mjs')
    const signed = signAuth(new TextEncoder().encode(authText), labPriv)
    return [200, { ok: true, ...signed, signer: usher, usher, message: authText, bytes: undefined }]
  }

  const consume = async (req, b) => {
    const body = consumeFrom(b)
    if (!body?.proof || !body?.nullifier || !body?.root) {
      return [200, { ok: false, error: 'missing_fields' }]
    }
    if (!body.consent || !(body.consent.live || body.consent.printed)) {
      return [200, { ok: false, error: 'missing_consent' }]
    }
    let auth = b.auth
    const e = chainEnv()
    if (!e.contract) return [200, { ok: false, error: 'no_contract' }]
    const deviceMsg = isDeviceConsumeMessage(auth?.message || auth?.bytes || '')
    if (deviceMsg || b.frameText || b.frame?.text) {
      if (!grantStore) return [200, { ok: false, error: 'device_store_missing' }]
      const device = await checkStoredChain(grantStore, { ...b, consume: body, auth }, {
        isAdmin: isAdmin || (async () => false),
        isUsher: liveUsher,
        sameRole,
        expectedEvent: body.eventId || b.eventId || state()?.v2?.eventId,
      })
      if (!device.ok) {
        const raw = String(device.error || 'refused')
        console.log('consume device chain refused:', raw.slice(0, 300))
        return [200, { ok: false, error: doorNoteFor(raw) }]
      }
      if (device.parsed) {
        auth = {
          ...auth,
          parsed: {
            usher: device.parsed.usher,
            eventId: device.parsed.eventId,
            nullifier: device.parsed.nullifier,
            root: device.parsed.root,
            proofHash: device.parsed.proofHash,
            expiry: device.parsed.expiry,
          },
        }
      }
    }
    const checked = await relayChecks({
      consume: body,
      auth,
      isUsher: liveUsher,
      // Do not short-circuit on the in-memory set: a second scan must be
      // refused on chain so the door gets a refuse txhash.
      seenNullifiers: undefined,
      proofOk: () => !!(body.proof && body.nullifier && body.root && body.rk_x && body.rk_y),
    })
    if (!checked.ok) {
      const raw = String(checked.error || 'refused')
      console.log('consume refused:', raw.slice(0, 300))
      return [200, { ok: false, error: doorNoteFor(raw) }]
    }
    const msg = {
      consume_ticket: {
        proof: String(body.proof).length === 8384 ? Buffer.from(body.proof, 'hex').toString('base64') : body.proof,
        root: body.root,
        nullifier: body.nullifier,
        event_id: body.event_id,
        domain: body.domain,
        rk_x: body.rk_x,
        rk_y: body.rk_y,
        consent: body.consent,
      },
    }
    const signedTx = b.signedTx || auth?.signedTx || auth?.tx
    if (signedTx) {
      const r = await broadcastSignedTx({ lcd: e.lcd, node: e.node, terpd: e.terpd, tx: signedTx })
      if (!r.ok) {
        const err = String(r.error || 'broadcast_failed')
        console.log('consume signed tx failed:', err.slice(0, 300))
        return [200, { ok: false, error: doorNoteFor(err), txhash: r.txhash, height: r.height }]
      }
      rememberNullifier(seen, body.nullifier)
      return [200, { ok: true, message: doorNoteFor('', { ok: true }), txhash: r.txhash, height: r.height }]
    }
    if (process.env.SEZS_ALLOW_V3_RELAY_AUTH !== '1') {
      console.log('consume refused: Zafu-signed tx required (SEZS_ALLOW_V3_RELAY_AUTH is off)')
      return [200, { ok: false, error: doorNoteFor('zafu_signed_tx_required') }]
    }
    const r = await executeAs(e.usherKey, e.contract, msg)
    if (!r.ok) {
      const err = String(r.error || 'consume_failed')
      console.log('consume failed:', err.slice(0, 300))
      return [200, { ok: false, error: doorNoteFor(err), txhash: r.txhash, height: r.height }]
    }
    rememberNullifier(seen, body.nullifier)
    return [200, { ok: true, message: doorNoteFor('', { ok: true }), txhash: r.txhash, height: r.height, gasUsed: r.gasUsed }]
  }

  return {
    'POST /sezs/v2/door/prepare': prepare,
    'POST /sezs/v2/door/lab-authorize': labAuthorize,
    'POST /sezs/v2/door/consume': consume,
  }
}
