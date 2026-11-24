/**
 * CAL-NOSTR-4: Map NIP-52 / mesh calendar Nostr events → CalendarPanelEvent.
 * Pure helpers — no invented relays; callers pass mesh.relays only.
 */

import type { NostrEvent } from '@dao-dao/utils'

import type { CalendarPanelEvent } from './calendarGrid'

/** NIP-52 calendar kinds (time-based + date-based + RSVP-ish calendar). */
export const CALENDAR_NOSTR_KINDS = [31922, 31923, 31924, 31925] as const

function tagValue(tags: string[][], name: string): string | undefined {
  const t = tags.find((x) => x[0] === name)
  return t?.[1]
}

function tagValues(tags: string[][], name: string): string[] {
  return tags.filter((x) => x[0] === name && x[1]).map((x) => x[1]!)
}

/** Unix seconds or ISO → ISO string when possible. */
function normalizeTime(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined
  const s = raw.trim()
  if (/^\d{9,12}$/.test(s)) {
    const d = new Date(Number(s) * 1000)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  // YYYY-MM-DD (date-based)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s}T00:00:00.000Z`
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toISOString()
}

/**
 * Extract IPFS CID from content or tags (i, r, imeta, content pointer).
 * Ignores lab: time-encoding URIs.
 */
export function extractCidFromNostr(ev: NostrEvent): string | undefined {
  const candidates: string[] = []
  for (const name of ['i', 'r', 'imeta', 'url', 'cid']) {
    for (const v of tagValues(ev.tags, name)) {
      candidates.push(v)
    }
  }
  candidates.push(ev.content || '')
  for (const c of candidates) {
    if (!c || c.startsWith('lab:')) continue
    // bare CID
    if (/^(bafy|Qm)[a-zA-Z0-9]+/.test(c.trim())) {
      return c.trim().split(/\s+/)[0]
    }
    // ipfs:// or /ipfs/
    const m =
      c.match(/ipfs:\/\/([a-zA-Z0-9]+)(?:\/[^\s]*)?/i) ||
      c.match(/\/ipfs\/([a-zA-Z0-9]+)(?:\/[^\s]*)?/i)
    if (m?.[1]) return m[1]
  }
  return undefined
}

export function nostrEventToCalendarPanel(
  ev: NostrEvent
): CalendarPanelEvent | null {
  if (!CALENDAR_NOSTR_KINDS.includes(ev.kind as (typeof CALENDAR_NOSTR_KINDS)[number])) {
    // Still accept calendar-shaped kinds outside strict list if tagged title+start
    if (!tagValue(ev.tags, 'title') && !tagValue(ev.tags, 'start')) {
      return null
    }
  }
  const d = tagValue(ev.tags, 'd')
  const title =
    tagValue(ev.tags, 'title') ||
    (ev.content?.trim().slice(0, 80) || undefined) ||
    d ||
    ev.id.slice(0, 12)
  const start = normalizeTime(tagValue(ev.tags, 'start'))
  const end = normalizeTime(tagValue(ev.tags, 'end'))
  const access =
    tagValue(ev.tags, 'access') === 'private' ||
    tagValue(ev.tags, 'private') === 'true'
      ? 'private'
      : 'public'
  const description =
    ev.content?.trim() && !/^(bafy|Qm)/.test(ev.content.trim())
      ? ev.content.trim()
      : undefined
  const cid = extractCidFromNostr(ev)
  return {
    id: d ? `nostr:${d}` : `nostr:${ev.id}`,
    title,
    start,
    end,
    access,
    description,
    cid,
  }
}

/**
 * Merge chain/query events with live Nostr: Nostr fills gaps and enriches CID;
 * same d-tag / title+start may overlay description/cid without dropping chain rows.
 */
export function mergeCalendarEvents(
  base: CalendarPanelEvent[],
  live: CalendarPanelEvent[]
): CalendarPanelEvent[] {
  if (!live.length) return base
  const byId = new Map<string, CalendarPanelEvent>()
  for (const e of base) {
    byId.set(String(e.id), { ...e })
  }
  for (const n of live) {
    const key = String(n.id)
    // Also try bare d-tag match against chain token ids
    const bare = key.startsWith('nostr:') ? key.slice(6) : key
    const existing =
      byId.get(key) ||
      byId.get(bare) ||
      [...byId.values()].find(
        (b) =>
          String(b.id) === bare ||
          String(b.id).endsWith(bare) ||
          (b.title === n.title && b.start && n.start && b.start === n.start)
      )
    if (existing) {
      const id = String(existing.id)
      byId.set(id, {
        ...existing,
        title: existing.title || n.title,
        start: existing.start || n.start,
        end: existing.end || n.end,
        description: existing.description || n.description,
        cid: existing.cid || n.cid,
      })
    } else {
      byId.set(key, n)
    }
  }
  return [...byId.values()]
}

export function buildCalendarNostrFilters(limit = 40) {
  return [
    {
      kinds: [...CALENDAR_NOSTR_KINDS],
      limit,
    },
  ]
}
