/**
 * Backend-only store for usher-device capability grants (local demo).
 *
 * Decision: grants live in a 0600 JSON file next to splash state, not
 * on-chain in this slice. The admin ADR-36 signature is the source of
 * truth; this store only remembers grants, labels, revocation, and the
 * last accepted frame counter so replay can be refused before a consume
 * is relayed. The schema is stable so a later cw-orch change can mirror
 * the same records into the cw420 usher set or the event contract.
 *
 * Never stores device secrets or ticket openings.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { verifyGrant, verifyDeviceChain, BLE_ERRORS } from '../../src/ble/verify.mjs'
import { decodeGrant, decodeFrame } from '../../src/ble/messages.mjs'

const empty = () => ({ grants: {}, used: {}, ingest: [] })

export const openGrantStore = (persistPath) => {
  const load = () => {
    if (!persistPath || !existsSync(persistPath)) return empty()
    try {
      const raw = JSON.parse(readFileSync(persistPath, 'utf8'))
      const grants = raw.grants || {}
      const used = raw.used || {}
      let dirty = false
      const now = Math.floor(Date.now() / 1000)
      for (const [h, rec] of Object.entries(grants)) {
        const expiry = Number(rec && rec.grant && rec.grant.expiry)
        const dead = rec && (rec.status === 'revoked' || (Number.isFinite(expiry) && expiry > 0 && expiry <= now))
        if (dead) {
          delete grants[h]
          dirty = true
          for (const k of Object.keys(used)) {
            if (k.startsWith(h + ':')) delete used[k]
          }
        }
      }
      const state = { grants, used, ingest: raw.ingest || [] }
      if (dirty) save(state)
      return state
    } catch {
      return empty()
    }
  }
  const save = (state) => {
    if (!persistPath) return
    mkdirSync(dirname(persistPath), { recursive: true })
    writeFileSync(persistPath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
    try { chmodSync(persistPath, 0o600) } catch {}
  }

  const list = () => {
    const s = load()
    const now = Math.floor(Date.now() / 1000)
    return Object.values(s.grants)
      .filter((g) => g.status !== 'revoked' && !(Number(g.expiry) > 0 && Number(g.expiry) <= now))
      .map(publicGrant)
  }

  const get = (hash) => {
    const s = load()
    return s.grants[String(hash || '').toLowerCase()] || null
  }

  const putGrant = async ({ grantText, adminSig, admin, label, isAdmin, now }) => {
    const checked = await verifyGrant({ grantText, adminSig, admin, now, isAdmin })
    if (!checked.ok) return checked
    const s = load()
    const hash = checked.grant.hash
    const prev = s.grants[hash]
    s.grants[hash] = {
      hash,
      grantText: checked.grant.text,
      grant: {
        deviceSignPubkey: checked.grant.deviceSignPubkey,
        deviceNoiseStatic: checked.grant.deviceNoiseStatic,
        usher: checked.grant.usher,
        eventId: checked.grant.eventId,
        contract: checked.grant.contract,
        capabilities: checked.grant.capabilities,
        expiry: checked.grant.expiry,
        nonce: checked.grant.nonce,
      },
      admin: admin || adminSig.signer,
      adminSig: { typ: adminSig.typ, signature: adminSig.signature, pub_key: adminSig.pub_key || adminSig.pubKey, signer: admin || adminSig.signer },
      status: 'active',
      label: label || prev?.label || shortLabel(checked.grant.deviceSignPubkey),
      lastSeen: prev?.lastSeen || 0,
      lastSeq: prev?.lastSeq || 0,
      createdAt: prev?.createdAt || Math.floor(Date.now() / 1000),
    }
    save(s)
    return { ok: true, grant: publicGrant(s.grants[hash]) }
  }

  const rename = (hash, label) => {
    const s = load()
    const rec = s.grants[String(hash || '').toLowerCase()]
    if (!rec) return { ok: false, error: 'unknown_device' }
    rec.label = String(label || '').trim() || rec.label
    save(s)
    return { ok: true, grant: publicGrant(rec) }
  }

  const revoke = (hash) => {
    const s = load()
    const key = String(hash || '').toLowerCase()
    const rec = s.grants[key]
    if (!rec) return { ok: false, error: 'unknown_device' }
    const snapshot = publicGrant(rec)
    delete s.grants[key]
    for (const k of Object.keys(s.used || {})) {
      if (k.startsWith(key + ':')) delete s.used[k]
    }
    save(s)
    return { ok: true, deleted: true, grant: snapshot }
  }

  const rememberSeq = (hash, seq, ts) => {
    const s = load()
    const rec = s.grants[String(hash || '').toLowerCase()]
    if (!rec) return { ok: false, error: 'unknown_device' }
    rec.lastSeq = Math.max(Number(rec.lastSeq || 0), Number(seq))
    rec.lastSeen = Number(ts || Math.floor(Date.now() / 1000))
    s.used[`${hash}:${seq}`] = rec.lastSeen
    save(s)
    return { ok: true }
  }

  const queueIngest = (envelope) => {
    const s = load()
    s.ingest.push({ ...envelope, queuedAt: Math.floor(Date.now() / 1000) })
    // Keep a short queue so a desk can poll.
    if (s.ingest.length > 32) s.ingest = s.ingest.slice(-32)
    save(s)
    return { ok: true, queued: s.ingest.length }
  }

  const takeIngest = () => {
    const s = load()
    const next = s.ingest.shift() || null
    if (next) save(s)
    return next
  }

  const usedSet = () => new Set(Object.keys(load().used))

  return { load, list, get, putGrant, rename, revoke, rememberSeq, queueIngest, takeIngest, usedSet, persistPath }
}

const shortLabel = (pub) => `usher-phone ${String(pub || '').slice(0, 8)}`

const publicGrant = (rec) => ({
  hash: rec.hash,
  label: rec.label,
  status: rec.status,
  usher: rec.grant.usher,
  eventId: rec.grant.eventId,
  contract: rec.grant.contract,
  capabilities: rec.grant.capabilities,
  expiry: rec.grant.expiry,
  deviceSignPubkey: rec.grant.deviceSignPubkey,
  deviceNoiseStatic: rec.grant.deviceNoiseStatic,
  lastSeen: rec.lastSeen || 0,
  lastSeq: rec.lastSeq || 0,
  revokedAt: rec.revokedAt || 0,
  createdAt: rec.createdAt,
  admin: rec.admin,
})

/**
 * Verify a BLE consume against the store, then let the caller relay.
 * On success the frame counter is recorded so a replay is refused.
 */
export const checkStoredChain = async (store, body, { isAdmin, isUsher, sameRole, now, expectedEvent }) => {
  const frameText = body.frameText || body.frame?.text
  const frameSig = body.frameSig || body.frame?.sig || body.auth?.frameSig
  const grantHash = body.grantHash || body.frame?.grantHash
  if (!frameText || !frameSig) return { ok: false, error: 'missing_frame' }
  let rec = grantHash ? store.get(grantHash) : null
  if (!rec) {
    try {
      const decoded = decodeFrame(frameText)
      rec = store.get(decoded.grantHash)
    } catch {
      rec = null
    }
  }
  if (!rec) return { ok: false, error: 'unknown_device' }
  const result = await verifyDeviceChain({
    grantText: rec.grantText,
    adminSig: rec.adminSig,
    admin: rec.admin,
    status: rec.status,
    frameText,
    frameSig,
    lastSeq: rec.lastSeq,
    seen: store.usedSet(),
    consume: body.consume || body,
    consumeAuthText: body.auth?.message || body.consumeAuthText,
    auth: body.auth,
    expectedEvent: expectedEvent || rec.grant.eventId,
    now,
    isAdmin,
    isUsher,
    sameRole,
  })
  if (!result.ok) return result
  store.rememberSeq(result.grant.hash, result.frame.seq, result.frame.ts)
  return result
}

export { BLE_ERRORS, decodeGrant }
