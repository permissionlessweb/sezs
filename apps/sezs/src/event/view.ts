import { EventInfo, EventManifold, LineupSlot, TimelineItem } from './api'
import { formatClock } from './format'

export type LaneId = string
export type Lane = { id: LaneId; label: string; note: string }

export type LineupSet = {
  id: string
  ref: string
  name: string
  lane: LaneId
  start: number | null
  end: number | null
  kind: 'music' | 'floor' | 'service'
  setlist: 'example' | 'pending' | 'confirmed'
  tracks: { title: string; example?: boolean }[]
  link?: string
}

export type NightRow = { time: string; where: string; what: string; href?: string }

const kindOf = (s: LineupSlot): LineupSet['kind'] => {
  if (s.role === 'dj' || s.role === 'vj' || s.role === 'host') return 'music'
  if (s.role === 'vendor' || s.role === 'flow') return 'service'
  return 'floor'
}

const labelOf = (id: string) => id.slice(0, 1).toUpperCase() + id.slice(1)

/** Minutes after the event start. */
export const offsetMin = (iso: string, origin: string): number => {
  const a = Date.parse(iso)
  const b = Date.parse(origin)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((a - b) / 60_000)
}

export const nightLength = (e: EventInfo): number => {
  const n = offsetMin(e.end, e.start)
  return n > 0 ? n : 7 * 60
}

export const fromManifold = (data: EventManifold) => {
  const origin = data.event.start
  const tz = data.event.timezone
  const nightLen = nightLength(data.event)
  const fmt = (min: number | null) => {
    if (min === null) return 'late'
    const base = Date.parse(origin)
    if (Number.isNaN(base)) return ''
    return formatClock(new Date(base + min * 60_000).toISOString(), tz)
  }

  const laneIds = Array.from(
    new Set([
      ...data.lineup.map((s) => s.lane),
      ...data.timeline.map((t) => t.lane).filter((x): x is string => !!x),
    ])
  )
  const preferred = ['cellar', 'floor', 'alcove', 'door', 'back']
  const lanes: Lane[] = [...preferred.filter((id) => laneIds.includes(id)), ...laneIds.filter((id) => !preferred.includes(id))].map(
    (id) => ({ id, label: labelOf(id), note: '' })
  )

  const long = (s: LineupSlot) => s.durationMin >= 180
  const sets: LineupSet[] = data.lineup
    .filter((s) => !long(s))
    .map((s) => {
      const start = offsetMin(s.start, origin)
      return {
        id: s.id,
        ref: s.id,
        name: s.handle,
        lane: s.lane,
        start,
        end: start + s.durationMin,
        kind: kindOf(s),
        setlist: 'pending' as const,
        tracks: [],
      }
    })

  const around = [
    ...data.lineup.filter(long).map((s) => ({
      id: s.id,
      name: s.handle,
      note: `${labelOf(s.lane)} · all night`,
    })),
    ...data.timeline
      .filter((t) => t.untimed)
      .map((t) => ({
        id: t.id,
        name: t.label,
        note: t.lane ? labelOf(t.lane) : '',
      })),
  ].filter((row, i, all) => all.findIndex((x) => x.name === row.name) === i)

  const bill = data.lineup.map((s) => ({
    id: s.id,
    name: s.handle,
    sub: `${fmt(offsetMin(s.start, origin))} · ${s.lane}`,
    href: `/lineup#${s.id}`,
  }))

  const night: NightRow[] = [
    ...data.lineup
      .filter((s) => !long(s))
      .slice()
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
      .map((s) => ({
        time: fmt(offsetMin(s.start, origin)),
        where: labelOf(s.lane),
        what: s.handle,
        href: `/lineup#${s.id}`,
      })),
    ...data.timeline
      .filter((t) => t.untimed)
      .map((t) => ({
        time: 'All night',
        where: t.lane ? labelOf(t.lane) : '',
        what: t.label,
        href: t.slotId ? `/lineup#${t.slotId}` : undefined,
      })),
  ]

  return { lanes, sets, around, bill, night, nightLen, fmt, origin, tz }
}

export type EventView = ReturnType<typeof fromManifold>
