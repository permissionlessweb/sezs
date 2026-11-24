import { Key } from '@mui/icons-material'

import { AuthMethodPanel } from './AuthMethodPanel'

export type Adr36AuthStageProps = {
  title: string
  description: string
  statusLine: string
  /** When true, panel uses Clear focus ring (chooser selection). */
  highlighted?: boolean
}

/**
 * ADR-36 bounties membership session info panel.
 * Fund/claim derive remains a separate explicit step (not rendered here).
 */
export const Adr36AuthStage = ({
  title,
  description,
  statusLine,
  highlighted,
}: Adr36AuthStageProps) => (
  <AuthMethodPanel
    Icon={Key}
    description={description}
    footer={statusLine}
    highlighted={highlighted}
    id="auth-method-panel-adr36_bounties"
    title={title}
  />
)
