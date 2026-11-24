import { useTranslation } from 'react-i18next'

import {
  EmbedFrictionCode,
  EmbedFrictionSurface,
  describeEmbedFriction,
} from '@dao-dao/utils'

export type EmbedFrictionPanelProps = {
  code: EmbedFrictionCode
  surface?: EmbedFrictionSurface
  /** Extra detail (e.g. MeshResolveError.message). */
  detail?: string
  /**
   * Visual tone. Defaults: warning for EMBED_MISSING, error for MESH_RESOLVE_FAILED.
   */
  tone?: 'warning' | 'error'
}

/**
 * Labeled friction panel — always shows F0 code so operators can grep STATUS/docs.
 * Copy comes from pure `describeEmbedFriction` (tests lock keys).
 */
export const EmbedFrictionPanel = ({
  code,
  surface,
  detail,
  tone,
}: EmbedFrictionPanelProps) => {
  const { t } = useTranslation()
  const desc = describeEmbedFriction(code, { surface, detail })
  const resolvedTone =
    tone ?? (code === 'MESH_RESOLVE_FAILED' ? 'error' : 'warning')
  const border =
    resolvedTone === 'error'
      ? 'border-border-interactive-error'
      : 'border-border-interactive-warning'
  const codeColor =
    resolvedTone === 'error'
      ? 'text-text-interactive-error-body'
      : 'text-text-interactive-warning-body'

  return (
    <div className={`flex flex-col gap-2 rounded-md border ${border} p-4`}>
      <p className={`primary-text font-mono text-xs ${codeColor}`}>
        {desc.code}
      </p>
      <p className="secondary-text text-sm">
        {t(desc.messageKey, { defaultValue: desc.defaultMessage })}
      </p>
      {detail && code !== 'MESH_RESOLVE_FAILED' ? (
        <p className="secondary-text font-mono text-xs break-all opacity-80">
          {detail}
        </p>
      ) : null}
    </div>
  )
}
