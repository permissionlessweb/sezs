/**
 * Coordinator-gated payroll HTTP handlers for the splash board.
 */
import * as P from './payroll.mjs'
import { assertLocalRelay } from '../../src/zafu/relay-guard.mjs'
import { runPayrollCeremony } from '../../src/frost/payroll-ceremony.mjs'
import { refusalFor } from '../../src/auth/roles.mjs'
import { resolveLiveRole } from './live-roles.mjs'

const shareOrigins = () => ({
  local: process.env.SEZS_SPLASH_APP || 'http://127.0.0.1:3051',
  publicSite: 'https://permissionless.money/sez',
})

export const shareUrls = (key) => {
  const { local, publicSite } = shareOrigins()
  return {
    local: `${local}/register?c=${encodeURIComponent(key)}`,
    public: `${publicSite}/register?c=${encodeURIComponent(key)}`,
  }
}

export const makePayrollHandlers = ({ cookieOf, roleOf, persistPath, bouncerUrl, addressOf, liveConfig }) => {
  const path = () => persistPath
  const requireCoordinator = async (req) => {
    const id = cookieOf(req)
    if (!id) return [403, { ok: false, ...refusalFor(null) }]
    let role = roleOf(id)
    const cfg = typeof liveConfig === 'function' ? liveConfig() : liveConfig
    if (cfg?.lcd) {
      try {
        const live = await resolveLiveRole(cfg, {
          address: addressOf ? addressOf(id) : '',
          sessionRole: role,
        })
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

  return {
    'GET /sezs/payroll/state': async (req) => {
      const denied = await requireCoordinator(req)
      if (denied) return denied
      return [200, P.listPublic(P.loadPayroll(path()))]
    },
    'POST /sezs/payroll/invites': async (req, b) => {
      const denied = await requireCoordinator(req)
      if (denied) return denied
      const state = P.loadPayroll(path())
      const r = P.createInvite(state, { role: b.role, label: b.label })
      if (!r.ok) return [200, r]
      P.savePayroll(state, path())
      return [200, { ok: true, invite: r.invite, share: shareUrls(r.key), key: r.key }]
    },
    'POST /sezs/payroll/register': (_req, b) => {
      const state = P.loadPayroll(path())
      const r = P.registerWithKey(state, b)
      if (!r.ok) return [200, r]
      P.savePayroll(state, path())
      return [200, r]
    },
    'POST /sezs/payroll/amounts': async (req, b) => {
      const denied = await requireCoordinator(req)
      if (denied) return denied
      const state = P.loadPayroll(path())
      const r = P.setAmounts(state, b)
      if (!r.ok) return [200, r]
      P.savePayroll(state, path())
      return [200, { ok: true, ...P.listPublic(state) }]
    },
    'POST /sezs/payroll/batches': async (req, b) => {
      const denied = await requireCoordinator(req)
      if (denied) return denied
      const state = P.loadPayroll(path())
      const r = P.proposeBatch(state, { note: b.note })
      if (!r.ok) return [200, r]
      P.savePayroll(state, path())
      return [200, r]
    },
    'POST /sezs/payroll/batches/frost': async (req, b) => {
      const denied = await requireCoordinator(req)
      if (denied) return denied
      const batchId = String(b.batchId || '')
      const host = bouncerUrl()
      assertLocalRelay(host, 'payroll FROST bouncer')
      const state = P.loadPayroll(path())
      const batch = state.batches.find((x) => x.id === batchId)
      if (!batch) return [200, { ok: false, error: 'unknown_batch' }]
      const marked = P.markSigning(state, batchId, null)
      if (!marked.ok) return [200, marked]
      P.savePayroll(state, path())
      try {
        const result = await runPayrollCeremony({ host, digestHex: batch.digest })
        const next = P.loadPayroll(path())
        P.markSigning(next, batchId, result.sessionId)
        const acc = P.acceptSignature(next, {
          batchId,
          signature: JSON.stringify(result.signature),
          pubkey: JSON.stringify(result.verifyingKey),
        })
        if (!acc.ok) return [200, acc]
        P.savePayroll(next, path())
        return [200, { ok: true, batch: acc.batch, sessionId: result.sessionId, via: host }]
      } catch (e) {
        return [200, { ok: false, error: e instanceof Error ? e.message : 'frost_failed' }]
      }
    },
    'POST /sezs/payroll/batches/execute': async (req, b) => {
      const denied = await requireCoordinator(req)
      if (denied) return denied
      const state = P.loadPayroll(path())
      const r = await P.executeBatch(state, String(b.batchId || ''))
      if (!r.ok) return [200, r]
      P.savePayroll(state, path())
      return [200, r]
    },
  }
}

export const emptyPayrollState = () => ({
  version: 1,
  invites: [],
  participants: [],
  batches: [],
  splits: { charity: 0.111, venue: 0.111, remainder: 0.778 },
  roleAmounts: { artist: '', vendor: '', staff: '', usher: '' },
})

export const resetPayrollFile = (persistPath) => {
  P.savePayroll(emptyPayrollState(), persistPath)
}
