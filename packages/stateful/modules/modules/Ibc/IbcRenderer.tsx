import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MarkdownRenderer, SegmentedControls } from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'

import { ChannelsPanel } from './components/ChannelsPanel'
import { RelayerFundPanel } from './components/RelayerFundPanel'
import { SwapPanel } from './components/SwapPanel'
import { IbcModuleData, IbcTab } from './types'

/**
 * IBC ops surface — channels, relayer deposits, swap entry.
 * Ported from terp.network ibc-page / fund-bar into dao-dao Module patterns.
 */
export const IbcRenderer = ({
  variables: { description, showRelayerFund, showSwapTab },
}: ModuleRendererProps<IbcModuleData>) => {
  const { t } = useTranslation()

  const tabs: { label: string; value: IbcTab }[] = [
    {
      label: t('title.channels', { defaultValue: 'Channels' }),
      value: 'channels',
    },
    ...(showRelayerFund !== false
      ? [
          {
            label: t('title.relayers', { defaultValue: 'Relayers' }),
            value: 'relayers' as const,
          },
        ]
      : []),
    ...(showSwapTab
      ? [
          {
            label: t('title.swap', { defaultValue: 'Swap' }),
            value: 'swap' as const,
          },
        ]
      : []),
  ]

  const [tab, setTab] = useState<IbcTab>('channels')
  const activeTab = tabs.some((x) => x.value === tab) ? tab : 'channels'

  return (
    <div className="flex flex-col gap-4">
      {description ? (
        <MarkdownRenderer className="text-base" markdown={description} />
      ) : (
        <p className="secondary-text text-sm">
          {t('info.ibcModuleIntro', {
            defaultValue:
              'Terp IBC inventory and foundation relayer gas. Keep public paths funded so cross-chain DAO actions stay reliable.',
          })}
        </p>
      )}

      {tabs.length > 1 ? (
        <SegmentedControls
          onSelect={setTab}
          selected={activeTab}
          tabs={tabs}
        />
      ) : null}

      {activeTab === 'channels' && <ChannelsPanel />}
      {activeTab === 'relayers' && showRelayerFund !== false && (
        <RelayerFundPanel />
      )}
      {activeTab === 'swap' && showSwapTab && <SwapPanel />}
    </div>
  )
}
