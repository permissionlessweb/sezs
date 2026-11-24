/**
 * Browser-side component probes for CommunityInfra.
 * Honest CORS / offline semantics — never invent green without evidence.
 * M2: multi-instance resolution + LAB-IMAGE-DIGESTS pins.
 */

import {
  COLLAB_MESH_ENDPOINTS_SEED,
  COMMUNITY_INFRA_PROBE_TIMEOUT_MS,
  DEFAULT_HERMES_BOARD_LABEL,
  DEFAULT_MULTI_INSTANCES,
  DEFAULT_REGISTRY_POINTER,
  LAB_ENDPOINTS_SSOT_SEED,
  LAB_IMAGE_DIGEST_CATALOG,
  LAB_LOCAL_ENDPOINTS_SEED,
  ROLE_DIGEST_KEY,
} from './constants'
import type {
  CommunityInfraComponentRow,
  CommunityInfraDigestPin,
  CommunityInfraHealth,
  CommunityInfraInstanceConfig,
  CommunityInfraLocation,
  CommunityInfraModuleData,
  CommunityInfraResolvedInstance,
  CommunityInfraRole,
} from './types'

const roleUrlOverride = (
  role: CommunityInfraRole,
  data: Pick<
    CommunityInfraInstanceConfig,
    | 'chainRpcUrl'
    | 'chainLcdUrl'
    | 'faucetUrl'
    | 'buzzCanonicalUrl'
    | 'buzzDualUrl'
    | 'hashMerchantUrl'
    | 'registryPointer'
  >
): string | undefined => {
  switch (role) {
    case 'chain_rpc':
      return data.chainRpcUrl?.trim() || undefined
    case 'chain_lcd':
      return data.chainLcdUrl?.trim() || undefined
    case 'faucet':
      return data.faucetUrl?.trim() || undefined
    case 'buzz':
      return data.buzzCanonicalUrl?.trim() || undefined
    case 'buzz_dual':
      return data.buzzDualUrl?.trim() || undefined
    case 'hashmerchant':
      return data.hashMerchantUrl?.trim() || undefined
    case 'registry':
      return data.registryPointer?.startsWith('http')
        ? data.registryPointer.trim()
        : undefined
    default:
      return undefined
  }
}

const seedForProfile = (
  profile: CommunityInfraInstanceConfig['seedProfile']
): Omit<
  CommunityInfraComponentRow,
  'health' | 'lastProbeAt' | 'reason' | 'digest' | 'instanceId' | 'instanceLabel'
>[] => {
  switch (profile) {
    case 'collab_mesh':
      return COLLAB_MESH_ENDPOINTS_SEED
    case 'custom':
      return []
    case 'lab_local':
    default:
      return LAB_LOCAL_ENDPOINTS_SEED
  }
}

const digestForRole = (
  role: CommunityInfraRole,
  enabled: boolean
): CommunityInfraDigestPin | undefined => {
  if (!enabled) return undefined
  const key = ROLE_DIGEST_KEY[role]
  if (!key) return undefined
  return LAB_IMAGE_DIGEST_CATALOG[key]
}

/**
 * Build matrix rows for a single instance config.
 */
export const buildInstanceRows = (
  instance: CommunityInfraInstanceConfig,
  opts: {
    useLabImageDigests: boolean
    defaultHermesDeepLink?: string
    defaultHermesBoardLabel?: string
    defaultRegistryPointer?: string
  }
): CommunityInfraComponentRow[] => {
  const useSeed = instance.useEndpointsSsotDefaults !== false
  const seed = useSeed
    ? seedForProfile(instance.seedProfile || 'lab_local')
    : []

  const byRole = new Map<CommunityInfraRole, CommunityInfraComponentRow>()

  for (const s of seed) {
    const digest = digestForRole(s.role, opts.useLabImageDigests)
    byRole.set(s.role, {
      ...s,
      health: 'unknown',
      digest,
      instanceId: instance.id,
      instanceLabel: instance.label,
      location: s.location || instance.location,
    })
  }

  for (const role of [
    'chain_rpc',
    'chain_lcd',
    'faucet',
    'buzz',
    'buzz_dual',
    'hashmerchant',
    'registry',
  ] as CommunityInfraRole[]) {
    const override = roleUrlOverride(role, instance)
    const existing = byRole.get(role)
    if (override) {
      const digest = digestForRole(role, opts.useLabImageDigests)
      if (existing) {
        byRole.set(role, {
          ...existing,
          url: override,
          source: 'override',
          digest: digest || existing.digest,
        })
      } else {
        byRole.set(role, {
          role,
          label: role,
          url: override,
          location: instance.location || 'unknown',
          health: 'unknown',
          source: 'override',
          digest,
          instanceId: instance.id,
          instanceLabel: instance.label,
        })
      }
    }
  }

  const boardLabel =
    instance.hermesBoardLabel?.trim() ||
    opts.defaultHermesBoardLabel ||
    DEFAULT_HERMES_BOARD_LABEL
  const hermesUrl =
    instance.hermesDeepLinkUrl?.trim() || opts.defaultHermesDeepLink || ''
  byRole.set('hermes_board', {
    role: 'hermes_board',
    label: `Hermes board (${boardLabel})`,
    url: hermesUrl,
    location: instance.location === 'local' ? 'unknown' : instance.location,
    health: hermesUrl ? 'canary' : 'red',
    reason: hermesUrl
      ? 'Label + deep-link only (no live board HTTP probe)'
      : 'No hermesDeepLinkUrl configured',
    lastProbeAt: new Date().toISOString(),
    source: 'ENDPOINTS-SSOT',
    instanceId: instance.id,
    instanceLabel: instance.label,
  })

  const reg = byRole.get('registry')
  const pointer =
    instance.registryPointer?.trim() ||
    opts.defaultRegistryPointer ||
    DEFAULT_REGISTRY_POINTER
  if (reg) {
    byRole.set('registry', {
      ...reg,
      label: `Registry (${pointer})`,
      url: pointer.startsWith('http') ? pointer : reg.url || pointer,
      digest:
        reg.digest ||
        digestForRole('registry', opts.useLabImageDigests) ||
        LAB_IMAGE_DIGEST_CATALOG.localterp,
    })
  } else if (pointer) {
    byRole.set('registry', {
      role: 'registry',
      label: `Registry (${pointer})`,
      url: pointer.startsWith('http') ? pointer : '',
      location: 'unknown',
      health: 'unknown',
      optional: true,
      source: 'LAB-IMAGE-DIGESTS',
      digest: digestForRole('registry', opts.useLabImageDigests),
      instanceId: instance.id,
      instanceLabel: instance.label,
    })
  }

  return Array.from(byRole.values())
}

/**
 * Resolve module data → list of instances (M2 multi-instance).
 * - If `instances` has entries, use them (optionally prepend primary from M1 fields
 *   when no entry has id `primary`).
 * - If empty and SSOT defaults on → DEFAULT_MULTI_INSTANCES with M1 URL overrides
 *   applied to lab-local + global hermes/registry defaults.
 * - If empty and SSOT defaults off → single primary from M1 fields only.
 */
export const resolveInstances = (
  data: CommunityInfraModuleData
): CommunityInfraInstanceConfig[] => {
  const configured = (data.instances || []).filter((i) => i?.id && i?.label)
  const useSsot = data.useEndpointsSsotDefaults !== false

  if (configured.length > 0) {
    return configured
  }

  if (!useSsot) {
    return [
      {
        id: 'primary',
        label: data.instanceLabel || 'primary',
        location: data.location || 'unknown',
        seedProfile: 'custom',
        useEndpointsSsotDefaults: false,
        chainRpcUrl: data.chainRpcUrl,
        chainLcdUrl: data.chainLcdUrl,
        faucetUrl: data.faucetUrl,
        buzzCanonicalUrl: data.buzzCanonicalUrl,
        buzzDualUrl: data.buzzDualUrl,
        hashMerchantUrl: data.hashMerchantUrl,
        hermesBoardLabel: data.hermesBoardLabel,
        hermesDeepLinkUrl: data.hermesDeepLinkUrl,
        registryPointer: data.registryPointer,
      },
    ]
  }

  // Default multi-instance: lab local + collab mesh, with M1 overrides on primary.
  return DEFAULT_MULTI_INSTANCES.map((base) => {
    if (base.id === 'lab-local') {
      return {
        ...base,
        label: data.instanceLabel || base.label,
        location: (data.location as CommunityInfraLocation) || base.location,
        chainRpcUrl: data.chainRpcUrl,
        chainLcdUrl: data.chainLcdUrl,
        faucetUrl: data.faucetUrl,
        buzzDualUrl: data.buzzDualUrl,
        hermesBoardLabel: data.hermesBoardLabel,
        hermesDeepLinkUrl: data.hermesDeepLinkUrl,
        registryPointer: data.registryPointer,
      }
    }
    if (base.id === 'collab-mesh') {
      return {
        ...base,
        buzzCanonicalUrl: data.buzzCanonicalUrl,
        hashMerchantUrl: data.hashMerchantUrl,
        hermesBoardLabel: data.hermesBoardLabel,
        hermesDeepLinkUrl: data.hermesDeepLinkUrl,
        registryPointer: data.registryPointer,
      }
    }
    return base
  })
}

/**
 * Build matrix rows from module data + optional ENDPOINTS-SSOT lab seed.
 * M1 compat: flattens all instance rows (use buildResolvedInstances for grouped).
 */
export const buildComponentRows = (
  data: CommunityInfraModuleData
): CommunityInfraComponentRow[] => {
  // M1 single-table path when callers expect one flat list without multi-instance.
  // Prefer multi-instance resolution; if only one logical "legacy" path is needed
  // for tests that check roles, keep full LAB_ENDPOINTS_SSOT_SEED when no instances
  // and defaults on — but M2 defaults to two instances which omit some roles per side.
  // For strict M1 role set in a single table, merge when use multi default.
  const instances = resolveInstances(data)
  const useDigests = data.useLabImageDigests !== false
  const opts = {
    useLabImageDigests: useDigests,
    defaultHermesDeepLink: data.hermesDeepLinkUrl,
    defaultHermesBoardLabel: data.hermesBoardLabel,
    defaultRegistryPointer: data.registryPointer,
  }

  // Special case: empty instances + defaults → M1 used a single combined seed.
  // Multi-instance default splits roles; tests still need combined roles when
  // asking buildComponentRows on DEFAULT_COMMUNITY_INFRA_VALUES.
  // We always use resolveInstances; DEFAULT_MULTI_INSTANCES covers both locations.
  const rows = instances.flatMap((inst) => buildInstanceRows(inst, opts))

  // Ensure M1 role coverage for default path: if buzz missing from lab-local
  // but present on collab-mesh, flat list still has all roles (good).
  if (rows.length === 0 && data.useEndpointsSsotDefaults !== false) {
    return LAB_ENDPOINTS_SSOT_SEED.map((s) => ({
      ...s,
      health: 'unknown' as const,
      digest: digestForRole(s.role, useDigests),
      instanceId: 'primary',
      instanceLabel: data.instanceLabel,
    }))
  }

  return rows
}

/**
 * Grouped multi-instance view for the renderer.
 */
export const buildResolvedInstances = (
  data: CommunityInfraModuleData
): CommunityInfraResolvedInstance[] => {
  const instances = resolveInstances(data)
  const useDigests = data.useLabImageDigests !== false
  const opts = {
    useLabImageDigests: useDigests,
    defaultHermesDeepLink: data.hermesDeepLinkUrl,
    defaultHermesBoardLabel: data.hermesBoardLabel,
    defaultRegistryPointer: data.registryPointer,
  }
  return instances.map((inst) => ({
    id: inst.id,
    label: inst.label,
    location: inst.location,
    rows: buildInstanceRows(inst, opts),
  }))
}

const classifyHttp = (
  status: number,
  role: CommunityInfraRole
): { health: CommunityInfraHealth; reason: string } => {
  if (status >= 200 && status < 400) {
    return { health: 'green', reason: `HTTP ${status}` }
  }
  if (status === 403 || status === 401) {
    return {
      health: role === 'hashmerchant' || role === 'registry' ? 'canary' : 'red',
      reason: `HTTP ${status} (reachable, auth/forbidden)`,
    }
  }
  return { health: 'red', reason: `HTTP ${status}` }
}

/**
 * Probe a single component URL. Handles CORS honestly as canary when the
 * browser blocks reading the body/status of an opaque response path.
 */
export const probeComponent = async (
  row: CommunityInfraComponentRow,
  timeoutMs = COMMUNITY_INFRA_PROBE_TIMEOUT_MS
): Promise<CommunityInfraComponentRow> => {
  const now = new Date().toISOString()

  if (row.role === 'hermes_board') {
    return {
      ...row,
      lastProbeAt: now,
      health: row.url ? 'canary' : 'red',
      reason: row.url
        ? 'Label + deep-link only (no live board HTTP probe)'
        : 'No deep-link URL',
    }
  }

  if (!row.url || !row.url.startsWith('http')) {
    return {
      ...row,
      lastProbeAt: now,
      health: row.optional ? 'canary' : 'red',
      reason: 'No probeable http(s) URL',
    }
  }

  let target = row.url.replace(/\/$/, '')
  if (row.probePath) {
    const path = row.probePath.startsWith('/')
      ? row.probePath
      : `/${row.probePath}`
    if (!target.endsWith(path) && !row.url.includes(path)) {
      target = `${target}${path}`
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(target, {
      method: 'GET',
      signal: controller.signal,
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit',
    })
    const { health, reason } = classifyHttp(res.status, row.role)
    return {
      ...row,
      lastProbeAt: now,
      health,
      reason: `${reason} · ${target}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const lower = msg.toLowerCase()
    let health: CommunityInfraHealth = 'red'
    let reason = msg
    if (controller.signal.aborted || lower.includes('abort')) {
      health = 'canary'
      reason = `Probe timeout after ${timeoutMs}ms · ${target}`
    } else if (
      lower.includes('failed to fetch') ||
      lower.includes('networkerror') ||
      lower.includes('load failed') ||
      lower.includes('cors')
    ) {
      health = row.optional ? 'canary' : 'red'
      reason = `Browser probe failed (offline, CORS, or unreachable) · ${target} · ${msg}`
    } else {
      reason = `${msg} · ${target}`
    }
    return {
      ...row,
      lastProbeAt: now,
      health,
      reason,
    }
  } finally {
    clearTimeout(timer)
  }
}

export const probeAllComponents = async (
  rows: CommunityInfraComponentRow[],
  timeoutMs = COMMUNITY_INFRA_PROBE_TIMEOUT_MS
): Promise<CommunityInfraComponentRow[]> =>
  Promise.all(rows.map((r) => probeComponent(r, timeoutMs)))

export const probeResolvedInstances = async (
  instances: CommunityInfraResolvedInstance[],
  timeoutMs = COMMUNITY_INFRA_PROBE_TIMEOUT_MS
): Promise<CommunityInfraResolvedInstance[]> =>
  Promise.all(
    instances.map(async (inst) => ({
      ...inst,
      rows: await probeAllComponents(inst.rows, timeoutMs),
    }))
  )
