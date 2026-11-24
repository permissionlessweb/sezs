/**
 * Shared staff check for admin data endpoints. A missing session is a
 * refusal. When a local LCD is configured, the live role wins.
 */
import { refusalFor } from '../../src/auth/roles.mjs'
import { resolveLiveRole } from './live-roles.mjs'

export const requireStaff = async (req, { cookieOf, roleOf, addressOf, liveConfig }) => {
  const id = cookieOf(req)
  if (!id) return [403, { ok: false, ...refusalFor(null) }]
  let role = roleOf ? roleOf(id) : null
  const cfg = typeof liveConfig === 'function' ? liveConfig() : liveConfig
  const address = addressOf ? addressOf(id) : ''
  if (cfg?.lcd) {
    try {
      const live = await resolveLiveRole(cfg, { address, sessionRole: role })
      if (live?.role) role = live.role
      else if (live?.error && live.live) return [403, { ok: false, error: 'role_query_failed' }]
    } catch {
      return [403, { ok: false, error: 'role_query_failed' }]
    }
  }
  const denied = refusalFor(role)
  if (denied) return [403, { ok: false, ...denied }]
  return null
}
