/**
 * Loopback HTTP API for reading event coordinator / usher roles held on
 * the event contract (cw420 groups). Membership changes are executed by
 * the coordinator in Zafu (update_members), not by this backend.
 */
import { queryEventRoles } from './live-roles.mjs'

const asUshers = (addrs) => (addrs || []).map((terp) => ({ terp }))

const snapshot = (eventId, roles) => ({
  ok: true,
  eventId,
  coordinators: roles.coordinators || [],
  curators: roles.curators || [],
  ushers: asUshers(roles.ushers),
  coordinatorsGroup: roles.coordinatorsGroup || '',
  usherGroup: roles.usherGroup || '',
  signing: { methods: ['zafu-tx'] },
})

export const makeRoleHandlers = ({ liveCfg, eventIdOf }) => {
  const load = async () => {
    const cfg = typeof liveCfg === 'function' ? liveCfg() : liveCfg || {}
    if (!cfg.contract) return { ok: false, error: 'no_event_contract' }
    const roles = await queryEventRoles(cfg.lcd, cfg.contract)
    return { ok: true, cfg, roles, eventId: eventIdOf ? eventIdOf() : '' }
  }

  const list = async () => {
    const r = await load()
    if (!r.ok) return [200, r]
    return [200, snapshot(r.eventId, r.roles)]
  }

  const useWallet = async (_req, b) => {
    const r = await load()
    if (!r.ok) return [200, r]
    const group = r.cfg.usherGroup || r.roles.usherGroup
    const usher = String(b?.usher || b?.address || '')
    const remove = !!b?.remove
    const msg = remove
      ? { update_members: { add: [], remove: usher ? [usher] : [] } }
      : { update_members: { add: usher ? [{ addr: usher, weight: 1 }] : [], remove: [] } }
    return [200, {
      ok: false,
      error: 'use_wallet_execute',
      execute: { contract: group, msg },
    }]
  }

  return {
    'GET /sezs/v2/event/roles': list,
    'POST /sezs/v2/event/roles/usher': useWallet,
    'POST /sezs/v2/event/roles/coordinator/bind': async () => [200, { ok: false, error: 'removed' }],
    'POST /sezs/v2/event/roles/usher/remove': useWallet,
  }
}
