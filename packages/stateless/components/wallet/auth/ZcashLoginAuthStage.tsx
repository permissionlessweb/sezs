import { Key } from '@mui/icons-material'

import { Button } from '../../buttons'
import { AuthMethodPanel } from './AuthMethodPanel'

export type ZcashAdapterItem = {
  id: string
  label: string
  summary: string
}

export type ZcashLoginAuthStageProps = {
  title: string
  description: string
  /** Static experimental notice above lab buttons. */
  experimentalNote?: string
  experimentalTitle?: string
  adapters: ZcashAdapterItem[]
  busy?: boolean
  walletConnected: boolean
  focusedAdapterId?: string | null
  capabilityJson?: string | null
  onRunAdapter: (id: string) => void
  /** When true, primary lab panel uses Clear focus ring. */
  highlighted?: boolean
}

/**
 * Flag-gated Zcash Login lab adapters (ZecAuth / zns-login / ZecPass).
 * Never shows secrets; capability JSON is a lab grant only.
 */
export const ZcashLoginAuthStage = ({
  title,
  description,
  experimentalNote,
  experimentalTitle,
  adapters,
  busy,
  walletConnected,
  focusedAdapterId,
  capabilityJson,
  onRunAdapter,
  highlighted,
}: ZcashLoginAuthStageProps) => (
  <>
    {experimentalNote ? (
      <AuthMethodPanel
        description={experimentalNote}
        id="auth-method-panel-zcash_experimental"
        title={experimentalTitle ?? title}
      />
    ) : null}
    <AuthMethodPanel
      Icon={Key}
      description={description}
      highlighted={highlighted}
      id="auth-method-panel-zcash_zecauth"
      title={title}
    >
      <div className="flex flex-col gap-1.5">
        {adapters.map((a) => (
          <div key={a.id} className="flex flex-col gap-1">
            <Button
              disabled={busy || !walletConnected}
              loading={busy && focusedAdapterId === a.id}
              onClick={() => onRunAdapter(a.id)}
              size="sm"
              variant="secondary"
            >
              {a.label}
            </Button>
            <p className="secondary-text text-[11px]">{a.summary}</p>
          </div>
        ))}
      </div>
      {capabilityJson ? (
        <pre className="secondary-text max-h-40 overflow-auto rounded bg-background-base p-2 text-[10px]">
          {capabilityJson}
        </pre>
      ) : null}
    </AuthMethodPanel>
  </>
)
