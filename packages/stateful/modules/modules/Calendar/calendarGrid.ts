/**
 * Pure calendar grid helpers for Calendar module UX (CAL-UX-1).
 * Clear-token UI lives in CalendarMonthGrid; this file is date math only.
 */

export type CalendarPanelEvent = {
  id: string | number
  title: string
  start?: string
  end?: string
  access?: 'public' | 'private'
  description?: string
  /** Off-chain content pointer (IPFS CID or lab: URI), if present on chain extension. */
  cid?: string
}

export type MonthCell = {
  /** Local calendar date YYYY-MM-DD */
  dateKey: string
  day: number
  inCurrentMonth: boolean
  isToday: boolean
  events: CalendarPanelEvent[]
}

/** Parse event start into a Date; supports ISO strings and unix seconds. */
export function parseEventStart(start?: string): Date | null {
  if (!start || !String(start).trim()) return null
  const s = String(start).trim()
  // unix seconds
  if (/^\d{9,12}$/.test(s)) {
    const n = Number(s)
    if (!Number.isFinite(n)) return null
    const d = new Date(n * 1000)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatLocalRange(
  start?: string,
  end?: string
): { local: string; utc: string } {
  const s = parseEventStart(start)
  const e = parseEventStart(end)
  const fmtLocal = (d: Date) =>
    d.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  const fmtUtc = (d: Date) => d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')

  if (!s && !e) {
    return { local: '—', utc: '—' }
  }
  if (s && e) {
    return {
      local: `${fmtLocal(s)} → ${fmtLocal(e)}`,
      utc: `${fmtUtc(s)} → ${fmtUtc(e)}`,
    }
  }
  const only = s || e!
  return { local: fmtLocal(only), utc: fmtUtc(only) }
}

/**
 * Build a 6×7 month grid (Sun-start) for the given year/month (0-indexed month).
 * Events without parseable start are omitted from cells (still show in list view).
 */
export function buildMonthCells(
  year: number,
  month: number,
  events: CalendarPanelEvent[],
  today: Date = new Date()
): MonthCell[] {
  const first = new Date(year, month, 1)
  const startPad = first.getDay() // 0 = Sunday
  const gridStart = new Date(year, month, 1 - startPad)
  const todayKey = toDateKey(today)

  const byDay = new Map<string, CalendarPanelEvent[]>()
  for (const ev of events) {
    const d = parseEventStart(ev.start)
    if (!d) continue
    const key = toDateKey(d)
    const list = byDay.get(key) || []
    list.push(ev)
    byDay.set(key, list)
  }

  const cells: MonthCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + i
    )
    const dateKey = toDateKey(d)
    cells.push({
      dateKey,
      day: d.getDate(),
      inCurrentMonth: d.getMonth() === month,
      isToday: dateKey === todayKey,
      events: byDay.get(dateKey) || [],
    })
  }
  return cells
}

/** Monday-start week containing `anchor` (local). */
export function buildWeekCells(
  anchor: Date,
  events: CalendarPanelEvent[],
  today: Date = new Date()
): MonthCell[] {
  const day = anchor.getDay()
  // Monday-first: Sun=0 → go back 6; Mon=1 → 0
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate() + mondayOffset
  )
  const todayKey = toDateKey(today)
  const byDay = new Map<string, CalendarPanelEvent[]>()
  for (const ev of events) {
    const d = parseEventStart(ev.start)
    if (!d) continue
    const key = toDateKey(d)
    const list = byDay.get(key) || []
    list.push(ev)
    byDay.set(key, list)
  }
  const cells: MonthCell[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + i
    )
    const dateKey = toDateKey(d)
    cells.push({
      dateKey,
      day: d.getDate(),
      inCurrentMonth: true,
      isToday: dateKey === todayKey,
      events: byDay.get(dateKey) || [],
    })
  }
  return cells
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const d = new Date(year, month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export const WEEKDAY_LABELS_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_LABELS_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
