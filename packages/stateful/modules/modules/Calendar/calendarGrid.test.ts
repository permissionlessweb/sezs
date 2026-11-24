import { describe, expect, it } from 'vitest'

import {
  buildMonthCells,
  buildWeekCells,
  formatLocalRange,
  parseEventStart,
  shiftMonth,
  toDateKey,
  type CalendarPanelEvent,
} from './calendarGrid'

describe('calendarGrid', () => {
  it('parseEventStart handles ISO and unix seconds', () => {
    const iso = parseEventStart('2026-08-10T17:00:00Z')
    expect(iso).not.toBeNull()
    expect(iso!.toISOString()).toContain('2026-08-10')

    const unix = parseEventStart('1786114800')
    expect(unix).not.toBeNull()

    expect(parseEventStart(undefined)).toBeNull()
    expect(parseEventStart('not-a-date')).toBeNull()
  })

  it('buildMonthCells places events and pads to 42 cells', () => {
    const events: CalendarPanelEvent[] = [
      {
        id: 'a',
        title: 'Office hours',
        start: '2026-08-10T17:00:00Z',
      },
      {
        id: 'b',
        title: 'No date',
      },
    ]
    const cells = buildMonthCells(2026, 7, events, new Date('2026-08-07T12:00:00Z'))
    expect(cells).toHaveLength(42)
    const withEvent = cells.filter((c) => c.events.some((e) => e.id === 'a'))
    expect(withEvent.length).toBeGreaterThanOrEqual(1)
    // undated event never appears in cells
    expect(cells.every((c) => !c.events.some((e) => e.id === 'b'))).toBe(true)
    expect(cells.some((c) => c.isToday)).toBe(true)
  })

  it('buildWeekCells returns 7 days Mon-first', () => {
    const anchor = new Date('2026-08-07T12:00:00') // Friday local-ish
    const cells = buildWeekCells(
      anchor,
      [
        {
          id: 'x',
          title: 'Fri event',
          start: toDateKey(anchor) + 'T15:00:00',
        },
      ],
      anchor
    )
    expect(cells).toHaveLength(7)
    expect(cells.some((c) => c.events.length > 0)).toBe(true)
  })

  it('shiftMonth wraps year', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
  })

  it('formatLocalRange returns placeholders when empty', () => {
    expect(formatLocalRange()).toEqual({ local: '—', utc: '—' })
  })

  it('buildMonthCells empty month has 42 cells and no events', () => {
    const cells = buildMonthCells(2026, 0, [], new Date('2026-01-15T12:00:00Z'))
    expect(cells).toHaveLength(42)
    expect(cells.every((c) => c.events.length === 0)).toBe(true)
    expect(cells.filter((c) => c.inCurrentMonth).length).toBeGreaterThanOrEqual(
      28
    )
  })

  it('toDateKey is local Y-M-D', () => {
    const d = new Date(2026, 7, 7, 15, 0, 0)
    expect(toDateKey(d)).toBe('2026-08-07')
  })
})
