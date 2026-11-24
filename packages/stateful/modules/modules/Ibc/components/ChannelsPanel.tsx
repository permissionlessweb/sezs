import { Refresh } from '@mui/icons-material'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Loader } from '@dao-dao/stateless'
import { ChainId } from '@dao-dao/types'

import {
  enrichChannelsWithClientStatus,
  listTerpIbcChannels,
} from '../utils'
import { TerpIbcChannelRow } from '../types'

const statusClass = (status?: string) => {
  const s = (status || '').toLowerCase()
  if (s === 'active' || s === 'status_active') {
    return 'text-text-interactive-valid'
  }
  if (s === 'expired' || s === 'frozen' || s.includes('inactive')) {
    return 'text-text-interactive-error'
  }
  if (s === 'unavailable') {
    return 'text-text-tertiary'
  }
  return 'text-text-secondary'
}

export const ChannelsPanel = ({
  chainId = ChainId.TerpMainnet,
}: {
  chainId?: string
}) => {
  const { t } = useTranslation()
  const [live, setLive] = useState(true)

  const staticRows = useMemo(() => listTerpIbcChannels(chainId), [chainId])

  const {
    data: rows = staticRows,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['ibcModule', 'channels', chainId, live],
    queryFn: async (): Promise<TerpIbcChannelRow[]> => {
      if (!live) {
        return staticRows
      }
      return enrichChannelsWithClientStatus(chainId, staticRows)
    },
    initialData: staticRows,
    staleTime: 60_000,
  })

  const preferredCount = rows.filter((r) => r.preferred).length
  const activeCount = rows.filter(
    (r) =>
      (r.clientStatus || r.status || '').toLowerCase().includes('active') ||
      (!r.clientStatus && r.status === 'ACTIVE')
  ).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-md border border-border-primary px-2 py-1">
            {t('info.ibcChannelCount', {
              defaultValue: '{{count}} channels',
              count: rows.length,
            })}
          </span>
          <span className="rounded-md border border-border-primary px-2 py-1">
            {t('info.ibcPreferredCount', {
              defaultValue: '{{count}} preferred',
              count: preferredCount,
            })}
          </span>
          <span className="rounded-md border border-border-primary px-2 py-1">
            {t('info.ibcActiveHint', {
              defaultValue: '{{count}} active-tagged',
              count: activeCount,
            })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setLive((v) => !v)}
            size="sm"
            variant="secondary"
          >
            {live
              ? t('button.staticOnly', { defaultValue: 'Static registry' })
              : t('button.liveStatus', { defaultValue: 'Live client status' })}
          </Button>
          <Button
            disabled={isFetching}
            onClick={() => refetch()}
            size="sm"
            variant="secondary"
          >
            {isFetching ? (
              <Loader fill={false} size={16} />
            ) : (
              <Refresh className="!h-4 !w-4" />
            )}
            {t('button.refresh')}
          </Button>
        </div>
      </div>

      {isError && (
        <p className="text-sm text-text-interactive-warning-body">
          {t('error.ibcLiveStatusFailed', {
            defaultValue:
              'Live client status unavailable ({{msg}}). Showing registry channels.',
            msg: error instanceof Error ? error.message : String(error),
          })}
        </p>
      )}

      <p className="secondary-text text-xs">
        {t('info.ibcChannelsSource', {
          defaultValue:
            'Source: curated terp-state / chain-registry IBC paths for {{chainId}}. Live mode queries Terp LCD client_status.',
          chainId,
        })}
      </p>

      <div className="overflow-x-auto rounded-md border border-border-primary">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="border-b border-border-primary bg-background-secondary">
            <tr className="text-xs uppercase tracking-wide text-text-tertiary">
              <th className="px-3 py-2 font-medium">
                {t('title.counterparty', { defaultValue: 'Counterparty' })}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('title.channel', { defaultValue: 'Channel' })}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('title.cpChannel', { defaultValue: 'Cp channel' })}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('title.client', { defaultValue: 'Client' })}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('title.status', { defaultValue: 'Status' })}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('title.version', { defaultValue: 'Version' })}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-text-tertiary"
                  colSpan={6}
                >
                  {t('info.noIbcChannels', {
                    defaultValue:
                      'No Terp IBC transfer channels found in registry.',
                  })}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={`${row.counterpartyName}-${row.sourceChannel}-${row.destinationChannel}`}
                  className="border-b border-border-secondary last:border-0"
                >
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-medium capitalize">
                        {row.counterpartyName}
                        {row.preferred ? (
                          <span className="ml-2 rounded bg-background-button-secondary px-1.5 py-0.5 text-[10px] uppercase text-text-secondary">
                            preferred
                          </span>
                        ) : null}
                      </span>
                      {row.counterpartyChainId ? (
                        <span className="font-mono text-xs text-text-tertiary">
                          {row.counterpartyChainId}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.port}/{row.sourceChannel}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.destinationChannel}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                    {row.sourceClientId}
                  </td>
                  <td className={`px-3 py-2 text-xs ${statusClass(row.clientStatus || row.status)}`}>
                    {row.clientStatus || row.status || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-tertiary">
                    {row.version}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
