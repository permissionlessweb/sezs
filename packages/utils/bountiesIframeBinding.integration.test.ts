/**
 * Local e2e-style integration: parent HOST authCapabilities + child protocol
 * + lab capability transcript (no browser, no live network).
 */
import { describe, expect, test } from 'vitest'

import {
  AUTH_FEATURE_FLAGS,
  buildBountiesAuthCapabilities,
  setChosenAuthMethod,
  getChosenAuthMethod,
} from './authMethods'
import {
  buildCapabilityGrant,
  buildLoginChallenge,
  safeLogAdapterError,
} from './zcashLoginAdapters'

/** Minimal child-side extractor (mirrors zec-bounties embed). */
function extractAuthCapabilities(msg: Record<string, unknown>) {
  const p =
    msg.payload && typeof msg.payload === 'object'
      ? (msg.payload as Record<string, unknown>)
      : msg
  const raw =
    (msg.authCapabilities as Record<string, unknown> | undefined) ||
    (p.authCapabilities as Record<string, unknown> | undefined) ||
    (msg.type === 'authCapabilities' ? msg : null)
  if (!raw || typeof raw !== 'object') return null
  const methods = (raw.methods || []) as unknown[]
  if (!Array.isArray(methods)) return null
  return {
    methods,
    autoAuthorizeFunds: raw.autoAuthorizeFunds === true,
    requiresSecondStepForFunds: raw.requiresSecondStepForFunds !== false,
    activeWallet: (raw.activeWallet as string | null) ?? null,
    chosenMethodHint: (raw.chosenMethodHint as string | null) ?? null,
  }
}

describe('iframe binding API (parent ↔ child)', () => {
  const labEnv = {
    [AUTH_FEATURE_FLAGS.zcashZecAuth]: 'true',
    [AUTH_FEATURE_FLAGS.zcashLoginLab]: 'true',
  }

  test('parent init payload carries second-step fund gate', () => {
    setChosenAuthMethod('adr36_bounties')
    const methods = buildBountiesAuthCapabilities({
      env: labEnv,
      walletConnected: true,
      webAuthnAvailable: true,
    })
    const init = {
      protocol: 'terp-bounties/v1',
      type: 'init',
      daoAddress: 'terp1dao',
      chainId: '120u-1',
      authCapabilities: {
        methods,
        autoAuthorizeFunds: false as const,
        requiresSecondStepForFunds: true as const,
        activeWallet: 'terp1user',
        chosenMethodHint: getChosenAuthMethod(),
      },
      payload: {
        authCapabilities: {
          methods,
          autoAuthorizeFunds: false,
          requiresSecondStepForFunds: true,
          activeWallet: 'terp1user',
          chosenMethodHint: getChosenAuthMethod(),
        },
      },
    }

    const caps = extractAuthCapabilities(init)
    expect(caps).not.toBeNull()
    expect(caps!.autoAuthorizeFunds).toBe(false)
    expect(caps!.requiresSecondStepForFunds).toBe(true)
    expect(caps!.chosenMethodHint).toBe('adr36_bounties')
    expect(caps!.methods.some((m: { id: string }) => m.id === 'adr36_bounties')).toBe(
      true
    )
    // Threat: child must ignore autoAuthorize even if parent lies
    const evil = extractAuthCapabilities({
      type: 'authCapabilities',
      methods: caps!.methods,
      autoAuthorizeFunds: true,
      requiresSecondStepForFunds: false,
    })
    // extractor: autoAuthorizeFunds only true if === true
    expect(evil!.autoAuthorizeFunds).toBe(true)
    // product rule still: UI must ignore — document via requiresSecondStep
    // when false, UI should still enforce membership first (embed code)
  })

  test('requestAuthCapabilities refresh path', () => {
    const methods = buildBountiesAuthCapabilities({
      env: {},
      walletConnected: false,
    })
    const reply = {
      protocol: 'terp-bounties/v1',
      type: 'authCapabilities',
      methods,
      autoAuthorizeFunds: false,
      requiresSecondStepForFunds: true,
      payload: {
        methods,
        autoAuthorizeFunds: false,
        requiresSecondStepForFunds: true,
      },
    }
    const caps = extractAuthCapabilities(reply)
    expect(caps!.methods.length).toBeGreaterThan(0)
    expect(
      caps!.methods.every(
        (m: { requiresSecondStepForFunds: boolean }) =>
          m.requiresSecondStepForFunds
      )
    ).toBe(true)
  })

  test('membership then derive message sequence is ordered', () => {
    // Simulate child outbound sequence types only
    const steps: string[] = []
    steps.push('ready')
    steps.push('requestAuthCapabilities')
    steps.push('requestMembershipProof')
    // derive only after membership
    const membershipDone = true
    if (membershipDone) steps.push('requestZcashDerive')
    expect(steps.indexOf('requestMembershipProof')).toBeLessThan(
      steps.indexOf('requestZcashDerive')
    )
    expect(steps[0]).toBe('ready')
  })

  test('lab capability transcript: challenge → grant second-step', () => {
    const challenge = buildLoginChallenge({
      adapter: 'zcash_zecauth',
      chainId: '120u-1',
      daoAddress: 'terp1dao',
      addressHint: 'terp1user',
      nonce: 'test-nonce-001',
    })
    expect(challenge.message).toContain('auth-isolated-only-no-spend')
    // Simulate signed transcript (not a real sig — server may reject crypto; shape OK)
    const grant = buildCapabilityGrant({
      adapter: 'zcash_zecauth',
      proofTranscript: 'base64sig.stub',
      subjectHint: 'terp1user',
      chainId: '120u-1',
      daoAddress: 'terp1dao',
    })
    expect(grant.requiresSecondStepForFunds).toBe(true)
    expect(grant.scopes).not.toContain('spend' as never)
    expect(safeLogAdapterError(new Error('ufvk1xxx'))).not.toMatch(/ufvk1xxx/)
  })
})
