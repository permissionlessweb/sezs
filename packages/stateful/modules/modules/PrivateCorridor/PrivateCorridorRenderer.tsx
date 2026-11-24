import { useTranslation } from 'react-i18next'

import { MarkdownRenderer } from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'

import { PrivateCorridorWizard } from './PrivateCorridorWizard'
import { PrivateCorridorModuleData } from './types'

/**
 * PrivateCorridor tab — production Private Bridge wizard for this deployment.
 * Not Headstash airdrop claim/bloom.
 */
export const PrivateCorridorRenderer = ({
  variables,
}: ModuleRendererProps<PrivateCorridorModuleData>) => {
  const { t } = useTranslation()
  const { description, corridorId, assetBackend, btcNetwork } = variables

  return (
    <div className="flex flex-col gap-4">
      {description ? (
        <MarkdownRenderer className="text-base" markdown={description} />
      ) : (
        <p className="secondary-text text-sm">
          {t('info.privateCorridorIntro', {
            defaultValue:
              'Private Bridge (production): preauth ZEC dest → browser deposit wallet + BTC QR → client proof / auth link → bridge mint → oracle-bound swap to ZEC.',
          })}
        </p>
      )}

      <div className="flex flex-row flex-wrap gap-3 secondary-text text-xs">
        <span className="font-mono">
          corridor: {corridorId || 'cashapp-btc-zec-v0'}
        </span>
        <span className="font-mono">mode: {assetBackend}</span>
        <span className="font-mono">btc: {btcNetwork || 'mainnet'}</span>
      </div>

      <PrivateCorridorWizard moduleData={variables} />
    </div>
  )
}
