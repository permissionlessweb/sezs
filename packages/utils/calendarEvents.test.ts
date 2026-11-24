import { describe, expect, test } from 'vitest'

import {
  buildCancelEventMsg,
  buildCreateEventMsg,
  buildUpdateEventMsg,
  isCancelEventMsg,
  isCreateEventMsg,
  isUpdateEventMsg,
  toCalendarNanos,
} from './calendarEvents'

describe('toCalendarNanos', () => {
  test('ms number → nanos', () => {
    expect(toCalendarNanos(1_000)).toBe('1000000000')
  })

  test('Date → nanos', () => {
    expect(toCalendarNanos(new Date(0))).toBe('0')
  })

  test('already-nanos digit string preserved', () => {
    expect(toCalendarNanos('1700000000000000000')).toBe('1700000000000000000')
  })
})

describe('buildCreateEventMsg', () => {
  test('builds create_event', () => {
    const msg = buildCreateEventMsg({
      title: ' Town hall ',
      description: 'Monthly',
      startTime: 1_000,
      endTime: 2_000,
      managingGroups: ['core'],
      timezone: 'UTC',
    })
    expect(isCreateEventMsg(msg)).toBe(true)
    expect(msg.create_event.title).toBe('Town hall')
    expect(msg.create_event.start_time).toBe('1000000000')
    expect(msg.create_event.end_time).toBe('2000000000')
    expect(msg.create_event.managing_groups).toEqual(['core'])
    expect(msg.create_event.timezone).toBe('UTC')
  })

  test('rejects empty title', () => {
    expect(() =>
      buildCreateEventMsg({
        title: '  ',
        startTime: 1,
        endTime: 2,
        managingGroups: ['g'],
      })
    ).toThrow(/title/i)
  })

  test('rejects end before start', () => {
    expect(() =>
      buildCreateEventMsg({
        title: 'x',
        startTime: 2_000,
        endTime: 1_000,
        managingGroups: ['g'],
      })
    ).toThrow(/end_time/)
  })
})

describe('buildUpdateEventMsg', () => {
  test('partial update', () => {
    const msg = buildUpdateEventMsg({
      eventId: 9,
      title: 'Renamed',
    })
    expect(isUpdateEventMsg(msg)).toBe(true)
    expect(msg.update_event.event_id).toBe(9)
    expect(msg.update_event.title).toBe('Renamed')
    expect(msg.update_event.start_time).toBeNull()
  })
})

describe('buildCancelEventMsg', () => {
  test('cancel', () => {
    const msg = buildCancelEventMsg(4)
    expect(isCancelEventMsg(msg)).toBe(true)
    expect(msg.cancel_event.event_id).toBe(4)
  })
})
