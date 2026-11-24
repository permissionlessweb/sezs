/**
 * Loopback HTTP API for usher-device grants and frame ingest.
 * Mounted on the splash server. Guarded by the existing loopback host
 * checks in server.mjs.
 */
import { checkStoredChain } from './ble-grants.mjs'

export const makeBleHandlers = ({ store, isAdmin, isUsher, eventIdOf, requireStaff }) => {
  const staff = async (req) => (requireStaff ? requireStaff(req) : null)
  const list = async (req) => {
    const denied = await staff(req)
    if (denied) return denied
    return [200, { ok: true, devices: store.list() }]
  }

  const register = async (_req, b) => {
    const r = await store.putGrant({
      grantText: b.grantText || b.grant?.text,
      adminSig: b.adminSig || b.auth,
      admin: b.admin || b.adminSig?.signer,
      label: b.label,
      isAdmin,
    })
    return [200, r]
  }

  const rename = async (req, b) => {
    const denied = await staff(req)
    if (denied) return denied
    return [200, store.rename(b.hash || b.grantHash, b.label)]
  }
  const revoke = async (req, b) => {
    const denied = await staff(req)
    if (denied) return denied
    return [200, store.revoke(b.hash || b.grantHash)]
  }

  const ingest = async (_req, b) => {
    if (!b?.frameText && !b?.frame?.text) return [200, { ok: false, error: 'missing_frame' }]
    store.queueIngest({
      frameText: b.frameText || b.frame?.text,
      frameSig: b.frameSig || b.frame?.sig,
      grantHash: b.grantHash || b.frame?.grantHash,
      source: b.source || 'helper',
    })
    return [200, { ok: true }]
  }

  const next = async () => {
    const frame = store.takeIngest()
    return [200, frame ? { ok: true, frame } : { ok: true, frame: null }]
  }

  const verify = async (_req, b) => {
    const r = await checkStoredChain(store, b, {
      isAdmin,
      isUsher,
      expectedEvent: b.eventId || eventIdOf?.(),
    })
    return [200, r.ok ? { ok: true, grant: { hash: r.grant.hash, usher: r.grant.usher }, frame: { seq: r.frame.seq, hash: r.frame.hash } } : { ok: false, error: r.error }]
  }

  return {
    'GET /sezs/v2/door/device/grants': list,
    'POST /sezs/v2/door/device/grant': register,
    'POST /sezs/v2/door/device/rename': rename,
    'POST /sezs/v2/door/device/revoke': revoke,
    'POST /sezs/v2/door/device/ingest': ingest,
    'GET /sezs/v2/door/device/next': next,
    'POST /sezs/v2/door/device/verify': verify,
  }
}
