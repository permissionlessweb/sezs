import { describe, expect, test } from 'vitest'

import {
  evaluateRegistrationBountyGate,
  shouldShowRegistrationBountyPending,
} from './registrationBountyGate'

describe('evaluateRegistrationBountyGate', () => {
  test('ceremony missing → closed, pending UI', () => {
    const gate = evaluateRegistrationBountyGate({
      ceremonyContract: '',
      registrationPolicy: 'ceremony',
    })
    expect(gate.allowOpenRegistrationBounty).toBe(false)
    expect(gate.code).toBe('ceremony_missing')
    expect(shouldShowRegistrationBountyPending(gate)).toBe(true)
  })

  test('enforce default: missing ceremony blocks OPEN even for members policy', () => {
    const gate = evaluateRegistrationBountyGate({
      registrationPolicy: 'members',
      requireRegistration: false,
    })
    expect(gate.allowOpenRegistrationBounty).toBe(false)
    expect(gate.code).toBe('ceremony_missing')
  })

  test('ceremony + session → ok OPEN', () => {
    const gate = evaluateRegistrationBountyGate({
      ceremonyContract: 'terp1cer',
      sessionId: 'evt-lab-1',
      registrationPolicy: 'ceremony',
      requireRegistration: true,
    })
    expect(gate).toMatchObject({
      allowOpenRegistrationBounty: true,
      code: 'ok',
      ceremonyContract: 'terp1cer',
      sessionId: 'evt-lab-1',
    })
    expect(shouldShowRegistrationBountyPending(gate)).toBe(false)
  })

  test('ceremony without session → allow OPEN with session_unmapped', () => {
    const gate = evaluateRegistrationBountyGate({
      ceremonyContract: '  terp1cer  ',
      sessionId: null,
    })
    expect(gate.allowOpenRegistrationBounty).toBe(true)
    expect(gate.code).toBe('session_unmapped')
    expect(gate.ceremonyContract).toBe('terp1cer')
    expect(shouldShowRegistrationBountyPending(gate)).toBe(false)
  })

  test('calendar-only detail mentions calendar when ceremony missing', () => {
    const gate = evaluateRegistrationBountyGate({
      calendarContract: 'terp1cal',
      ceremonyContract: undefined,
    })
    expect(gate.code).toBe('ceremony_missing')
    expect(gate.detail).toMatch(/Calendar is set/)
  })

  test('enforceCeremonyForRegistrationBounty=false skips gate', () => {
    const gate = evaluateRegistrationBountyGate({
      enforceCeremonyForRegistrationBounty: false,
      requireRegistration: false,
      registrationPolicy: 'open',
    })
    expect(gate.code).toBe('not_event_registration')
    expect(gate.allowOpenRegistrationBounty).toBe(true)
  })

  /**
   * EH-REG-4 / multi-board: bounty id / event id gate matrix (unit).
   * Parent boards must treat mapped ceremony as OPEN and unmapped as pending.
   */
  test('matrix: eventId × ceremony → OPEN vs pending', () => {
    const matrix: Array<{
      eventId: string
      ceremony?: string
      expectOpen: boolean
      expectPending: boolean
      code: string
    }> = [
      {
        eventId: 'lab-demo',
        ceremony: undefined,
        expectOpen: false,
        expectPending: true,
        code: 'ceremony_missing',
      },
      {
        eventId: 'lab-demo',
        ceremony: 'terp1ceremonylab',
        expectOpen: true,
        expectPending: false,
        code: 'ok',
      },
      {
        eventId: 'evt-9',
        ceremony: 'terp1cer',
        expectOpen: true,
        expectPending: false,
        code: 'ok',
      },
      {
        eventId: 'orphan-open',
        ceremony: '',
        expectOpen: false,
        expectPending: true,
        code: 'ceremony_missing',
      },
    ]

    for (const row of matrix) {
      const gate = evaluateRegistrationBountyGate({
        ceremonyContract: row.ceremony,
        sessionId: row.ceremony ? row.eventId : undefined,
      })
      expect(gate.allowOpenRegistrationBounty, row.eventId).toBe(row.expectOpen)
      expect(shouldShowRegistrationBountyPending(gate), row.eventId).toBe(
        row.expectPending
      )
      expect(gate.code, row.eventId).toBe(row.code)
      if (row.expectOpen) {
        expect(gate.ceremonyContract).toBeTruthy()
      }
    }
  })
})
