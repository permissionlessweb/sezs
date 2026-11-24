import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ButtonLink, MarkdownRenderer, useDao } from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'
import { getSupportedChainConfig } from '@dao-dao/utils'

import { useMembership, useWallet } from '../../../hooks'
import {
  DevOpsDisclosure,
  DevOpsMonoLine,
} from '../../components/DevOpsDisclosure'
import { ModuleSectionHeader } from '../../components/ModuleSectionHeader'
import { DEFAULT_HERMES_GATEWAY, HERMES_CONNECT_STEPS } from './constants'

const HERMES_INFO_MD = `### What this is

**Hermes Ops** is the community’s operations desk — task boards, pairing, and agent workflows for people who run day-to-day work.

### How to use it

1. Check whether the ops gateway is available.  
2. Open **Hermes Ops** in a new tab when you need the full board.  
3. Access may be limited to members or stewards, depending on community settings.

### Tips

- Visitors often only need Event Hub or Collab; Ops is for deeper team work.  
- If you cannot open Ops, ask a steward for access or an invite link.
`
import {
  buildHermesOpenUrl,
  probeGatewayHttp,
  resolveHermesGateway,
} from './resolveGateway'
import { HermesOpsModuleData } from './types'

/** Wallet is contract admin or DAO-level admin when that address is a wallet. */
const resolveIsAdmin = (
  address: string | undefined,
  admin: string | undefined,
  contractAdmin: string | null | undefined
): boolean => {
  if (!address) return false
  const candidates = [admin, contractAdmin].filter(
    (a): a is string => typeof a === 'string' && a.length > 0
  )
  return candidates.includes(address)
}

/**
 * HermesOps tab — informational gateway panel (no iframe).
 */
export const HermesOpsRenderer = ({
  variables: {
    description,
    gatewayUrl = '',
    opsEndpointUrl = '',
    deepLinkUrl = '',
    embedBaseUrl = '',
    agentId = '',
    communityId = '',
    defaultView = 'status',
    requireAdmin = true,
  },
}: ModuleRendererProps<HermesOpsModuleData>) => {
  const { t } = useTranslation()
  const dao = useDao()
  const { address } = useWallet({
    chainId: dao.chainId,
    attemptConnection: true,
  })
  const { isMember = false } = useMembership()
  const isAdmin = resolveIsAdmin(
    address,
    dao.info.admin,
    dao.info.contractAdmin
  )

  const chainId = dao.chainId
  const daoAddress = dao.coreAddress

  const chainHttp =
    getSupportedChainConfig(chainId)?.services?.hermesEmbed ||
    DEFAULT_HERMES_GATEWAY

  const endpoints = useMemo(
    () =>
      resolveHermesGateway({
        gatewayUrl,
        opsEndpointUrl,
        deepLinkUrl,
        embedBaseUrl,
        agentId,
        communityId,
        defaultView,
        chainHttpFallback: chainHttp,
      }),
    [
      gatewayUrl,
      opsEndpointUrl,
      deepLinkUrl,
      embedBaseUrl,
      agentId,
      communityId,
      defaultView,
      chainHttp,
    ]
  )

  const openUrl = useMemo(
    () =>
      buildHermesOpenUrl(endpoints.gatewayUrl, {
        defaultView: endpoints.defaultView,
        agentId: endpoints.agentId,
        communityId: endpoints.communityId,
        daoAddress,
        chainId,
      }),
    [endpoints, daoAddress, chainId]
  )

  const probeQuery = useQuery({
    queryKey: ['hermesGatewayProbe', endpoints.gatewayUrl],
    queryFn: () => probeGatewayHttp(endpoints.gatewayUrl),
    enabled: !!endpoints.gatewayUrl && (!requireAdmin || isAdmin || isMember),
    retry: false,
    refetchOnWindowFocus: false,
  })

  if (requireAdmin && !isAdmin) {
    return (
      <div className="flex flex-col gap-4 max-w-3xl">
        {description ? (
          <MarkdownRenderer className="text-base" markdown={description} />
        ) : null}
        <p className="secondary-text text-sm rounded-md border border-border-primary p-4">
          {t('info.hermesOpsOperatorsOnly', {
            defaultValue:
              'Hermes ops details are limited to DAO admins / operators for this module configuration.',
          })}
        </p>
      </div>
    )
  }

  const statusLabel = (() => {
    if (!endpoints.gatewayUrl) {
      return t('info.hermesGatewayNotConfigured', {
        defaultValue:
          'No Hermes gateway configured. Set gatewayUrl on the module or mesh.v1 embeds.hermes.',
      })
    }
    if (probeQuery.isLoading || probeQuery.isFetching) {
      return t('info.hermesGatewayProbing', {
        defaultValue: 'Checking gateway HTTP…',
      })
    }
    if (probeQuery.data?.state === 'ok') {
      return t('info.hermesGatewayReachable', {
        defaultValue: 'Gateway HTTP responded (light probe).',
      })
    }
    if (probeQuery.data?.state === 'error') {
      return t('info.hermesGatewayHttpError', {
        defaultValue: 'Gateway host returned an error status.',
      })
    }
    return t('info.hermesGatewayUnreachable', {
      defaultValue:
        'Could not reach gateway HTTP (offline, CORS, or blocked). Open externally if operators publish a public status URL.',
    })
  })()

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <ModuleSectionHeader
        infoMarkdown={HERMES_INFO_MD}
        infoTitle={t('title.hermesOps', { defaultValue: 'Hermes Ops' })}
        lede={
          description ? (
            <MarkdownRenderer className="text-sm" markdown={description} />
          ) : (
            t('info.hermesNotEmbeddedShort', {
              defaultValue: 'Ops gateway status — open externally when needed.',
            })
          )
        }
        title={t('title.hermesOps', { defaultValue: 'Hermes Ops' })}
        trailing={
          openUrl ? (
            <ButtonLink href={openUrl} openInNewTab size="sm" variant="primary">
              {t('button.openHermesOps', {
                defaultValue: 'Open Hermes Ops',
              })}
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="rounded-md border border-border-primary bg-background-base p-4 flex flex-col gap-2">
        <p className="secondary-text text-sm">{statusLabel}</p>

        <DevOpsDisclosure>
          {probeQuery.data?.detail ? (
            <DevOpsMonoLine label="probe" value={probeQuery.data.detail} />
          ) : null}
          {endpoints.gatewayUrl ? (
            <DevOpsMonoLine label="gateway" value={endpoints.gatewayUrl} />
          ) : null}
          {endpoints.opsEndpointUrl ? (
            <DevOpsMonoLine label="ops" value={endpoints.opsEndpointUrl} />
          ) : null}
          {endpoints.agentId ? (
            <DevOpsMonoLine label="agent" value={endpoints.agentId} />
          ) : null}
          {endpoints.communityId ? (
            <DevOpsMonoLine label="community" value={endpoints.communityId} />
          ) : null}
          <DevOpsMonoLine label="view" value={endpoints.defaultView} />
          <DevOpsMonoLine label="dao" value={daoAddress} />
          <p className="caption-text font-medium opacity-90">
            {t('title.connectHermes', {
              defaultValue: 'How to connect (Hermes)',
            })}
          </p>
          <ol className="list-decimal pl-4 space-y-1 text-xs leading-snug">
            {HERMES_CONNECT_STEPS.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </DevOpsDisclosure>
      </div>
    </div>
  )
}
