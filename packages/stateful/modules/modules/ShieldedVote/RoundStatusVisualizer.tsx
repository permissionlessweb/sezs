import {
  DEFAULT_DEV_LIFECYCLE_PHASE,
  LOCAL_CAST_PIPELINE_STEPS,
  ROUND_LIFECYCLE_STEPS,
  mapUiStatusToLocalCastStep,
  railStepVisual,
  type LocalCastPipelineStep,
  type RoundLifecyclePhase,
} from './roundLifecycle'
import type { ShieldedCastUiStatus } from './types'

const RAIL_STYLES: Record<
  ReturnType<typeof railStepVisual>,
  string
> = {
  done: 'border-border-interactive-hover bg-background-button-disabled text-text-secondary',
  current:
    'border-border-interactive-active bg-background-button text-text-button-primary',
  upcoming: 'border-border-primary bg-background-base text-text-tertiary',
  failed:
    'border-border-interactive-error bg-background-interactive-error text-text-interactive-error-body',
}

const LOCAL_STYLES: Record<LocalCastPipelineStep, string> = {
  idle: 'bg-background-base text-text-tertiary border-border-primary',
  ready: 'bg-background-button-disabled text-text-secondary border-border-secondary',
  encrypting:
    'bg-background-button text-text-button-primary border-border-interactive-active',
  encrypted:
    'bg-background-button text-text-button-primary border-border-interactive-active',
  submitted:
    'bg-background-button text-text-button-primary border-border-interactive-active',
  blocked:
    'bg-background-interactive-warning text-text-interactive-warning-body border-border-interactive-warning',
  error:
    'bg-background-interactive-error text-text-interactive-error-body border-border-interactive-error',
}

export type RoundStatusVisualizerProps = {
  /** Current round phase (scaffold until live queries). */
  currentPhase?: RoundLifecyclePhase
  /** When true, show tally_timed_out caption on FINALIZED. */
  tallyTimedOut?: boolean
  castStatus: ShieldedCastUiStatus
  /** Optional safe one-line (never plaintext vote). */
  castMessage?: string
  /** Scaffold: partial decrypt progress (V-UI-4 later). */
  partialDecryptLabel?: string
}

/**
 * Dev-only visualizer: vote-sdk lifecycle rail + local cast pipeline.
 * Do not mount on the product-minimal path (labMode off).
 */
export const RoundStatusVisualizer = ({
  currentPhase = DEFAULT_DEV_LIFECYCLE_PHASE,
  tallyTimedOut = false,
  castStatus,
  castMessage,
  partialDecryptLabel = 'partials k/t · scaffold (needs V-UI-4 query)',
}: RoundStatusVisualizerProps) => {
  const localStep = mapUiStatusToLocalCastStep(castStatus)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="font-mono text-[11px] text-text-tertiary">
          round lifecycle · scaffold (not live chain poll)
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ROUND_LIFECYCLE_STEPS.map((step) => {
            const visual = railStepVisual(step.id, currentPhase)
            const caption =
              step.id === 'FINALIZED' && tallyTimedOut
                ? 'FINALIZED + tally_timed_out (no results)'
                : step.caption
            return (
              <div
                key={step.id}
                className={`min-w-[7.5rem] flex-1 rounded-md border px-2 py-1.5 ${RAIL_STYLES[visual]}`}
                title={caption}
              >
                <p className="font-mono text-[10px] font-semibold tracking-wide">
                  {step.label}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug opacity-90">
                  {caption}
                </p>
              </div>
            )
          })}
        </div>
        {currentPhase === 'CEREMONY_FAILED' ? (
          <p className="secondary-text mt-1 text-xs text-text-interactive-error-body">
            Ceremony failed — create a new session (fresh vote_round_id).
          </p>
        ) : null}
      </div>

      <div>
        <p className="font-mono text-[11px] text-text-tertiary">
          local cast pipeline · client-only (no plaintext)
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {LOCAL_CAST_PIPELINE_STEPS.map((step) => {
            const active = step.id === localStep
            const showBlocked =
              (localStep === 'blocked' || localStep === 'error') &&
              step.id === 'ready'
            const emphasis = active || showBlocked
            const styleKey: LocalCastPipelineStep = active
              ? localStep
              : showBlocked
                ? localStep
                : 'idle'
            return (
              <span
                key={step.id}
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                  emphasis
                    ? LOCAL_STYLES[styleKey]
                    : 'border-border-primary bg-background-base text-text-tertiary opacity-60'
                }`}
              >
                {step.label}
              </span>
            )
          })}
          {localStep === 'blocked' || localStep === 'error' ? (
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${LOCAL_STYLES[localStep]}`}
            >
              {localStep}
            </span>
          ) : null}
        </div>
        {castMessage ? (
          <p className="secondary-text mt-1 text-xs">{castMessage}</p>
        ) : null}
      </div>

      <div className="rounded-md border border-border-secondary bg-background-primary/30 px-2 py-1.5">
        <p className="font-mono text-[10px] text-text-tertiary">
          tally progress · {partialDecryptLabel}
        </p>
        <p className="secondary-text mt-0.5 text-[11px]">
          Members do not open ballots after ACTIVE. Missing enc_share =
          self-exclusion; validators reach threshold or tally times out.
        </p>
      </div>
    </div>
  )
}
