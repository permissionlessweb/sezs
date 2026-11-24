/**
 * Public metadata for the admin FROST group key. Never reads or returns
 * share material from set.json.
 */
import { loadAdminMeta, adminSetReady, adminDirOf } from '../../src/frost/admin-set.mjs'
import { requireStaff } from './staff-guard.mjs'
import { refuseLcd } from './live-roles.mjs'

const consumeConfig = async (lcd, contract) => {
  if (!lcd || !contract || refuseLcd(lcd)) return null
  try {
    const q = Buffer.from(JSON.stringify({ consume_config: {} })).toString('base64')
    const url = `${String(lcd).replace(/\/$/, '')}/cosmwasm/wasm/v1/contract/${contract}/smart/${q}`
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store' })
    if (!res.ok) return null
    const raw = await res.json()
    const body = raw?.data || raw || {}
    const out = {}
    if (body.epoch != null) out.epoch = Number(body.epoch)
    if (body.leaf_count != null) out.leafCount = Number(body.leaf_count)
    if (body.guest_root) out.guestRoot = String(body.guest_root)
    return out
  } catch {
    return null
  }
}

export const makeFrostAdminHandlers = ({ cookieOf, roleOf, addressOf, liveConfig }) => {
  const get = async (req) => {
    const denied = await requireStaff(req, { cookieOf, roleOf, addressOf, liveConfig })
    if (denied) return denied
    const dir = adminDirOf()
    const meta = loadAdminMeta(dir)
    const ready = adminSetReady(dir)
    const cfg = typeof liveConfig === 'function' ? liveConfig() : liveConfig || {}
    const chain = await consumeConfig(cfg.lcd, cfg.contract)
    const body = { ok: true, ready: !!ready }
    if (meta && typeof meta.t === 'number') body.t = meta.t
    if (meta && typeof meta.n === 'number') body.n = meta.n
    if (meta && meta.verifyingKey) body.verifyingKey = String(meta.verifyingKey)
    if (meta && meta.createdAt) body.createdAt = meta.createdAt
    if (chain) Object.assign(body, chain)
    return [200, body]
  }

  return {
    'GET /sezs/frost/admin-set': get,
  }
}
