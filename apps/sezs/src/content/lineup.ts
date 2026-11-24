/**
 * Lineup helpers. Times, rooms, and handles come from the event manifold
 * (see src/event), not from hard-coded names in this file.
 */
import type { Lane, LineupSet } from '../event/view'

export type LaneId = string

/** Default window used by the clock helpers (19:00 → 02:00). */
export const NIGHT_START = 19 * 60
export const NIGHT_LEN = 7 * 60

export const LANES: Lane[] = [
  { id: 'cellar', label: 'Cellar', note: 'Music' },
  { id: 'floor', label: 'Floor', note: 'Floor work' },
  { id: 'alcove', label: 'Alcove', note: 'Sessions' },
  { id: 'door', label: 'Door', note: 'Check-in' },
  { id: 'back', label: 'Back', note: 'Late room' },
]

/** "8:00" → minutes after 19:00, using the evening reading used on the site. */
export const clock = (hm: string): number => {
  const [h, m] = hm.split(':').map(Number)
  const h24 = h === 12 ? 24 : h < 7 ? h + 24 : h < 12 ? h + 12 : h
  return h24 * 60 + (m || 0) - NIGHT_START
}

export const fmt = (min: number | null, nightStart = NIGHT_START) => {
  if (min === null) return 'late'
  const t = nightStart + min
  const h = Math.floor(t / 60) % 24
  const m = t % 60
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')}`
}

