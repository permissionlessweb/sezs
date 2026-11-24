import clsx from 'clsx'
import { ReactNode } from 'react'

import { AuthMethodChooser, AuthMethodChooserProps } from './AuthMethodChooser'

export type StableAuthSectionProps = {
  title: string
  description: string
  chooser: AuthMethodChooserProps
  children: ReactNode
  className?: string
  /** connect | connected — layout identical; reserved for future density tweaks. */
  variant?: 'connect' | 'connected'
}

/**
 * Top-level Clear layout for wallet modal multi-auth:
 * header + method chooser + stage panels (children).
 */
export const StableAuthSection = ({
  title,
  description,
  chooser,
  children,
  className,
  variant: _variant = 'connect',
}: StableAuthSectionProps) => (
  <div
    className={clsx(
      'flex flex-col gap-3 border-b border-border-base py-6 px-8',
      className
    )}
    data-auth-variant={_variant}
  >
    <div className="flex flex-row items-center gap-2">
      <p className="primary-text truncate">{title}</p>
    </div>
    <p className="secondary-text text-sm">{description}</p>
    <AuthMethodChooser {...chooser} />
    {children}
  </div>
)
