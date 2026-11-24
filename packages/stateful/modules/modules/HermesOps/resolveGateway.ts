/**
 * Pure Hermes gateway resolution + light HTTP probe (no React).
 * Priority: explicit module fields → embedBaseUrl / deepLink → chain defaults.
 */

export type HermesGatewayEndpoints = {
  gatewayUrl: string
  opsEndpointUrl: string
  deepLinkUrl: string
  agentId: string
  communityId: string
  defaultView: string
}

const trimUrl = (v: string | undefined): string => {
  const t = (v || '').trim()
  if (!t) return ''
  return t.replace(/\/$/, '')
}

/**
 * Resolve gateway / ops endpoints for the informational Hermes Ops tab.
 */
export const resolveHermesGateway = ({
  gatewayUrl = '',
  opsEndpointUrl = '',
  deepLinkUrl = '',
  embedBaseUrl = '',
  agentId = '',
  communityId = '',
  defaultView = 'status',
  chainHttpFallback = '',
}: {
  gatewayUrl?: string
  opsEndpointUrl?: string
  deepLinkUrl?: string
  embedBaseUrl?: string
  agentId?: string
  communityId?: string
  defaultView?: string
  chainHttpFallback?: string
}): HermesGatewayEndpoints => {
  const embed = trimUrl(embedBaseUrl)
  const gateway =
    trimUrl(gatewayUrl) ||
    embed ||
    trimUrl(deepLinkUrl) ||
    trimUrl(chainHttpFallback) ||
    ''
  const ops = trimUrl(opsEndpointUrl) || gateway
  return {
    gatewayUrl: gateway,
    opsEndpointUrl: ops,
    deepLinkUrl: trimUrl(deepLinkUrl) || gateway,
    agentId: (agentId || '').trim(),
    communityId: (communityId || '').trim(),
    defaultView: (defaultView || 'status').trim() || 'status',
  }
}

/**
 * Build an external open URL for Hermes Ops (new tab). Soft query params only.
 */
export const buildHermesOpenUrl = (
  gatewayUrl: string,
  {
    defaultView,
    agentId,
    communityId,
    daoAddress,
    chainId,
  }: {
    defaultView?: string
    agentId?: string
    communityId?: string
    daoAddress?: string
    chainId?: string
  } = {}
): string => {
  const base = trimUrl(gatewayUrl)
  if (!base) return ''
  try {
    const url = new URL(base.includes('://') ? base : `https://${base}`)
    if (defaultView) url.searchParams.set('view', defaultView)
    if (agentId) url.searchParams.set('agent', agentId)
    if (communityId) url.searchParams.set('community', communityId)
    if (daoAddress) url.searchParams.set('dao', daoAddress)
    if (chainId) url.searchParams.set('chain', chainId)
    url.searchParams.set('parent', 'daodao')
    return url.toString()
  } catch {
    return base
  }
}

export type HermesGatewayProbeResult = {
  state: 'ok' | 'error' | 'unreachable'
  detail: string
  status?: number
}

/**
 * Light HTTP probe — never throws; CORS/offline → unreachable.
 */
export const probeGatewayHttp = async (
  gatewayUrl: string,
  timeoutMs = 6_000
): Promise<HermesGatewayProbeResult> => {
  const base = trimUrl(gatewayUrl)
  if (!base) {
    return { state: 'unreachable', detail: 'no gateway url' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let res = await fetch(base, {
      method: 'HEAD',
      mode: 'cors',
      signal: controller.signal,
    }).catch(() => null)
    if (!res) {
      res = await fetch(base, {
        method: 'GET',
        mode: 'cors',
        signal: controller.signal,
      })
    }
    const detail = `HTTP ${res.status} ${res.statusText || ''}`.trim()
    if (res.ok || res.status === 405 || res.status === 404) {
      return {
        state: res.ok ? 'ok' : res.status >= 500 ? 'error' : 'ok',
        detail,
        status: res.status,
      }
    }
    if (res.status >= 500) {
      return { state: 'error', detail, status: res.status }
    }
    return { state: 'ok', detail, status: res.status }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { state: 'unreachable', detail: msg.slice(0, 200) }
  } finally {
    clearTimeout(timer)
  }
}
