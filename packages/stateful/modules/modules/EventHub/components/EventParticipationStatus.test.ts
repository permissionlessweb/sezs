/**
 * Participation chip builder — fail-closed + P2 connect chips.
 */
import { describe, expect, it } from 'vitest'

import { buildParticipationChips } from './EventParticipationStatus'

describe('buildParticipationChips', () => {
  it('keeps registered/canVote unknown when null', () => {
    const chips = buildParticipationChips({
      isWalletConnected: true,
      isMember: true,
      isRegistered: null,
      canVote: null,
      buzzReady: false,
    })
    expect(chips.find((c) => c.id === 'registered')?.state).toBe('unknown')
    expect(chips.find((c) => c.id === 'can_vote')?.state).toBe('unknown')
  })

  it('does not green hermes_path from wallet alone', () => {
    const chips = buildParticipationChips({
      isWalletConnected: true,
      isMember: true,
      hermesPathKnown: null,
      hermesDeepLinkConfigured: false,
      routerCircuitKnown: null,
    })
    expect(chips.find((c) => c.id === 'hermes_path')?.state).toBe('unknown')
    expect(chips.find((c) => c.id === 'router')?.state).toBe('unknown')
    expect(chips.find((c) => c.id === 'connected')?.state).toBe('ok')
  })

  it('mutes hermes_path when deep-link configured but path not proven', () => {
    const chips = buildParticipationChips({
      isWalletConnected: true,
      isMember: true,
      hermesPathKnown: null,
      hermesDeepLinkConfigured: true,
    })
    expect(chips.find((c) => c.id === 'hermes_path')?.state).toBe('muted')
  })

  it('marks buzz ready only when bridge ready', () => {
    const muted = buildParticipationChips({
      isWalletConnected: true,
      isMember: true,
      buzzReady: false,
    })
    const ok = buildParticipationChips({
      isWalletConnected: true,
      isMember: true,
      buzzReady: true,
    })
    expect(muted.find((c) => c.id === 'buzz')?.state).toBe('muted')
    expect(ok.find((c) => c.id === 'buzz')?.state).toBe('ok')
  })

  it('capacity chip reflects seats / registration window honestly', () => {
    const seats = buildParticipationChips({
      isWalletConnected: true,
      isMember: true,
      isRegistered: false,
      seatsRemaining: 5,
      registrationOpen: true,
    })
    expect(seats.find((c) => c.id === 'capacity')?.state).toBe('ok')
    expect(seats.find((c) => c.id === 'capacity')?.label).toBe('5 seats')

    const full = buildParticipationChips({
      isWalletConnected: true,
      isMember: true,
      seatsRemaining: 0,
      registrationOpen: true,
    })
    expect(full.find((c) => c.id === 'capacity')?.state).toBe('warn')

    const openNoSeats = buildParticipationChips({
      isWalletConnected: true,
      isMember: true,
      seatsRemaining: null,
      registrationOpen: true,
    })
    expect(openNoSeats.find((c) => c.id === 'capacity')?.state).toBe('muted')
    expect(openNoSeats.find((c) => c.id === 'capacity')?.label).toBe('Reg open')

    const unknown = buildParticipationChips({
      isWalletConnected: true,
      isMember: true,
      seatsRemaining: null,
      registrationOpen: null,
    })
    expect(unknown.find((c) => c.id === 'capacity')?.state).toBe('unknown')
  })

  it('greens registered chip when isRegistered true', () => {
    const chips = buildParticipationChips({
      isWalletConnected: true,
      isMember: true,
      isRegistered: true,
      canVote: true,
    })
    expect(chips.find((c) => c.id === 'registered')?.state).toBe('ok')
    expect(chips.find((c) => c.id === 'can_vote')?.state).toBe('ok')
  })
})
