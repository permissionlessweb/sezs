/**
 * Usher consume relay checks. Pure functions so unit tests do not need a
 * live chain. The splash server calls `relayConsume` and, on success,
 * broadcasts the already-signed ConsumeTicket (or, in this pass, submits
 * with the session usher key only after these checks pass).
 *
 * The backend must never receive the ticket secret (guards.mjs).
 */
import { encodeAuthMessage, decodeAuthMessage, verifyAuth, authBindsConsume, proofHash } from '../../src/ticket/v2/usher-auth.mjs'
import { verifyAdr036 } from '../../src/ticket/v2/adr036.mjs'

export const relayErrors = {
  missing_auth: 'missing_auth',
  missing_consume: 'missing_consume',
  expired: 'expired',
  bad_signature: 'bad_signature',
  non_usher: 'non_usher',
  replay: 'replay',
  bad_proof: 'bad_proof',
  bind: 'auth_mismatch',
}

/**
 * @param {object} args
 * @param {object} args.consume  { proof, root, nullifier, eventId, event_id?, domain, rk_x, rk_y, consent }
 * @param {object} args.auth     { typ, signature, pubKey, message?|bytes?, signer, expiresAt? }
 * @param {number} [args.now]
 * @param {(addr: string) => boolean|Promise<boolean>} args.isUsher
 * @param {Set<string>} args.seenNullifiers
 * @param {(consume: object) => boolean|Promise<boolean>} [args.proofOk]
 * @param {(bytes, sig) => boolean} [args.verify]
 */
export const relayChecks = async ({
  consume,
  auth,
  now = Math.floor(Date.now() / 1000),
  isUsher,
  seenNullifiers,
  proofOk,
  verify = verifyAuth,
}) => {
  if (!consume || !consume.proof || !consume.nullifier || !consume.root) {
    return { ok: false, error: relayErrors.missing_consume }
  }
  if (!auth || !(auth.signature || auth.signedTx)) {
    return { ok: false, error: relayErrors.missing_auth }
  }

  let message = auth.message || auth.bytes
  let parsed = auth.parsed
  if (!parsed && message) {
    try {
      parsed = decodeAuthMessage(message)
    } catch {
      return { ok: false, error: relayErrors.bad_signature }
    }
  }
  if (!parsed && auth.usher && auth.nullifier) parsed = auth
  if (!parsed) return { ok: false, error: relayErrors.missing_auth }

  const bind = authBindsConsume(
    {
      usher: parsed.usher || auth.signer,
      eventId: parsed.eventId,
      nullifier: parsed.nullifier,
      root: parsed.root,
      proofHash: parsed.proofHash,
      expiry: parsed.expiry || auth.expiresAt,
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
    return { ok: false, error: bind.error === 'expired' ? relayErrors.expired : bind.error || relayErrors.bind }
  }

  if (message) {
    const typ = String(auth.typ || '')
    if (typ === 'zafu-adr36' || typ === 'adr36' || typ === 'signArbitrary') {
      const bytes = typeof message === 'string' ? new TextEncoder().encode(message) : message
      const signer = String(parsed.usher || auth.signer || '')
      const prefix = signer.split('1')[0] || 'terp'
      const wire = {
        pub_key: auth.pub_key || auth.pubKey || { type: 'tendermint/PubKeySecp256k1', value: String(auth.pubKey || '') },
        signature: String(auth.signature || ''),
      }
      if (typeof wire.pub_key === 'string') {
        wire.pub_key = { type: 'tendermint/PubKeySecp256k1', value: wire.pub_key }
      }
      if (!verifyAdr036(prefix, signer, bytes, wire)) return { ok: false, error: relayErrors.bad_signature }
    } else {
      const okSig = verify(typeof message === 'string' ? new TextEncoder().encode(message) : message, auth)
      if (!okSig) return { ok: false, error: relayErrors.bad_signature }
    }
  } else if (!auth.signedTx) {
    return { ok: false, error: relayErrors.bad_signature }
  }

  const signer = String(parsed.usher || auth.signer || '')
  const usherOk = await isUsher(signer)
  if (!usherOk) return { ok: false, error: relayErrors.non_usher }

  const n = String(consume.nullifier).toLowerCase()
  if (seenNullifiers && seenNullifiers.has(n)) return { ok: false, error: relayErrors.replay }

  if (typeof proofOk === 'function') {
    const ok = await proofOk(consume)
    if (!ok) return { ok: false, error: relayErrors.bad_proof }
  }

  return { ok: true, signer, nullifier: n, proofHash: parsed.proofHash }
}

/** Remember a nullifier so a second relay attempt is refused before chain. */
export const rememberNullifier = (seen, nullifier) => {
  const n = String(nullifier || '').toLowerCase()
  if (n) seen.add(n)
  return seen
}

export { encodeAuthMessage, proofHash }

/** Plain door-facing note. Raw chain logs stay in the server log only. */
export const doorNoteFor = (err, { ok = false } = {}) => {
  if (ok) return 'Admitted. A second scan will be refused.'
  const s = String(err || '')
  if (/nullifier already spent|already admitted|replayed_frame|replay/i.test(s)) return 'Already admitted.'
  if (/unknown or historical root|not on the guest list|unknown root/i.test(s)) return 'Not on the guest list.'
  if (/bad_frame_sig|tampered_payload|bad_frame|bad_admin_sig/.test(s)) return 'That ticket frame was not accepted.'
  if (/revoked_device/.test(s)) return 'This phone has been revoked.'
  if (/expired_grant/.test(s)) return 'This phone grant has expired.'
  if (/wrong_event/.test(s)) return 'This ticket is for a different event.'
  return 'Please try again.'
}
