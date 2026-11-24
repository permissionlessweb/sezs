import clsx from 'clsx'

import type { AuthMethodAvailability, AuthMethodId } from '@dao-dao/utils'

import { AuthAvailabilityBadge } from './AuthAvailabilityBadge'

export type AuthMethodChooserItem = {
  id: AuthMethodId | string
  label: string
  description: string
  availability: AuthMethodAvailability
  selectable: boolean
  disabledReason?: string
}

export type AuthMethodChooserProps = {
  title: string
  hint?: string
  methods: AuthMethodChooserItem[]
  focusedMethodId?: string | null
  onSelect: (id: string) => void
  className?: string
  /** When true, hide badge for selectable ready methods. */
  hideReadyBadge?: boolean
}

/**
 * Multi-auth method discovery list (Clear styling).
 * Extension wallets stay above this section in WalletUiWalletList.
 */
export const AuthMethodChooser = ({
  title,
  hint,
  methods,
  focusedMethodId,
  onSelect,
  className,
  hideReadyBadge = true,
}: AuthMethodChooserProps) => (
  <div
    className={clsx(
      'flex flex-col gap-2 rounded-md border border-border-primary bg-background-secondary p-3',
      className
    )}
  >
    <p className="primary-text text-sm">{title}</p>
    {hint ? <p className="secondary-text text-xs">{hint}</p> : null}
    <div className="flex flex-col gap-1.5" role="list">
      {methods.map((method) => {
        const focused = focusedMethodId === method.id
        const canClick = method.selectable || method.availability === 'stub'
        const showBadge =
          !method.selectable ||
          !hideReadyBadge ||
          method.availability !== 'ready'
        return (
          <button
            key={method.id}
            className={clsx(
              'flex flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-interactive-focus',
              focused
                ? 'bg-background-interactive-selected ring-1 ring-inset ring-border-interactive-selected'
                : 'hover:bg-background-interactive-hover',
              !canClick && 'cursor-not-allowed opacity-70'
            )}
            disabled={!canClick}
            onClick={() => {
              if (canClick) {
                onSelect(method.id)
              }
            }}
            role="listitem"
            type="button"
          >
            <span className="flex w-full flex-row items-center gap-2">
              <span className="primary-text text-sm">{method.label}</span>
              {showBadge ? (
                <AuthAvailabilityBadge availability={method.availability} />
              ) : null}
            </span>
            <span className="secondary-text text-[11px]">
              {method.description}
            </span>
            {method.disabledReason ? (
              <span className="secondary-text text-[11px] text-text-tertiary">
                {method.disabledReason}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  </div>
)
