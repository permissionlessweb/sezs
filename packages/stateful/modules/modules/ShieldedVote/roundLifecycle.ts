/**
 * Round lifecycle + local cast pipeline helpers for Dev tools visualizer (V-UI-6).
 *
 * Protocol captions must not imply members plaintext-reveal after vote end.
 * Live chain poll of k/t partials is out of scope until V-UI-4 queries exist.
 */

import type { ShieldedCastUiStatus } from './types'

/** Vote-sdk SessionStatus stages shown in the progress rail. */
export type RoundLifecyclePhase =
  | 'PENDING'
  | 'ACTIVE'
  | 'TALLYING'
  | 'FINALIZED'
  | 'CEREMONY_FAILED'

export type RoundLifecycleStep = {
  id: RoundLifecyclePhase
  label: string
  /** Short protocol-accurate caption (safe for UI; no secrets). */
  caption: string
}

/**
 * Ordered product lifecycle. CEREMONY_FAILED is a side exit from PENDING, not a rail step.
 */
export const ROUND_LIFECYCLE_STEPS: readonly RoundLifecycleStep[] = [
  {
    id: 'PENDING',
    label: 'PENDING',
    caption: 'Ceremony: DKG deal + acks (validators)',
  },
  {
    id: 'ACTIVE',
    label: 'ACTIVE',
    caption: 'Cast + MsgRevealShare (enc_share only — not plaintext)',
  },
  {
    id: 'TALLYING',
    label: 'TALLYING',
    caption: 'Validators: partial decrypt t-of-n + DLEQ (not members)',
  },
  {
    id: 'FINALIZED',
    label: 'FINALIZED',
    caption: 'Totals public — or tally_timed_out (empty, no stuck round)',
  },
] as const

export type LocalCastPipelineStep =
  | 'idle'
  | 'ready'
  | 'encrypting'
  | 'encrypted'
  | 'submitted'
  | 'blocked'
  | 'error'

export const LOCAL_CAST_PIPELINE_STEPS: readonly {
  id: LocalCastPipelineStep
  label: string
}[] = [
  { id: 'idle', label: 'idle' },
  { id: 'ready', label: 'ready' },
  { id: 'encrypting', label: 'encrypting' },
  { id: 'encrypted', label: 'encrypted' },
  { id: 'submitted', label: 'submitted' },
] as const

/** Map renderer UI status → local cast pipeline chip (safe summaries only). */
export function mapUiStatusToLocalCastStep(
  status: ShieldedCastUiStatus
): LocalCastPipelineStep {
  switch (status) {
    case 'idle':
      return 'idle'
    case 'ready':
      return 'ready'
    case 'encrypting':
      return 'encrypting'
    case 'encrypted':
    case 'proving':
      return status === 'proving' ? 'encrypting' : 'encrypted'
    case 'submitted':
    case 'submit_stub':
      return 'submitted'
    case 'encrypt_unavailable':
    case 'missing_config':
      return 'blocked'
    case 'error':
      return 'error'
    default:
      return 'idle'
  }
}

export function lifecycleStepIndex(phase: RoundLifecyclePhase): number {
  const i = ROUND_LIFECYCLE_STEPS.findIndex((s) => s.id === phase)
  return i >= 0 ? i : -1
}

/**
 * Visual state of a rail step relative to current phase.
 * CEREMONY_FAILED: only PENDING marked as failed side-exit.
 */
export type RailStepVisual = 'done' | 'current' | 'upcoming' | 'failed'

export function railStepVisual(
  stepId: RoundLifecyclePhase,
  current: RoundLifecyclePhase
): RailStepVisual {
  if (current === 'CEREMONY_FAILED') {
    if (stepId === 'PENDING') return 'failed'
    return 'upcoming'
  }
  const cur = lifecycleStepIndex(current)
  const step = lifecycleStepIndex(stepId)
  if (cur < 0 || step < 0) return 'upcoming'
  if (step < cur) return 'done'
  if (step === cur) return 'current'
  return 'upcoming'
}

/** Default phase for cast UI when no live round query is wired. */
export const DEFAULT_DEV_LIFECYCLE_PHASE: RoundLifecyclePhase = 'ACTIVE'
