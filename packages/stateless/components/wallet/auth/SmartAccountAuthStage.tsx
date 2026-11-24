import { Key } from '@mui/icons-material'

import { Loader } from '../../logo'
import { AuthMethodPanel } from './AuthMethodPanel'

export type SmartAccountAuthStageProps = {
  title: string
  /** 'need_wallet' | 'unsupported' | 'loading' | 'ready' */
  state: 'need_wallet' | 'unsupported' | 'loading' | 'ready'
  message?: string
  authenticatorCount?: number
  selectedId?: string
  /** When true, panel uses Clear focus ring (chooser selection). */
  highlighted?: boolean
}

/**
 * Smart-account authenticator status panel (x/smartaccount).
 */
export const SmartAccountAuthStage = ({
  title,
  state,
  message,
  authenticatorCount,
  selectedId,
  highlighted,
}: SmartAccountAuthStageProps) => (
  <AuthMethodPanel
    Icon={Key}
    highlighted={highlighted}
    id="auth-method-panel-smart_account"
    title={title}
  >
    {state === 'loading' ? (
      <Loader fill={false} size={20} />
    ) : (
      <p className="secondary-text text-xs">
        {message ??
          (state === 'ready'
            ? `${authenticatorCount ?? 0} authenticator(s); selected id: ${
                selectedId || '—'
              }`
            : state === 'unsupported'
              ? 'This chain does not expose x/smartaccount authenticators.'
              : 'Connect on a smartaccount-enabled chain to view authenticators.')}
      </p>
    )}
  </AuthMethodPanel>
)
