import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ButtonLink, MarkdownRenderer, useDao } from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'
import { getSupportedChainConfig } from '@dao-dao/utils'

import {
  DevOpsDisclosure,
  DevOpsMonoLine,
} from '../../components/DevOpsDisclosure'
import { ModuleSectionHeader } from '../../components/ModuleSectionHeader'
import { BUZZ_CONNECT_STEPS, DEFAULT_BUZZ_HTTP, DEFAULT_BUZZ_WSS } from './constants'
import {
  buildBuzzOpenUrl,
  probeRelayerHttp,
  resolveBuzzRelayer,
} from './resolveRelayer'
import { BuzzModuleData } from './types'

const BUZZ_INFO_MD = `### What this is

**Buzz** is this community’s chat and collab room — conversations, pairing, and day-to-day coordination.

### How to use it

1. Check the status line (reachable / offline).  
2. Tap **Open Buzz** to join in the full app or desktop client.  
3. On mobile, follow the pairing steps shown when available.

### Tips

- Chat opens in a dedicated client so your session stays reliable.  
- If the room is offline, try again later or ask a steward for the current invite.
`

/**
 * Buzz tab — informational NOSA relayer panel (no iframe).
 * Soft-fails probe; never mounts a blank embed shell.
 */
export const BuzzRenderer = ({
  variables: {
    description,
    relayerHttpUrl = '',
    relayerWssUrl = '',
    communityId = '',
    displayName = '',
    embedBaseUrl = '',
  },
}: ModuleRendererProps<BuzzModuleData>) => {
  const { t } = useTranslation()
  const dao = useDao()
  const chainId = dao.chainId
  const daoAddress = dao.coreAddress

  const chainHttp =
    getSupportedChainConfig(chainId)?.services?.buzzEmbed || DEFAULT_BUZZ_HTTP
  const chainWss =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_BUZZ_WSS) ||
    DEFAULT_BUZZ_WSS

  const endpoints = useMemo(
    () =>
      resolveBuzzRelayer({
        relayerHttpUrl,
        relayerWssUrl,
        embedBaseUrl,
        communityId,
        displayName,
        chainHttpFallback: chainHttp,
        chainWssFallback: chainWss,
      }),
    [
      relayerHttpUrl,
      relayerWssUrl,
      embedBaseUrl,
      communityId,
      displayName,
      chainHttp,
      chainWss,
    ]
  )

  const openUrl = useMemo(
    () =>
      buildBuzzOpenUrl(endpoints.httpUrl, {
        communityId: endpoints.communityId,
        daoAddress,
        chainId,
      }),
    [endpoints.httpUrl, endpoints.communityId, daoAddress, chainId]
  )

  const probeQuery = useQuery({
    queryKey: ['buzzRelayerProbe', endpoints.httpUrl],
    queryFn: () => probeRelayerHttp(endpoints.httpUrl),
    enabled: !!endpoints.httpUrl,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const title =
    endpoints.displayName ||
    t('title.buzzNosaRelayer', { defaultValue: 'Buzz · NOSA relayer' })

  const statusLabel = (() => {
    if (!endpoints.httpUrl && !endpoints.wssUrl) {
      return t('info.buzzRelayerNotConfigured', {
        defaultValue:
          'No NOSA relayer configured. Set relayer HTTP/WSS on this module or publish mesh.v1 relays / embeds.buzz.',
      })
    }
    if (!endpoints.httpUrl) {
      return t('info.buzzRelayerWssOnly', {
        defaultValue:
          'WSS configured for clients. HTTP status probe skipped (add HTTP URL for health checks).',
      })
    }
    if (probeQuery.isLoading || probeQuery.isFetching) {
      return t('info.buzzRelayerProbing', {
        defaultValue: 'Checking relayer HTTP…',
      })
    }
    if (probeQuery.data?.state === 'ok') {
      return t('info.buzzRelayerReachable', {
        defaultValue: 'Relayer HTTP responded (light probe).',
      })
    }
    if (probeQuery.data?.state === 'error') {
      return t('info.buzzRelayerHttpError', {
        defaultValue: 'Relayer host returned an error status.',
      })
    }
    return t('info.buzzRelayerUnreachable', {
      defaultValue:
        'Could not reach relayer HTTP (offline, CORS, or blocked). WSS may still work in a desktop client.',
    })
  })()

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <ModuleSectionHeader
        infoMarkdown={BUZZ_INFO_MD}
        infoTitle={title}
        lede={
          description ? (
            <MarkdownRenderer className="text-sm" markdown={description} />
          ) : (
            t('info.buzzNotEmbeddedShort', {
              defaultValue: 'Community collab relay — open in your client.',
            })
          )
        }
        title={title}
        trailing={
          openUrl ? (
            <ButtonLink href={openUrl} openInNewTab size="sm" variant="primary">
              {t('button.openBuzz', { defaultValue: 'Open Buzz' })}
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="rounded-md border border-border-primary bg-background-base p-4 flex flex-col gap-2">
        <p className="secondary-text text-sm">{statusLabel}</p>
        {!openUrl ? (
          <p className="secondary-text text-sm">
            {t('info.buzzRelayerNotConfigured', {
              defaultValue:
                'No NOSA relayer configured. Set relayer HTTP/WSS on this module or publish mesh.v1 relays / embeds.buzz.',
            })}
          </p>
        ) : null}

        <DevOpsDisclosure>
          {probeQuery.data?.detail ? (
            <DevOpsMonoLine label="probe" value={probeQuery.data.detail} />
          ) : null}
          {endpoints.communityId ? (
            <DevOpsMonoLine label="community" value={endpoints.communityId} />
          ) : null}
          {endpoints.httpUrl ? (
            <DevOpsMonoLine label="HTTP" value={endpoints.httpUrl} />
          ) : null}
          {endpoints.wssUrl ? (
            <DevOpsMonoLine label="WSS" value={endpoints.wssUrl} />
          ) : null}
          <DevOpsMonoLine label="dao" value={daoAddress} />
          <DevOpsMonoLine label="chain" value={chainId} />
          <p className="caption-text font-medium opacity-90">
            {t('title.connectBuzz', { defaultValue: 'How to connect' })}
          </p>
          <ol className="list-decimal pl-4 space-y-1 text-xs leading-snug">
            {BUZZ_CONNECT_STEPS.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </DevOpsDisclosure>
      </div>
    </div>
  )
}
