import clsx from 'clsx'

import { Button } from '../buttons'

export type ChipState = 'unknown' | 'muted' | 'ok' | 'warn'

export type ParticipationChip = {
  id: string
  label: string
  state: ChipState
  detail?: string
}

export type EventParticipationStatusProps = {
  chips: ParticipationChip[]
  /**
   * Optional CTA when registration chip is not ok (muted/unknown).
   * Parent owns navigation (calendar proposal / onboarding / ceremony).
   */
  onRegisterClick?: () => void
  registerLabel?: string
  className?: string
}

/** Clear token map for fail-closed participation chips. */
export const participationChipStateClasses: Record<ChipState, string> = {
  unknown:
    'border-border-primary bg-background-tertiary text-text-tertiary opacity-70',
  muted:
    'border-border-primary bg-background-tertiary text-text-secondary opacity-80',
  ok: 'border-border-interactive-valid bg-background-button-valid/10 text-text-interactive-valid',
  warn: 'border-border-interactive-warning bg-background-button-warning/10 text-text-interactive-warning-body',
}

const dotClasses: Record<ChipState, string> = {
  unknown: 'bg-icon-tertiary',
  muted: 'bg-icon-tertiary',
  ok: 'bg-icon-interactive-valid',
  warn: 'bg-icon-interactive-warning',
}

/**
 * Clear-styled participation chips for Event Hub registration stages.
 * Presentational only — never displays secrets (JWT, nsec, nullifier).
 */
export const EventParticipationStatus = ({
  chips,
  onRegisterClick,
  registerLabel = 'Register',
  className,
}: EventParticipationStatusProps) => {
  if (!chips.length) {
    return null
  }

  const reg = chips.find((c) => c.id === 'registered')
  const showRegisterCta =
    typeof onRegisterClick === 'function' &&
    reg != null &&
    reg.state !== 'ok'

  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      <div
        aria-label="Event participation status"
        className="flex flex-wrap gap-2"
      >
        {chips.map((chip) => (
          <span
            className={clsx(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
              participationChipStateClasses[chip.state]
            )}
            data-chip-id={chip.id}
            data-chip-state={chip.state}
            key={chip.id}
            title={chip.detail || chip.label}
          >
            <span
              aria-hidden
              className={clsx(
                'inline-block h-1.5 w-1.5 rounded-full',
                dotClasses[chip.state]
              )}
            />
            {chip.label}
          </span>
        ))}
      </div>
      {showRegisterCta ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={onRegisterClick}
            size="sm"
            variant="primary"
          >
            {registerLabel}
          </Button>
          <span className="caption-text text-xs text-text-tertiary">
            {reg?.detail ||
              'Open registration / ceremony path for this event'}
          </span>
        </div>
      ) : null}
    </div>
  )
}
