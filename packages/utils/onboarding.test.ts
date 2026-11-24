import { describe, expect, test } from 'vitest'

import {
  buildOnboardingInviteUrl,
  createInviteDraft,
  decodeInvitePayload,
  encodeInvitePayload,
  formatInviteTokenName,
  parseInviteTokenName,
  parseOnboardingQuery,
} from './onboarding'

describe('onboarding invite helpers', () => {
  test('encode/decode invite payload round-trips', () => {
    const invite = createInviteDraft({
      chainId: 'morocco-1',
      dao: 'terp1dao',
      label: 'Test invite',
      authPlane: 'pfpk',
      autoMigrate: true,
    })
    const encoded = encodeInvitePayload(invite)
    const decoded = decodeInvitePayload(encoded)
    expect(decoded).toMatchObject({
      id: invite.id,
      chainId: 'morocco-1',
      dao: 'terp1dao',
      authPlane: 'pfpk',
      autoMigrate: true,
    })
  })

  test('buildOnboardingInviteUrl contains token and payload', () => {
    const invite = createInviteDraft({ chainId: 'morocco-1' })
    const url = buildOnboardingInviteUrl({
      token: 'jwt-token-value',
      invite,
      baseUrl: 'https://example.com',
    })
    expect(url.startsWith('https://example.com/onboard?')).toBe(true)
    expect(url).toContain('t=jwt-token-value')
    expect(url).toContain('chain=morocco-1')
    expect(url).toContain('p=')
  })

  test('parseOnboardingQuery reads URL params', () => {
    const invite = createInviteDraft({
      chainId: 'morocco-1',
      dao: 'terp1x',
      autoMigrate: true,
    })
    const url = buildOnboardingInviteUrl({
      token: 'abc',
      invite,
      baseUrl: 'https://x.com',
    })
    const qs = url.split('?')[1]
    const parsed = parseOnboardingQuery(qs)
    expect(parsed.token).toBe('abc')
    expect(parsed.chainId).toBe('morocco-1')
    expect(parsed.dao).toBe('terp1x')
    expect(parsed.autoMigrate).toBe(true)
    expect(parsed.invite?.id).toBe(invite.id)
  })

  test('invite token name format', () => {
    const invite = createInviteDraft({
      chainId: 'morocco-1',
      label: 'Hello',
    })
    const name = formatInviteTokenName(invite)
    expect(name.startsWith(`onboard:${invite.id}:`)).toBe(true)
    expect(parseInviteTokenName(name)).toEqual({
      inviteId: invite.id,
      label: 'Hello',
    })
    expect(parseInviteTokenName('other')).toBeNull()
  })

  test('invite draft carries feegrant preauth selection', () => {
    const invite = createInviteDraft({
      chainId: 'morocco-1',
      preauthActions: ['bank_send', 'wasm_execute'],
      feegrantSpendLimit: { denom: 'uterp', amount: '500000' },
      preauthGrantee: 'terp1fresh',
    })
    expect(invite.preauthActions).toEqual(['bank_send', 'wasm_execute'])
    expect(invite.feegrantSpendLimit).toEqual({
      denom: 'uterp',
      amount: '500000',
    })
    expect(invite.preauthGrantee).toBe('terp1fresh')
    const round = decodeInvitePayload(encodeInvitePayload(invite))
    expect(round?.preauthActions).toEqual(['bank_send', 'wasm_execute'])
  })
})
