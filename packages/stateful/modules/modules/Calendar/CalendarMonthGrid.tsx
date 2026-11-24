import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  WEEKDAY_LABELS_MON,
  WEEKDAY_LABELS_SUN,
  buildMonthCells,
  buildWeekCells,
  shiftMonth,
  type CalendarPanelEvent,
} from './calendarGrid'

export type CalendarMonthGridProps = {
  events: CalendarPanelEvent[]
  onSelectEvent?: (eventId: string) => void
  selectedEventId?: string | null
  /** Max chips per day cell before +N overflow. */
  maxChipsPerDay?: number
}

type GridMode = 'month' | 'week'

/**
 * Month (default) / week grid over the same PanelEvent list (CAL-UX-1).
 * Clear tokens only — no raw gray/blue Tailwind.
 */
export const CalendarMonthGrid = ({
  events,
  onSelectEvent,
  selectedEventId,
  maxChipsPerDay = 3,
}: CalendarMonthGridProps) => {
  const { t } = useTranslation()
  const now = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState(() => ({
    year: now.getFullYear(),
    month: now.getMonth(),
  }))
  const [mode, setMode] = useState<GridMode>('month')
  const [weekAnchor, setWeekAnchor] = useState(() => new Date(now))

  const cells = useMemo(() => {
    if (mode === 'week') {
      return buildWeekCells(weekAnchor, events, now)
    }
    return buildMonthCells(cursor.year, cursor.month, events, now)
  }, [mode, cursor, weekAnchor, events, now])

  const heading = useMemo(() => {
    if (mode === 'week') {
      const mon = cells[0]
      const sun = cells[6]
      return mon && sun
        ? `${mon.dateKey} – ${sun.dateKey}`
        : weekAnchor.toLocaleDateString()
    }
    return new Date(cursor.year, cursor.month, 1).toLocaleString(undefined, {
      month: 'long',
      year: 'numeric',
    })
  }, [mode, cells, cursor, weekAnchor])

  const weekdays = mode === 'week' ? WEEKDAY_LABELS_MON : WEEKDAY_LABELS_SUN

  const goPrev = () => {
    if (mode === 'week') {
      setWeekAnchor(
        (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7)
      )
    } else {
      setCursor((c) => shiftMonth(c.year, c.month, -1))
    }
  }
  const goNext = () => {
    if (mode === 'week') {
      setWeekAnchor(
        (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)
      )
    } else {
      setCursor((c) => shiftMonth(c.year, c.month, 1))
    }
  }
  const goToday = () => {
    const n = new Date()
    setCursor({ year: n.getFullYear(), month: n.getMonth() })
    setWeekAnchor(n)
  }

  const undatedCount = events.filter((e) => !e.start).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <button
            className="rounded-md border border-border-primary bg-background-base px-2 py-1 text-xs text-text-secondary hover:bg-background-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-interactive-focus"
            onClick={goPrev}
            type="button"
          >
            ←
          </button>
          <button
            className="rounded-md border border-border-primary bg-background-base px-2 py-1 text-xs text-text-secondary hover:bg-background-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-interactive-focus"
            onClick={goToday}
            type="button"
          >
            {t('button.today', { defaultValue: 'Today' })}
          </button>
          <button
            className="rounded-md border border-border-primary bg-background-base px-2 py-1 text-xs text-text-secondary hover:bg-background-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-interactive-focus"
            onClick={goNext}
            type="button"
          >
            →
          </button>
          <p className="primary-text ml-2 text-sm">{heading}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(['month', 'week'] as GridMode[]).map((m) => {
            const active = mode === m
            return (
              <button
                key={m}
                aria-pressed={active}
                className={`rounded-md px-2 py-0.5 text-xs capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-interactive-focus ${
                  active
                    ? 'bg-background-interactive-selected text-text-body ring-1 ring-inset ring-border-interactive-focus'
                    : 'text-text-secondary hover:bg-background-interactive-hover'
                }`}
                onClick={() => setMode(m)}
                type="button"
              >
                {m === 'month'
                  ? t('info.calendarMonth', { defaultValue: 'Month' })
                  : t('info.calendarWeek', { defaultValue: 'Week' })}
              </button>
            )
          })}
        </div>
      </div>

      <div
        className={`grid gap-px rounded-md border border-border-primary bg-border-primary ${
          mode === 'week' ? 'grid-cols-7' : 'grid-cols-7'
        }`}
        role="grid"
      >
        {weekdays.map((label) => (
          <div
            key={label}
            className="bg-background-tertiary px-1 py-1.5 text-center"
            role="columnheader"
          >
            <span className="caption-text text-text-tertiary text-[10px] uppercase tracking-wide">
              {label}
            </span>
          </div>
        ))}
        {cells.map((cell) => {
          const overflow = Math.max(0, cell.events.length - maxChipsPerDay)
          const visible = cell.events.slice(0, maxChipsPerDay)
          return (
            <div
              key={cell.dateKey}
              className={`min-h-[4.5rem] bg-background-base p-1 ${
                cell.inCurrentMonth ? '' : 'opacity-40'
              } ${
                cell.isToday
                  ? 'ring-1 ring-inset ring-border-interactive-focus'
                  : ''
              }`}
              role="gridcell"
            >
              <p
                className={`caption-text mb-0.5 text-right text-[11px] ${
                  cell.isToday
                    ? 'text-text-body font-medium'
                    : 'text-text-tertiary'
                }`}
              >
                {cell.day}
              </p>
              <div className="flex flex-col gap-0.5">
                {visible.map((ev) => {
                  const id = String(ev.id)
                  const selected =
                    selectedEventId != null && selectedEventId === id
                  const interactive = typeof onSelectEvent === 'function'
                  const chipClass = `w-full truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-interactive-focus ${
                    selected
                      ? 'bg-background-interactive-selected text-text-body ring-1 ring-inset ring-border-interactive-focus'
                      : 'bg-background-tertiary text-text-secondary hover:bg-background-interactive-hover'
                  }`
                  return interactive ? (
                    <button
                      key={id}
                      aria-pressed={selected}
                      className={chipClass}
                      onClick={() => onSelectEvent(id)}
                      title={ev.title}
                      type="button"
                    >
                      {ev.title}
                    </button>
                  ) : (
                    <span key={id} className={chipClass} title={ev.title}>
                      {ev.title}
                    </span>
                  )
                })}
                {overflow > 0 ? (
                  <span className="caption-text text-text-tertiary px-1 text-[10px]">
                    +{overflow}
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {events.length === 0 ? (
        <div className="rounded-md border border-dashed border-border-primary px-3 py-6 text-center">
          <p className="primary-text text-text-body text-sm">
            {t('info.calendarEmptyMonth', {
              defaultValue: 'Nothing scheduled this period.',
            })}
          </p>
          <p className="secondary-text text-text-secondary mt-1 text-xs">
            {t('info.calendarEmptyHint', {
              defaultValue:
                'Public events mint as dao-calendar NFTs. Empty is a normal product state.',
            })}
          </p>
        </div>
      ) : null}

      {undatedCount > 0 ? (
        <p className="caption-text text-text-tertiary">
          {t('info.calendarUndatedEvents', {
            defaultValue:
              '{{count}} event(s) have no start time — switch to Schedule list to see them.',
            count: undatedCount,
          })}
        </p>
      ) : null}
    </div>
  )
}
