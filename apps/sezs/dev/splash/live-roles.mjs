/**
 * Live membership check against the event contract Roles query and/or a
 * cw420 group on the local LCD. ZID / passkey unlock is the session cookie;
 * this module confirms the unlocked address is on the coordinator or usher set.
 * Never queries mainnet LCDs. ListMembers is not used as a door attendance list.
 */
import { canManagePayroll } from '../../src/auth/roles.mjs'

const mainnetLcd = (lcd) => /terp\.network|morocco-1|mainnet|publicnode/i.test(String(lcd || ''))

const loopbackLcd = (lcd) => {
  try {
    const u = new URL(lcd)
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1'
  } catch {
    return false
  }
}

export const refuseLcd = (lcd) => {
  if (!lcd) return 'missing_lcd'
  if (mainnetLcd(lcd) || !loopbackLcd(lcd)) return 'lcd_refused'
  return null
}

const smartQuery = async (lcd, contract, msg) => {
  const refused = refuseLcd(lcd)
  if (refused) throw new Error(refused)
  if (!contract || !/^terp1[a-z0-9]+$/i.test(contract) && !/^sezs1/i.test(contract) && !/^[a-z0-9]{3,}/i.test(contract)) {
    throw new Error('bad_contract')
  }
  const q = Buffer.from(JSON.stringify(msg)).toString('base64')
  const url = `${String(lcd).replace(/\/$/, '')}/cosmwasm/wasm/v1/contract/${contract}/smart/${q}`
  const res = await fetch(url, { credentials: 'omit', cache: 'no-store' })
  if (!res.ok) throw new Error(`group_query_${res.status}`)
  return res.json()
}

const addrsOf = (data) => {
  const out = []
  const walk = (v) => {
    if (!v) return
    if (typeof v === 'string') {
      if (/^(terp1|sezs1)/i.test(v) || /^[a-z]+1[a-z0-9]+$/.test(v)) out.push(v)
      return
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x)
      return
    }
    if (typeof v === 'object') {
      if (v.addr) walk(v.addr)
      if (v.address) walk(v.address)
      if (v.member) walk(v.member)
      if (v.members) walk(v.members)
      if (v.coordinators) walk(v.coordinators)
      if (v.ushers) walk(v.ushers)
      if (v.data) walk(v.data)
    }
  }
  walk(data)
  return [...new Set(out)]
}

export const queryGroupMembers = async (lcd, group, queries) => {
  const errs = []
  for (const msg of queries || [{ list_members: {} }, { members: {} }, { list_members: { limit: 100 } }]) {
    try {
      const data = await smartQuery(lcd, group, msg)
      return addrsOf(data)
    } catch (e) {
      errs.push(String(e?.message || e))
    }
  }
  throw new Error(errs[0] || 'group_query_failed')
}

/**
 * @param {{ lcd?: string, contract?: string, coordinatorsGroup?: string, usherGroup?: string, fetchRoles?: Function }} cfg
 * @param {{ address?: string, sessionRole?: string }} who
 */

/** Query the event contract Roles view. Loopback LCD only. */
export const queryEventRoles = async (lcd, contract) => {
  if (!lcd || !contract) {
    return { curators: [], coordinators: [], ushers: [], coordinatorsGroup: "", usherGroup: "", serviceKey: "" }
  }
  const raw = await smartQuery(lcd, contract, { roles: {} })
  const body = raw?.data || raw || {}
  return {
    curators: addrsOf(body.curators),
    coordinators: addrsOf(body.coordinators),
    ushers: addrsOf(body.ushers),
    coordinatorsGroup: body.coordinators_group || "",
    usherGroup: body.usher_group || "",
    serviceKey: body.service_key || "",
  }
}

export const resolveLiveRole = async (cfg, who) => {
  const address = String(who?.address || '')
  const sessionRole = who?.sessionRole || null
  if (!cfg?.lcd) return { role: sessionRole, source: 'session', live: false }
  const refused = refuseLcd(cfg.lcd)
  if (refused) return { role: null, source: refused, live: false, error: refused }

  let coordinators = []
  let ushers = []
  let curators = []
  let source = 'session'
  try {
    // Production default: the event contract Roles view.
    if (typeof cfg.fetchRoles === 'function') {
      const roles = await cfg.fetchRoles(cfg)
      curators = roles.curators || []
      coordinators = roles.coordinators || []
      ushers = roles.ushers || []
      source = 'event_roles'
    } else if (cfg.contract) {
      const roles = await queryEventRoles(cfg.lcd, cfg.contract)
      curators = roles.curators || []
      coordinators = roles.coordinators || []
      ushers = roles.ushers || []
      source = 'event_roles'
    }
    if (cfg.coordinatorsGroup) {
      coordinators = coordinators.concat(await queryGroupMembers(cfg.lcd, cfg.coordinatorsGroup))
      if (source === 'session') source = 'cw420'
    }
    if (cfg.usherGroup) {
      ushers = ushers.concat(await queryGroupMembers(cfg.lcd, cfg.usherGroup))
      if (source === 'session') source = 'cw420'
    }
  } catch (e) {
    return { role: null, source: 'query_failed', live: true, error: String(e?.message || e) }
  }

  const has = (list) => address && list.some((a) => a.toLowerCase() === address.toLowerCase())
  const liveConfigured = !!(cfg.contract || cfg.coordinatorsGroup || cfg.usherGroup || cfg.fetchRoles)
  if (has(curators) || has(coordinators)) {
    return { role: sessionRole === 'admin' ? 'admin' : 'coordinator', source, live: true }
  }
  if (has(ushers)) return { role: 'usher', source, live: true }
  if (liveConfigured) return { role: 'guest', source, live: true }
  if (canManagePayroll(sessionRole)) {
    return { role: sessionRole === 'admin' ? 'admin' : 'coordinator', source: 'session', live: false }
  }
  return { role: sessionRole, source: 'session', live: false }
}
