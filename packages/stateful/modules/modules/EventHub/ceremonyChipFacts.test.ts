import { describe, expect, test, vi } from 'vitest'

import {
  formatCapacityChipDetail,
  isCeremonyActiveStatus,
  loadCeremonyChipFacts,
  parseCapacityStats,
} from './ceremonyChipFacts'
import { resolveCeremonySessionId } from './ceremonySession'

describe('resolveCeremonySessionId (OD-session-map)', () => {
  test('explicit ceremonySessionId wins', () => {
    expect(
      resolveCeremonySessionId({
        ceremonySessionId: ' sess-a ',
        defaultEventSlug: 'slug',
        selectedEventId: 'evt',
      })
    ).toBe('sess-a')
  })

  test('defaultEventSlug preferred over selectedEventId', () => {
    expect(
      resolveCeremonySessionId({
        defaultEventSlug: 'round-1',
        selectedEventId: 'token-99',
      })
    ).toBe('round-1')
  })

  test('falls back to selectedEventId', () => {
    expect(
      resolveCeremonySessionId({
        selectedEventId: 'evt/demo',
      })
    ).toBe('evt/demo')
  })

  test('undefined when empty', () => {
    expect(resolveCeremonySessionId({})).toBeUndefined()
    expect(
      resolveCeremonySessionId({ defaultEventSlug: '  ', selectedEventId: '' })
    ).toBeUndefined()
  })
})

describe('isCeremonyActiveStatus', () => {
  test('string and object variants', () => {
    expect(isCeremonyActiveStatus('Active')).toBe(true)
    expect(isCeremonyActiveStatus({ Active: {} })).toBe(true)
    expect(isCeremonyActiveStatus('Closed')).toBe(false)
    expect(isCeremonyActiveStatus(null)).toBe(false)
  })
})

describe('parseCapacityStats', () => {
  test('parses seats_remaining + max', () => {
    expect(
      parseCapacityStats({
        seats_remaining: 3,
        max_capacity: 10,
        registered_count: 7,
      })
    ).toEqual({
      seatsRemaining: 3,
      capacityMax: 10,
      registeredCount: 7,
    })
  })

  test('derives seats from max - registered', () => {
    expect(parseCapacityStats({ max: 20, registered: 5 })).toEqual({
      seatsRemaining: 15,
      capacityMax: 20,
      registeredCount: 5,
    })
  })

  test('empty → nulls', () => {
    expect(parseCapacityStats(null)).toEqual({
      seatsRemaining: null,
      capacityMax: null,
      registeredCount: null,
    })
  })
})

describe('formatCapacityChipDetail', () => {
  test('open without seats count', () => {
    expect(
      formatCapacityChipDetail({
        isRegistered: false,
        canVote: false,
        registrationOpen: true,
        ceremonyActive: true,
        seatsRemaining: null,
        capacityMax: null,
        registeredCount: null,
      })
    ).toMatch(/Registration open/)
  })

  test('seats left', () => {
    expect(
      formatCapacityChipDetail({
        isRegistered: false,
        canVote: false,
        registrationOpen: true,
        ceremonyActive: true,
        seatsRemaining: 4,
        capacityMax: 12,
        registeredCount: 8,
      })
    ).toBe('4 of 12 seats left')
  })

  test('full with capacity max', () => {
    expect(
      formatCapacityChipDetail({
        isRegistered: false,
        canVote: false,
        registrationOpen: true,
        ceremonyActive: true,
        seatsRemaining: 0,
        capacityMax: 20,
        registeredCount: 20,
      })
    ).toBe('Full (20 seats)')
  })

  test('full without capacity max', () => {
    expect(
      formatCapacityChipDetail({
        isRegistered: false,
        canVote: false,
        registrationOpen: true,
        ceremonyActive: true,
        seatsRemaining: 0,
        capacityMax: null,
        registeredCount: null,
      })
    ).toBe('Full — no seats remaining')
  })

  test('unknown when query fail / no registration_open', () => {
    expect(
      formatCapacityChipDetail({
        isRegistered: null,
        canVote: null,
        registrationOpen: null,
        ceremonyActive: null,
        seatsRemaining: null,
        capacityMax: null,
        registeredCount: null,
      })
    ).toBe('Capacity unknown')
  })

  test('closed without seats', () => {
    expect(
      formatCapacityChipDetail({
        isRegistered: false,
        canVote: false,
        registrationOpen: false,
        ceremonyActive: true,
        seatsRemaining: null,
        capacityMax: null,
        registeredCount: null,
      })
    ).toMatch(/Registration closed/)
  })

  test('seats left without max', () => {
    expect(
      formatCapacityChipDetail({
        isRegistered: false,
        canVote: false,
        registrationOpen: true,
        ceremonyActive: true,
        seatsRemaining: 3,
        capacityMax: null,
        registeredCount: null,
      })
    ).toBe('3 seats left')
  })
})

describe('loadCeremonyChipFacts', () => {
  test('missing inputs → all null', async () => {
    const facts = await loadCeremonyChipFacts({
      queryContractSmart: vi.fn(),
      ceremony: undefined,
      sessionId: 's',
      addr: 'terp1a',
      requireRegistration: true,
    })
    expect(facts).toEqual({
      isRegistered: null,
      canVote: null,
      registrationOpen: null,
      ceremonyActive: null,
      seatsRemaining: null,
      capacityMax: null,
      registeredCount: null,
    })
  })

  test('query error → fail-closed nulls', async () => {
    const facts = await loadCeremonyChipFacts({
      queryContractSmart: vi.fn().mockRejectedValue(new Error('lcd down')),
      ceremony: 'terp1cer',
      sessionId: 'round-1',
      addr: 'terp1a',
      requireRegistration: true,
    })
    expect(facts.isRegistered).toBeNull()
    expect(facts.canVote).toBeNull()
  })

  test('no wallet → registration flags without isRegistered', async () => {
    const query = vi.fn(async (_addr: string, msg: Record<string, unknown>) => {
      if ('ceremony' in msg) {
        return {
          ceremony: { status: 'Active', registration_open: true },
        }
      }
      throw new Error('unexpected ' + JSON.stringify(msg))
    })
    const facts = await loadCeremonyChipFacts({
      queryContractSmart: query,
      ceremony: 'terp1cer',
      sessionId: 'round-1',
      addr: undefined,
      requireRegistration: true,
    })
    expect(facts.isRegistered).toBeNull()
    expect(facts.registrationOpen).toBe(true)
    expect(facts.ceremonyActive).toBe(true)
    expect(facts.seatsRemaining).toBeNull()
  })

  test('registered + Active + requireRegistration → canVote true', async () => {
    const query = vi.fn(async (_addr: string, msg: Record<string, unknown>) => {
      if ('is_registered' in msg) return { registered: true }
      if ('ceremony' in msg) {
        return {
          ceremony: { status: 'Active', registration_open: true },
        }
      }
      // optional capacity queries soft-fail
      throw new Error('no capacity')
    })
    const facts = await loadCeremonyChipFacts({
      queryContractSmart: query,
      ceremony: 'terp1cer',
      sessionId: 'round-1',
      addr: 'terp1a',
      requireRegistration: true,
    })
    expect(facts.isRegistered).toBe(true)
    expect(facts.canVote).toBe(true)
    expect(facts.registrationOpen).toBe(true)
    expect(facts.ceremonyActive).toBe(true)
    expect(facts.seatsRemaining).toBeNull()
  })

  test('not registered + requireRegistration → canVote false (not null)', async () => {
    const query = vi.fn(async (_addr: string, msg: Record<string, unknown>) => {
      if ('is_registered' in msg) return { registered: false }
      if ('ceremony' in msg) {
        return {
          ceremony: { status: { Active: {} }, registration_open: true },
        }
      }
      throw new Error('no capacity')
    })
    const facts = await loadCeremonyChipFacts({
      queryContractSmart: query,
      ceremony: 'terp1cer',
      sessionId: 'round-1',
      addr: 'terp1a',
      requireRegistration: true,
    })
    expect(facts.isRegistered).toBe(false)
    expect(facts.canVote).toBe(false)
  })

  test('Active without requireRegistration → canVote true even if unregistered', async () => {
    const query = vi.fn(async (_addr: string, msg: Record<string, unknown>) => {
      if ('is_registered' in msg) return { registered: false }
      if ('ceremony' in msg) {
        return { ceremony: { status: 'Active', registration_open: false } }
      }
      throw new Error('no capacity')
    })
    const facts = await loadCeremonyChipFacts({
      queryContractSmart: query,
      ceremony: 'terp1cer',
      sessionId: 'round-1',
      addr: 'terp1a',
      requireRegistration: false,
    })
    expect(facts.isRegistered).toBe(false)
    expect(facts.canVote).toBe(true)
  })

  test('optional capacity query populates seats when present', async () => {
    const query = vi.fn(async (_addr: string, msg: Record<string, unknown>) => {
      if ('ceremony' in msg) {
        return { ceremony: { status: 'Active', registration_open: true } }
      }
      if ('capacity' in msg) {
        return { max_capacity: 50, registered_count: 12, seats_remaining: 38 }
      }
      if ('is_registered' in msg) return { registered: false }
      throw new Error('unexpected')
    })
    const facts = await loadCeremonyChipFacts({
      queryContractSmart: query,
      ceremony: 'terp1cer',
      sessionId: 'round-1',
      addr: 'terp1a',
      requireRegistration: true,
    })
    expect(facts.seatsRemaining).toBe(38)
    expect(facts.capacityMax).toBe(50)
    expect(facts.registeredCount).toBe(12)
  })
})
