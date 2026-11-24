import clsx from 'clsx'

import type { AuthMethodAvailability } from '@dao-dao/utils'

export type AuthAvailabilityBadgeProps = {
  availability: AuthMethodAvailability
  /** Override label; defaults to availability key. */
  label?: string
  className?: string
}

const AVAILABILITY_STYLES: Record<
  AuthMethodAvailability,
  { className: string; defaultLabel: string }
> = {
  ready: {
    className: 'bg-background-button text-text-button-primary',
    defaultLabel: 'ready',
  },
  partial: {
    className:
      'bg-background-interactive-warning text-text-interactive-warning-body',
    defaultLabel: 'partial',
  },
  flagged: {
    className: 'bg-background-tertiary text-text-secondary',
    defaultLabel: 'flagged',
  },
  disabled: {
    className: 'bg-background-tertiary text-text-tertiary',
    defaultLabel: 'disabled',
  },
  stub: {
    className: 'bg-background-base text-text-tertiary border border-border-base',
    defaultLabel: 'stub',
  },
}

/**
 * Compact availability chip for multi-auth chooser rows.
 * Matches dao-dao Clear tokens (background-*, text-*).
 */
export const AuthAvailabilityBadge = ({
  availability,
  label,
  className,
}: AuthAvailabilityBadgeProps) => {
  const style = AVAILABILITY_STYLES[availability] ?? AVAILABILITY_STYLES.disabled
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        style.className,
        className
      )}
    >
      {label ?? style.defaultLabel}
    </span>
  )
}
