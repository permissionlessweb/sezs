/**
 * Resolve Buzz / NOSA relayer HTTP + WSS for Event Hub / Buzz tab.
 *
 * Preference: module vars → embedBaseUrl → chain/env fallbacks.
 * Never invent public relays. Soft-empty when nothing is configured.
 *
 * Identity: Nostr keys live in the Buzz client — this helper only
 * publishes URLs. Do not mix ADR-36 / Hermes tokens here.
 *
 * Event-night SSOT: docs/superpowers/orch/event-night-2026-08-07/NOSTR-ENV.md
 */

export type BuzzRelayerEndpoints = {
  httpUrl: string
  wssUrl: string
  communityId: string
  displayName: string
  /** Where the winning HTTP/WSS came from (for devops disclosure). */
  source: 'module' | 'embed' | 'chain' | 'empty'
}

export type ResolveBuzzRelayerInput = {
  relayerHttpUrl?: string
  relayerWssUrl?: string
  embedBaseUrl?: string
  communityId?: string
  displayName?: string
  chainHttpFallback?: string
  chainWssFallback?: string
}

const stripTrailingSlash = (u: string): string => u.replace(/\/+$/, '')

const isHttp = (u: string): boolean => /^https?:\/\//i.test(u)
const isWs = (u: string): boolean => /^wss?:\/\//i.test(u)

/** http(s) ↔ ws(s) origin conversion (path stripped). */
export const httpToWss = (httpUrl: string): string => {
  try {
    const u = new URL(httpUrl)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    u.pathname = ''
    u.search = ''
    u.hash = ''
    return stripTrailingSlash(u.toString())
  } catch {
    return ''
  }
}

export const wssToHttp = (wssUrl: string): string => {
  try {
    const u = new URL(wssUrl)
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'
    u.pathname = ''
    u.search = ''
    u.hash = ''
    return stripTrailingSlash(u.toString())
  } catch {
    return ''
  }
}

/**
 * Resolve display HTTP + WSS for the Buzz tab / open-in-client links.
 */
export function resolveBuzzRelayer(
  input: ResolveBuzzRelayerInput
): BuzzRelayerEndpoints {
  const communityId = (input.communityId || '').trim()
  const displayName = (input.displayName || '').trim()

  const modHttp = (input.relayerHttpUrl || '').trim()
  const modWss = (input.relayerWssUrl || '').trim()
  const embed = (input.embedBaseUrl || '').trim()
  const chainHttp = (input.chainHttpFallback || '').trim()
  const chainWss = (input.chainWssFallback || '').trim()

  let httpUrl = ''
  let wssUrl = ''
  let source: BuzzRelayerEndpoints['source'] = 'empty'

  if (modHttp && isHttp(modHttp)) {
    httpUrl = stripTrailingSlash(modHttp)
    source = 'module'
  }
  if (modWss && isWs(modWss)) {
    wssUrl = stripTrailingSlash(modWss)
    if (source === 'empty') source = 'module'
  }

  if (!httpUrl && embed && isHttp(embed)) {
    httpUrl = stripTrailingSlash(embed)
    if (source === 'empty') source = 'embed'
  }

  if (!httpUrl && chainHttp && isHttp(chainHttp)) {
    httpUrl = stripTrailingSlash(chainHttp)
    if (source === 'empty') source = 'chain'
  }
  if (!wssUrl && chainWss && isWs(chainWss)) {
    wssUrl = stripTrailingSlash(chainWss)
    if (source === 'empty') source = 'chain'
  }

  // Derive missing sibling
  if (httpUrl && !wssUrl) {
    wssUrl = httpToWss(httpUrl)
  }
  if (wssUrl && !httpUrl) {
    httpUrl = wssToHttp(wssUrl)
  }

  return {
    httpUrl,
    wssUrl,
    communityId,
    displayName,
    source: httpUrl || wssUrl ? source : 'empty',
  }
}

/**
 * Build an "Open Buzz" URL. Prefer plain HTTP base; append discovery query
 * params when present. Does not force /embed (relay root may be NIP-11 only).
 */
export function buildBuzzOpenUrl(
  httpUrl: string,
  opts?: {
    communityId?: string
    daoAddress?: string
    chainId?: string
  }
): string {
  const base = (httpUrl || '').trim()
  if (!base || !isHttp(base)) return ''

  try {
    const u = new URL(base)
    if (opts?.communityId) u.searchParams.set('community', opts.communityId)
    if (opts?.daoAddress) u.searchParams.set('dao', opts.daoAddress)
    if (opts?.chainId) u.searchParams.set('chain_id', opts.chainId)
    return u.toString()
  } catch {
    return stripTrailingSlash(base)
  }
}

export type RelayerProbeResult = {
  state: 'ok' | 'error' | 'unreachable'
  detail: string
  status?: number
}

/**
 * Light HTTP probe — NIP-11 Accept header preferred; falls back to GET root.
 * Soft failures only (never throws).
 */
export async function probeRelayerHttp(
  httpUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 4000
): Promise<RelayerProbeResult> {
  const base = (httpUrl || '').trim()
  if (!base || !isHttp(base)) {
    return { state: 'unreachable', detail: 'no http url' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // Prefer liveness if Buzz compose exposes it
    for (const path of ['/_liveness', '/']) {
      try {
        const url = `${stripTrailingSlash(base)}${path === '/' ? '/' : path}`
        const res = await fetchImpl(url, {
          method: 'GET',
          signal: controller.signal,
          headers:
            path === '/'
              ? { Accept: 'application/nostr+json' }
              : { Accept: 'text/plain, application/json, */*' },
        })
        if (res.ok) {
          const ctype = res.headers.get('content-type') || ''
          let hint = `${res.status} ${path}`
          if (ctype.includes('json') || ctype.includes('nostr')) {
            try {
              const body = (await res.json()) as { name?: string; version?: string }
              if (body?.name) hint += ` name=${body.name}`
              if (body?.version) hint += ` v=${body.version}`
            } catch {
              // ignore body parse
            }
          }
          return { state: 'ok', detail: hint, status: res.status }
        }
        if (res.status >= 500) {
          return {
            state: 'error',
            detail: `HTTP ${res.status} on ${path}`,
            status: res.status,
          }
        }
        // 404 on /_liveness → try next path
      } catch {
        // try next path
      }
    }
    return { state: 'unreachable', detail: 'no successful HTTP response' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { state: 'unreachable', detail: msg }
  } finally {
    clearTimeout(timer)
  }
}
