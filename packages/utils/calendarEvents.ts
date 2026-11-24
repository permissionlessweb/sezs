/**
 * Pure dao-calendar execute message builders (create / update / cancel).
 *
 * Shapes match production types in terp-docs `lib/types/DaoCalendar.types.ts`.
 * When C2 lands generated `@dao-dao/types` clients, keep these builders as the
 * single encode surface — swap imports without rewriting actions.
 *
 * Timestamps are CosmWasm Uint64 nanos strings.
 */

/** CosmWasm Timestamp = Uint64 string (nanoseconds since epoch). */
export type CalendarTimestamp = string

export type CalendarRecurrenceFrequency =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'

export type CalendarDayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

export type CalendarRecurrenceEnd =
  | { never: Record<string, never> }
  | { after_count: number }
  | { at_date: CalendarTimestamp }

export type CalendarRecurrenceRule = {
  frequency: CalendarRecurrenceFrequency
  interval: number
  days_of_week?: CalendarDayOfWeek[] | null
  end_condition: CalendarRecurrenceEnd
}

export type CreateCalendarEventMsg = {
  create_event: {
    title: string
    description?: string | null
    start_time: CalendarTimestamp
    end_time: CalendarTimestamp
    managing_groups: string[]
    timezone?: string | null
    recurrence?: CalendarRecurrenceRule | null
    services?: unknown[] | null
    extension?: Record<string, never> | null
  }
}

export type UpdateCalendarEventMsg = {
  update_event: {
    event_id: number
    title?: string | null
    description?: string | null
    start_time?: CalendarTimestamp | null
    end_time?: CalendarTimestamp | null
    managing_groups?: string[] | null
    timezone?: string | null
    services?: unknown[] | null
    extension?: Record<string, never> | null
  }
}

export type CancelCalendarEventMsg = {
  cancel_event: {
    event_id: number
  }
}

export type CalendarEventExecuteMsg =
  | CreateCalendarEventMsg
  | UpdateCalendarEventMsg
  | CancelCalendarEventMsg

/** JS Date / ms / ISO → nanos string for contract timestamps. */
export const toCalendarNanos = (input: Date | string | number): string => {
  if (typeof input === 'string' && /^\d+$/.test(input.trim())) {
    // Already integer string — treat as nanos if very large, else ms
    const n = BigInt(input.trim())
    if (n > 10_000_000_000_000n) return n.toString() // already nanos-ish
    return (n * 1_000_000n).toString()
  }
  const ms =
    input instanceof Date
      ? input.getTime()
      : typeof input === 'number'
        ? input
        : Date.parse(input)
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid calendar time: ${String(input)}`)
  }
  return (BigInt(ms) * 1_000_000n).toString()
}

export type BuildCreateCalendarEventInput = {
  title: string
  description?: string
  /** Date, ISO string, ms, or nanos string */
  startTime: Date | string | number
  endTime: Date | string | number
  managingGroups: string[]
  timezone?: string
  recurrence?: CalendarRecurrenceRule | null
}

export const buildCreateEventMsg = (
  input: BuildCreateCalendarEventInput
): CreateCalendarEventMsg => {
  const title = input.title.trim()
  if (!title) throw new Error('Event title is required')
  if (!input.managingGroups?.length) {
    throw new Error('At least one managing group is required')
  }
  const start_time = toCalendarNanos(input.startTime)
  const end_time = toCalendarNanos(input.endTime)
  if (BigInt(end_time) <= BigInt(start_time)) {
    throw new Error('end_time must be after start_time')
  }

  return {
    create_event: {
      title,
      description: input.description?.trim() || null,
      start_time,
      end_time,
      managing_groups: input.managingGroups,
      timezone: input.timezone?.trim() || null,
      recurrence: input.recurrence ?? null,
      services: null,
      extension: null,
    },
  }
}

export type BuildUpdateCalendarEventInput = {
  eventId: number
  title?: string
  description?: string
  startTime?: Date | string | number | null
  endTime?: Date | string | number | null
  managingGroups?: string[] | null
  timezone?: string | null
}

export const buildUpdateEventMsg = (
  input: BuildUpdateCalendarEventInput
): UpdateCalendarEventMsg => {
  if (!Number.isFinite(input.eventId) || input.eventId < 0) {
    throw new Error('event_id must be a non-negative number')
  }
  const start_time =
    input.startTime != null && input.startTime !== ''
      ? toCalendarNanos(input.startTime)
      : null
  const end_time =
    input.endTime != null && input.endTime !== ''
      ? toCalendarNanos(input.endTime)
      : null
  if (start_time && end_time && BigInt(end_time) <= BigInt(start_time)) {
    throw new Error('end_time must be after start_time')
  }

  return {
    update_event: {
      event_id: input.eventId,
      title: input.title != null ? input.title.trim() || null : null,
      description:
        input.description != null ? input.description.trim() || null : null,
      start_time,
      end_time,
      managing_groups: input.managingGroups ?? null,
      timezone:
        input.timezone != null ? input.timezone.trim() || null : null,
      services: null,
      extension: null,
    },
  }
}

export const buildCancelEventMsg = (
  eventId: number
): CancelCalendarEventMsg => {
  if (!Number.isFinite(eventId) || eventId < 0) {
    throw new Error('event_id must be a non-negative number')
  }
  return { cancel_event: { event_id: eventId } }
}

/** Structure matchers for ActionBase.match */
export const createEventMsgStructure = {
  create_event: {
    title: {},
    start_time: {},
    end_time: {},
    managing_groups: {},
  },
}

export const updateEventMsgStructure = {
  update_event: {
    event_id: {},
  },
}

export const cancelEventMsgStructure = {
  cancel_event: {
    event_id: {},
  },
}

export const isCreateEventMsg = (
  msg: unknown
): msg is CreateCalendarEventMsg =>
  !!msg &&
  typeof msg === 'object' &&
  'create_event' in (msg as object) &&
  !!(msg as CreateCalendarEventMsg).create_event

export const isUpdateEventMsg = (
  msg: unknown
): msg is UpdateCalendarEventMsg =>
  !!msg &&
  typeof msg === 'object' &&
  'update_event' in (msg as object) &&
  !!(msg as UpdateCalendarEventMsg).update_event

export const isCancelEventMsg = (
  msg: unknown
): msg is CancelCalendarEventMsg =>
  !!msg &&
  typeof msg === 'object' &&
  'cancel_event' in (msg as object) &&
  !!(msg as CancelCalendarEventMsg).cancel_event
