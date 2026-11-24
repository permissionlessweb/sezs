/** One LCD smart-query client for every SEZS contract read.
 *
 * Replaces the copies that lived in event/client.ts, event/raffle-client.ts
 * and the picker. Host allowlist and the loopback same-origin proxy are
 * unchanged from those copies.
 */

const ALLOWED_LCD_HOSTS = new Set(['api.terp.network', 'testnet-api.terp.network'])
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export const lcdAllowed = (raw: string): boolean => {
  try {
    const u = new URL(raw)
    if (u.username || u.password) return false
    const host = u.hostname.toLowerCase()
    if (LOOPBACK.has(host)) return u.protocol === 'http:' || u.protocol === 'https:'
    return u.protocol === 'https:' && ALLOWED_LCD_HOSTS.has(host)
  } catch {
    return false
  }
}

/** Same-origin proxy for the loopback LCD so the browser is not blocked by CORS. */
export const lcdBase = (lcd: string): string => {
  const raw = lcd.replace(/\/$/, '')
  if (typeof window === 'undefined' || !window.location) return raw
  try {
    const u = new URL(raw)
    const here = window.location
    const loop = (h: string) => LOOPBACK.has(h)
    if (loop(u.hostname) && (here.protocol === 'http:' || here.protocol === 'https:') && loop(here.hostname)) {
      return `${here.origin}/lab-lcd`
    }
  } catch {
    /* use lcd as given */
  }
  return raw
}

const b64 = (s: string) => {
  if (typeof btoa === 'function') return btoa(s)
  return Buffer.from(s).toString('base64')
}

export const smartPath = (contract: string, msg: object) =>
  `/cosmwasm/wasm/v1/contract/${encodeURIComponent(contract)}/smart/${b64(JSON.stringify(msg))}`

export class LcdError extends Error {
  readonly status: number
  /** The LCD's own error text, e.g. "unknown variant `event_view`". */
  readonly detail: string
  constructor(message: string, status: number, detail = '') {
    super(message)
    this.name = 'LcdError'
    this.status = status
    this.detail = detail
  }
}

/** The contract does not know this query (older code). */
export const isUnknownQuery = (e: unknown, variant: string): boolean =>
  e instanceof LcdError && e.detail.includes(`unknown variant \`${variant}\``)

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Smart query. Returns the `data` field. Throws LcdError on HTTP failure. */
export async function lcdSmart<T = Record<string, unknown>>(
  lcd: string,
  contract: string,
  msg: object,
  opts: { signal?: AbortSignal; fetch?: FetchLike } = {},
): Promise<T> {
  if (!lcdAllowed(lcd)) throw new LcdError('The configured LCD is not on the allowlist.', 0)
  const f = opts.fetch || ((i, init) => fetch(i, init))
  const r = await f(`${lcdBase(lcd)}${smartPath(contract, msg)}`, {
    credentials: 'omit',
    // The shared query cache owns freshness, so skip the HTTP cache.
    cache: 'no-store',
    signal: opts.signal,
  })
  if (!r.ok) {
    let detail = ''
    try {
      detail = String(((await r.json()) as { message?: unknown }).message || '')
    } catch {
      /* non-JSON error body */
    }
    throw new LcdError(`HTTP ${r.status}`, r.status, detail)
  }
  const j = (await r.json()) as { data?: unknown }
  return (j.data ?? j) as T
}
