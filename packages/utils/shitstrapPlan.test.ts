import { describe, expect, test } from 'vitest'

import {
  SHIT_RATE_SCALE,
  computeSvgMintPaymentPlan,
  shitstrapSlopNeeded,
  shitstrapUthiolOut,
} from './shitstrapPlan'

describe('shitstrapPlan', () => {
  test('rate math round-trips approximately', () => {
    const rate = SHIT_RATE_SCALE // 1:1
    expect(shitstrapUthiolOut(1_000_000n, rate)).toBe(1_000_000n)
    expect(shitstrapSlopNeeded(1_000_000n, rate)).toBe(1_000_000n)
  })

  test('wallet-only plan when balance covers mint', () => {
    const plan = computeSvgMintPaymentPlan({
      quantity: 2,
      pricePerToken: '1000',
      walletMintDenomBalance: '5000',
      mintDenom: 'uthiol',
      straps: [],
    })
    expect(plan.preferredPath).toBe('wallet')
    expect(plan.totalMintDenom).toBe('2000')
    expect(plan.mintDenomFromWallet).toBe('2000')
    expect(plan.steps).toHaveLength(0)
    expect(plan.canAfford).toBe(true)
    expect(plan.canAtomicMint).toBe(false)
  })

  test('atomic when single strap covers all', () => {
    const plan = computeSvgMintPaymentPlan({
      quantity: 1,
      pricePerToken: '1000',
      walletMintDenomBalance: '0',
      mintDenom: 'uthiol',
      straps: [
        {
          contract: 'terp1strap',
          slopDenom: 'uosmo',
          shitRate: SHIT_RATE_SCALE.toString(),
          userBal: 10_000n,
          maxUthiol: 10_000n,
          capacity: 10_000n,
        },
      ],
      atomicSupported: true,
    })
    expect(plan.canAtomicMint).toBe(true)
    expect(plan.preferredPath).toBe('atomic')
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0].slopDenom).toBe('uosmo')
  })

  test('whitelist fee waived', () => {
    const plan = computeSvgMintPaymentPlan({
      quantity: 3,
      pricePerToken: '999',
      walletMintDenomBalance: '0',
      mintDenom: 'uthiol',
      straps: [],
      feeWaived: true,
      proofHashes: ['aa', 'bb'],
    })
    expect(plan.preferredPath).toBe('whitelist')
    expect(plan.canAfford).toBe(true)
    expect(plan.proofHashes).toEqual(['aa', 'bb'])
  })
})
