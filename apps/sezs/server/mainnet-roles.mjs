/**
 * Mainnet (or local morocco-1 node) role reader for SEZS event contracts.
 * Queries `{ roles: {} }` via CosmWasm smart query with a short TTL cache
 * and strict allowlist of configured event contracts.
 */

const BECH32_CONTRACT_RE = /^terp1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38,58}$/

export const parseContracts = (raw) => {
  const seen = new Set()
  const out = []
  for (const part of String(raw || '').split(',')) {
    const c = part.trim()
    if (!c || seen.has(c) || !BECH32_CONTRACT_RE.test(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

export const validateLcdUrl = (lcd) => {
  if (!lcd) return 'missing_lcd'
  try {
    const u = new URL(lcd)
    const loop = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1' || u.hostname === '[::1]'
    if (u.protocol === 'https:') return null
    if (u.protocol === 'http:' && loop) return null
    return 'lcd_refused'
  } catch {
    return 'bad_lcd'
  }
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
      for (const k of ['addr', 'address', 'member', 'members', 'curators', 'coordinators', 'ushers', 'data']) {
        if (v[k]) walk(v[k])
      }
    }
  }
  walk(data)
  return [...new Set(out)]
}

export const makeMainnetRoleReader = ({
  lcd = 'https://api.terp.network',
  contracts = [],
  cacheTtlMs = 15_000,
  timeoutMs = 3_000,
  fetchImpl = globalThis.fetch,
} = {}) => {
  const allowed = Array.isArray(contracts) ? contracts.filter((c) => BECH32_CONTRACT_RE.test(c)) : parseContracts(contracts)
  const allowedSet = new Set(allowed)
  const cache = new Map() // contract -> { exp, data }

  const queryContractRoles = async (contract) => {
    const refused = validateLcdUrl(lcd)
    if (refused) throw new Error(refused)
    if (!BECH32_CONTRACT_RE.test(contract)) throw new Error('bad_contract')

    const now = Date.now()
    const cached = cache.get(contract)
    if (cached && cached.exp > now) return cached.data

    const q = Buffer.from(JSON.stringify({ roles: {} })).toString('base64')
    const url = `${String(lcd).replace(/\/$/, '')}/cosmwasm/wasm/v1/contract/${contract}/smart/${q}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    timer.unref?.()
    let res
    try {
      res = await fetchImpl(url, { credentials: 'omit', cache: 'no-store', signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new Error(`role_query_${res.status}`)
    const raw = await res.json()
    const body = raw?.data || raw || {}
    const parsed = {
      contract,
      curators: addrsOf(body.curators),
      coordinators: addrsOf(body.coordinators),
      ushers: addrsOf(body.ushers),
      coordinatorsGroup: String(body.coordinators_group || ''),
      usherGroup: String(body.usher_group || ''),
      serviceKey: String(body.service_key || ''),
    }
    if (cache.size >= 64) {
      const oldest = cache.keys().next().value
      cache.delete(oldest)
    }
    cache.set(contract, { exp: now + cacheTtlMs, data: parsed })
    return parsed
  }

  const resolveContract = (requested) => {
    const clean = String(requested || '').trim()
    if (!clean) {
      if (!allowed.length) return { ok: false, error: 'no_event_contract' }
      return { ok: true, contract: allowed[0] }
    }
    if (!BECH32_CONTRACT_RE.test(clean)) return { ok: false, error: 'bad_contract' }
    if (allowedSet.size && !allowedSet.has(clean)) return { ok: false, error: 'unknown_contract' }
    return { ok: true, contract: clean }
  }

  const getEventRoles = async (requestedContract) => {
    const pick = resolveContract(requestedContract)
    if (!pick.ok) return pick
    try {
      const roles = await queryContractRoles(pick.contract)
      return {
        ok: true,
        contract: pick.contract,
        contracts: allowed,
        coordinators: roles.coordinators,
        curators: roles.curators,
        ushers: roles.ushers.map((terp) => ({ terp })),
        coordinatorsGroup: roles.coordinatorsGroup,
        usherGroup: roles.usherGroup,
        signing: { methods: ['zafu-tx'] },
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'role_query_failed' }
    }
  }

  const resolveAddressRole = async (address, requestedContract) => {
    if (!address || !/^terp1[a-z0-9]{20,}$/i.test(address)) {
      return { role: 'guest', source: 'session', live: allowed.length > 0 }
    }
    const targetList = requestedContract
      ? (() => {
          const pick = resolveContract(requestedContract)
          return pick.ok ? [pick.contract] : []
        })()
      : allowed
    if (!targetList.length) {
      return { role: 'guest', source: 'session', live: false }
    }
    const lower = address.toLowerCase()
    const has = (list) => list.some((a) => a.toLowerCase() === lower)
    try {
      for (const c of targetList) {
        const roles = await queryContractRoles(c)
        if (has(roles.curators) || has(roles.coordinators)) {
          return { role: 'coordinator', source: 'event_roles', live: true, contract: c }
        }
        if (has(roles.ushers)) {
          return { role: 'usher', source: 'event_roles', live: true, contract: c }
        }
      }
      return { role: 'guest', source: 'event_roles', live: true }
    } catch (e) {
      return { role: null, source: 'query_failed', live: true, error: e instanceof Error ? e.message : 'role_query_failed' }
    }
  }

  return {
    allowedContracts: () => [...allowed],
    getEventRoles,
    resolveAddressRole,
  }
}
