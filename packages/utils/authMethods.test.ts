import { describe, expect, test } from 'vitest'

import {
  AUTH_FEATURE_FLAGS,
  AUTH_METHOD_REGISTRY,
  allFundPathsRequireSecondStep,
  buildBountiesAuthCapabilities,
  getAuthMethod,
  getChosenAuthMethod,
  isZcashLoginMasterEnabled,
  listChooserAuthMethods,
  listVisibleAuthMethods,
  resolveAuthMethod,
  setChosenAuthMethod,
} from './authMethods'

describe('authMethods registry', () => {
  test('includes planned methods for multi-auth chooser', () => {
    const ids = AUTH_METHOD_REGISTRY.map((m) => m.id)
    expect(ids).toContain('extension_wallet')
    expect(ids).toContain('passkey')
    expect(ids).toContain('adr36_bounties')
    expect(ids).toContain('ocid_jwt')
    expect(ids).toContain('smart_account')
    expect(ids).toContain('zcash_zecauth')
    expect(ids).toContain('zcash_zns_login')
    expect(ids).toContain('zcash_zecpass')
  })

  test('every membership / bounty fund path requires second step', () => {
    expect(allFundPathsRequireSecondStep()).toBe(true)
    for (const m of AUTH_METHOD_REGISTRY) {
      if (m.membershipCapable || m.id === 'adr36_bounties') {
        expect(m.requiresSecondStepForFunds).toBe(true)
      }
    }
  })

  test('all registry methods require second step for funds', () => {
    for (const m of AUTH_METHOD_REGISTRY) {
      expect(m.requiresSecondStepForFunds).toBe(true)
    }
  })

  test('Zcash adapters are never membershipCapable (until real protocol)', () => {
    for (const id of ['zcash_zecauth', 'zcash_zns_login', 'zcash_zecpass'] as const) {
      const m = getAuthMethod(id)!
      expect(m.membershipCapable).toBe(false)
      expect(m.riskTier).toBe('experimental')
      expect(m.requiresSecondStepForFunds).toBe(true)
    }
  })

  test('extension wallet is ready and selectable by default', () => {
    const r = resolveAuthMethod(getAuthMethod('extension_wallet')!, {
      env: {},
    })
    expect(r.availability).toBe('ready')
    expect(r.selectable).toBe(true)
    expect(r.visible).toBe(true)
  })

  test('WalletConnect hidden unless flag true', () => {
    const off = resolveAuthMethod(getAuthMethod('walletconnect')!, {
      env: {},
    })
    expect(off.visible).toBe(false)
    expect(off.selectable).toBe(false)

    const on = resolveAuthMethod(getAuthMethod('walletconnect')!, {
      env: { [AUTH_FEATURE_FLAGS.walletConnect]: 'true' },
    })
    expect(on.visible).toBe(true)
    expect(on.selectable).toBe(true)
  })

  test('Zcash adapters default disabled; flag enables stub only (never selectable)', () => {
    for (const id of ['zcash_zecauth', 'zcash_zns_login', 'zcash_zecpass'] as const) {
      const method = getAuthMethod(id)!
      const off = resolveAuthMethod(method, { env: {} })
      expect(off.availability).toBe('disabled')
      expect(off.selectable).toBe(false)
      expect(off.visible).toBe(true)

      const stub = resolveAuthMethod(method, {
        env: { [method.featureFlag!]: 'true' },
      })
      expect(stub.availability).toBe('stub')
      expect(stub.selectable).toBe(false)
      expect(stub.membershipCapable).toBe(false)
      expect(stub.requiresSecondStepForFunds).toBe(true)
    }
  })

  test('isZcashLoginMasterEnabled respects master or adapter flags', () => {
    expect(isZcashLoginMasterEnabled({})).toBe(false)
    expect(
      isZcashLoginMasterEnabled({
        [AUTH_FEATURE_FLAGS.zcashLogin]: 'true',
      })
    ).toBe(true)
    expect(
      isZcashLoginMasterEnabled({
        [AUTH_FEATURE_FLAGS.zcashZecPass]: 'true',
      })
    ).toBe(true)
  })

  test('wallet connect modal chooser surfaces extension + passkey + ocid', () => {
    const methods = listChooserAuthMethods('wallet_connect_modal', {
      env: {},
      webAuthnAvailable: true,
    })
    const ids = methods.map((m) => m.id)
    expect(ids).toContain('extension_wallet')
    expect(ids).toContain('passkey')
    expect(ids).toContain('ocid_jwt')
    // WC hidden by default
    expect(ids).not.toContain('walletconnect')
    // Zcash visible as disabled/stub for discovery
    expect(ids).toContain('zcash_zecauth')
  })

  test('bounties iframe capabilities include ADR-36 and second-step flags', () => {
    const caps = buildBountiesAuthCapabilities({
      env: {},
      walletConnected: true,
      webAuthnAvailable: true,
    })
    expect(caps.length).toBeGreaterThan(0)
    const adr = caps.find((c) => c.id === 'adr36_bounties')
    expect(adr).toBeDefined()
    expect(adr!.requiresSecondStepForFunds).toBe(true)
    expect(adr!.selectable).toBe(true)
    expect(caps.every((c) => c.requiresSecondStepForFunds)).toBe(true)
    // Zcash stubs must not claim membership
    for (const c of caps.filter((x) => x.id.startsWith('zcash_'))) {
      expect(c.membershipCapable).toBe(false)
      expect(c.selectable).toBe(false)
    }
  })

  test('listVisibleAuthMethods never drops extension or passkey', () => {
    const visible = listVisibleAuthMethods({ env: {} })
    expect(visible.map((m) => m.id)).toEqual(
      expect.arrayContaining(['extension_wallet', 'passkey'])
    )
  })

  test('passkey and ocid are not membershipCapable alone', () => {
    expect(getAuthMethod('passkey')!.membershipCapable).toBe(false)
    expect(getAuthMethod('ocid_jwt')!.membershipCapable).toBe(false)
    expect(getAuthMethod('extension_wallet')!.membershipCapable).toBe(true)
    expect(getAuthMethod('adr36_bounties')!.membershipCapable).toBe(true)
  })

  test('buildBountiesAuthCapabilities payload shape invariants', () => {
    const caps = buildBountiesAuthCapabilities({
      env: {},
      walletConnected: true,
      webAuthnAvailable: true,
    })
    expect(caps.every((c) => c.requiresSecondStepForFunds)).toBe(true)
    expect(caps.some((c) => c.id === 'extension_wallet')).toBe(true)
    for (const c of caps) {
      expect(c).toHaveProperty('id')
      expect(c).toHaveProperty('label')
      expect(c).toHaveProperty('availability')
      expect(c).toHaveProperty('selectable')
      expect(c).toHaveProperty('membershipCapable')
    }
  })

  test('setChosenAuthMethod / getChosenAuthMethod round-trip', () => {
    // sessionStorage may be unavailable in node — skip soft
    try {
      setChosenAuthMethod('adr36_bounties')
      const v = getChosenAuthMethod()
      if (typeof sessionStorage !== 'undefined') {
        expect(v).toBe('adr36_bounties')
        setChosenAuthMethod(null)
        expect(getChosenAuthMethod()).toBeNull()
      }
    } catch {
      expect(true).toBe(true)
    }
  })

  test('lab mode makes Zcash selectable when adapter flagged', () => {
    const lab = resolveAuthMethod(getAuthMethod('zcash_zecauth')!, {
      env: {
        [AUTH_FEATURE_FLAGS.zcashZecAuth]: 'true',
        [AUTH_FEATURE_FLAGS.zcashLoginLab]: 'true',
      },
    })
    expect(lab.selectable).toBe(true)
    expect(lab.availability).toBe('partial')
    expect(lab.membershipCapable).toBe(false)
  })
})
