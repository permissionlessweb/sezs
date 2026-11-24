import { EventInfo, VenueView } from './api'

/** Format a start instant in the event timezone. Never hard-code a calendar date in copy. */
export const formatWhen = (iso: string, timeZone = 'UTC'): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(d)
}

export const formatClock = (iso: string, timeZone = 'UTC'): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(d)
}

export const formatSpan = (e: EventInfo): string => {
  const a = formatWhen(e.start, e.timezone)
  return a
}

export const venueLine = (v?: VenueView | null): string => {
  if (v?.revealed && v.label) return v.label
  return v?.note || 'Location is shared with ticket holders.'
}
