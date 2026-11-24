import { VpnKey } from '@mui/icons-material'

import { Button } from '../../buttons'
import { AuthMethodPanel } from './AuthMethodPanel'

export type OcidJwtStatus = 'unknown' | 'none' | 'session' | 'error'

export type OcidJwtAuthStageProps = {
  status: OcidJwtStatus
  detail?: string
  /** Pre-connect copy when no wallet session. */
  connectHint: string
  title: string
  openOnboardingLabel: string
  onOpenOnboarding: () => void
  /** When false, show connectHint instead of session detail. */
  showSessionDetail: boolean
  /** When true, panel uses Clear focus ring (chooser selection). */
  highlighted?: boolean
}

/**
 * Optional OCID / PFPK JWT path — never forced as sole connect path.
 */
export const OcidJwtAuthStage = ({
  status,
  detail,
  connectHint,
  title,
  openOnboardingLabel,
  onOpenOnboarding,
  showSessionDetail,
  highlighted,
}: OcidJwtAuthStageProps) => (
  <AuthMethodPanel
    Icon={VpnKey}
    description={
      !showSessionDetail
        ? connectHint
        : status === 'unknown'
          ? '…'
          : status === 'error'
            ? detail || 'Session error'
            : detail || '—'
    }
    highlighted={highlighted}
    id="auth-method-panel-ocid_jwt"
    title={title}
  >
    <div className="flex flex-row flex-wrap gap-2">
      <Button onClick={onOpenOnboarding} size="sm" variant="ghost">
        {openOnboardingLabel}
      </Button>
    </div>
  </AuthMethodPanel>
)
