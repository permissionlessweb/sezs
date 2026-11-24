import { describe, expect, test } from 'vitest'

import {
  buildCapabilityGrant,
  buildLoginChallenge,
  safeLogAdapterError,
} from './zcashLoginAdapters'

describe('zcashLoginAdapters lab envelopes', () => {
  test('buildLoginChallenge is auth-isolated message (no spend)', () => {
    const c = buildLoginChallenge({
      adapter: 'zcash_zecauth',
      chainId: '120u-1',
      daoAddress: 'terp1dao',
      addressHint: 'terp1user',
    })
    expect(c.protocol).toBe('terp-zcash-login-lab/v0')
    expect(c.message).toContain('auth-isolated-only-no-spend')
    expect(c.message).not.toMatch(/spend_key|ufvk|seed/i)
    expect(c.expiresAt).toBeGreaterThan(c.issuedAt)
  })

  test('capability grant always requires second step for funds', () => {
    const g = buildCapabilityGrant({
      adapter: 'zcash_zecpass',
      proofTranscript: 'deadbeef',
      subjectHint: 'terp1abc',
      scopes: ['identify', 'bounties_view'],
    })
    expect(g.requiresSecondStepForFunds).toBe(true)
    expect(g.scopes).not.toContain('spend' as never)
  })

  test('safeLogAdapterError redacts key-ish tokens', () => {
    expect(safeLogAdapterError(new Error('ufvk1secret spendkey'))).not.toMatch(
      /ufvk1secret|spendkey/i
    )
  })
})
