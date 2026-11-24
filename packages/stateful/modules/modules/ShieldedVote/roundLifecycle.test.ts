import { describe, expect, test } from 'vitest'

import {
  DEFAULT_DEV_LIFECYCLE_PHASE,
  ROUND_LIFECYCLE_STEPS,
  lifecycleStepIndex,
  mapUiStatusToLocalCastStep,
  railStepVisual,
} from './roundLifecycle'

describe('roundLifecycle', () => {
  test('rail order is PENDING → ACTIVE → TALLYING → FINALIZED', () => {
    expect(ROUND_LIFECYCLE_STEPS.map((s) => s.id)).toEqual([
      'PENDING',
      'ACTIVE',
      'TALLYING',
      'FINALIZED',
    ])
  })

  test('ACTIVE caption forbids implying plaintext post-window reveal', () => {
    const active = ROUND_LIFECYCLE_STEPS.find((s) => s.id === 'ACTIVE')
    expect(active?.caption.toLowerCase()).toMatch(/enc_share|not plaintext/)
    expect(active?.caption.toLowerCase()).not.toMatch(/plaintext reveal/)
  })

  test('TALLYING caption attributes decrypt to validators', () => {
    const t = ROUND_LIFECYCLE_STEPS.find((s) => s.id === 'TALLYING')
    expect(t?.caption.toLowerCase()).toMatch(/validator/)
    expect(t?.caption.toLowerCase()).toMatch(/not member/)
  })

  test('mapUiStatusToLocalCastStep covers cast path', () => {
    expect(mapUiStatusToLocalCastStep('idle')).toBe('idle')
    expect(mapUiStatusToLocalCastStep('ready')).toBe('ready')
    expect(mapUiStatusToLocalCastStep('encrypting')).toBe('encrypting')
    expect(mapUiStatusToLocalCastStep('encrypted')).toBe('encrypted')
    expect(mapUiStatusToLocalCastStep('submit_stub')).toBe('submitted')
    expect(mapUiStatusToLocalCastStep('encrypt_unavailable')).toBe('blocked')
    expect(mapUiStatusToLocalCastStep('error')).toBe('error')
  })

  test('railStepVisual marks past / current / future', () => {
    expect(railStepVisual('PENDING', 'ACTIVE')).toBe('done')
    expect(railStepVisual('ACTIVE', 'ACTIVE')).toBe('current')
    expect(railStepVisual('TALLYING', 'ACTIVE')).toBe('upcoming')
    expect(railStepVisual('PENDING', 'CEREMONY_FAILED')).toBe('failed')
    expect(lifecycleStepIndex(DEFAULT_DEV_LIFECYCLE_PHASE)).toBe(1)
  })
})
