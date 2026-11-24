import clsx from 'clsx'
import { ComponentType, ReactNode } from 'react'

export type AuthMethodPanelProps = {
  /** DOM id for scroll-to-focus from the chooser (e.g. auth-method-panel-passkey). */
  id?: string
  title: string
  description?: ReactNode
  Icon?: ComponentType<{ className?: string }>
  children?: ReactNode
  className?: string
  /** Footer hint under actions (tertiary caption). */
  footer?: ReactNode
  /**
   * Visual focus from AuthMethodChooser selection (scroll target).
   * Uses Clear border-interactive-focus token.
   */
  highlighted?: boolean
}

/**
 * Standard Clear panel shell for one auth method stage.
 * Used inside the wallet modal stable-auth section.
 */
export const AuthMethodPanel = ({
  id,
  title,
  description,
  Icon,
  children,
  className,
  footer,
  highlighted = false,
}: AuthMethodPanelProps) => (
  <div
    className={clsx(
      'flex flex-col gap-2 rounded-md bg-background-tertiary p-3 transition-shadow',
      highlighted &&
        'ring-1 ring-inset ring-border-interactive-focus bg-background-interactive-selected',
      className
    )}
    data-highlighted={highlighted || undefined}
    id={id}
  >
    <div className="flex flex-row items-center gap-2">
      {Icon ? <Icon className="!h-4 !w-4 shrink-0 text-icon-secondary" /> : null}
      <p className="primary-text truncate text-sm">{title}</p>
    </div>
    {description ? (
      typeof description === 'string' ? (
        <p className="secondary-text text-xs">{description}</p>
      ) : (
        description
      )
    ) : null}
    {children}
    {footer ? (
      typeof footer === 'string' ? (
        <p className="secondary-text text-[11px] text-text-tertiary">{footer}</p>
      ) : (
        footer
      )
    ) : null}
  </div>
)
