/** Contract event titles. Static night copy must not pass through here. */

export type ChainEvent = { title: string; start: string }

const ADDR = /^terp1[0-9a-z]{20,80}$/

export function lcdAllowed(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname
  if (host === '127.0.0.1' || host === 'localhost') return true
  if (host === 'testnet-api.terp.network' || host === 'api.terp.network') return url.protocol === 'https:'
  return false
}

/** Query URL with the host allowlist and a terp1 contract. Drops userinfo, query, and hash. */
export function smartQueryUrl(lcd: string, contract: string, msg: object): string | null {
  if (!lcdAllowed(lcd) || !ADDR.test(contract)) return null
  const url = new URL(lcd)
  const origin = `${url.protocol}//${url.host}`
  const base = url.pathname.replace(/\/$/, '')
  const segment = btoa(JSON.stringify(msg))
  return `${origin}${base}/cosmwasm/wasm/v1/contract/${contract}/smart/${segment}`
}

function titleOf(ev: Record<string, unknown>): ChainEvent | null {
  const direct = typeof ev.title === 'string' ? ev.title : ''
  const start = typeof ev.start === 'string' ? ev.start : ''
  if (direct.trim()) return { title: direct.trim(), start }
  const ext = ev.extension as { e?: string } | undefined
  if (!ext?.e) return null
  try {
    const json = JSON.parse(Buffer.from(ext.e, 'base64').toString('utf8')) as {
      title?: string
      start?: string
    }
    if (!json.title?.trim()) return null
    return { title: json.title.trim(), start: json.start || start }
  } catch {
    return null
  }
}

export function eventsFromListBody(body: unknown): ChainEvent[] {
  if (!body || typeof body !== 'object') return []
  const root = body as { data?: unknown; events?: unknown }
  let events: unknown = root.events
  if (!events && root.data && typeof root.data === 'object') {
    events = (root.data as { events?: unknown }).events
  }
  if (typeof root.data === 'string') {
    try {
      const parsed = JSON.parse(Buffer.from(root.data, 'base64').toString('utf8')) as {
        events?: unknown
      }
      events = parsed.events
    } catch {
      return []
    }
  }
  if (!Array.isArray(events)) return []
  const out: ChainEvent[] = []
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue
    const row = titleOf(ev as Record<string, unknown>)
    if (row) out.push(row)
  }
  return out
}

export async function fetchContractEvents(lcd: string, calendar: string): Promise<ChainEvent[]> {
  const url = smartQueryUrl(lcd, calendar, {
    list_events: { start_after: null, limit: 20 },
  })
  if (!url) return []
  const res = await fetch(url, { redirect: 'manual' })
  if (!res.ok) return []
  return eventsFromListBody(await res.json())
}
