import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import {
  ButtonLink,
  MarkdownRenderer,
  SegmentedControls,
  useDao,
} from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'
import {
  MESH_STORAGE_KEY,
  ResolvedMesh,
  getSupportedChainConfig,
  resolveMesh,
} from '@dao-dao/utils'

import { useMembership, useWallet } from '../../../hooks'
import { MobileBuzzPairing } from '../../components/MobileBuzzPairing'
import { ModuleSectionHeader } from '../../components/ModuleSectionHeader'
import { BuzzEventSlot } from '../EventHub/components/BuzzEventSlot'
import { HermesEventSlot } from '../EventHub/components/HermesEventSlot'
import { buildBuzzOpenUrl } from '../Buzz/resolveRelayer'
import {
  CollabEndpointCard,
  buildCollabEndpoints,
} from './collabEndpoints'
import { COLLAB_OPS_PLANES } from './constants'
import {
  canShowPrivatePlane,
  privatePlaneLegendState,
  visiblePlaneTabs,
} from './planes'
import { CollabOpsModuleData, CollabOpsPlaneId } from './types'

const COLLAB_OPS_INFO_MD = `### What this is

**Collab & Ops** is one place for **public chat** (Buzz) and **member ops** (Hermes). Visitors see the public room; members can open the private ops plane when it is enabled.

### How to use it

1. Stay on **Public** for community chat and open links.  
2. Switch to **Private** only if you are a member and need team ops tools.  
3. Use **Open** on a card when you want the full app in a new tab.  
4. On mobile, follow pairing steps when they appear for Buzz.

### Tips

- Private ops stay separate from the public room — guests never load member tools by accident.  
- If a plane looks empty, ask a steward to publish the current links for this community.
`

const TOUCH_CTA =
  'min-h-[44px] min-w-[44px] touch-manipulation inline-flex items-center justify-center'

const EndpointCardView = ({ card }: { card: CollabEndpointCard }) => {
  const { t } = useTranslation()
  return (
    <div className="rounded-md border border-border-primary bg-background-base p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="primary-text text-sm font-medium">{card.label}</p>
          <p className="secondary-text text-xs">
            {card.kind}
            {' · '}
            {card.sourceHint}
            {' · '}
            {card.plane}
          </p>
        </div>
        {card.url ? (
          <ButtonLink
            className={TOUCH_CTA}
            href={card.url}
            openInNewTab
            size="lg"
            variant="secondary"
          >
            {t('button.open', { defaultValue: 'Open' })}
          </ButtonLink>
        ) : null}
      </div>
      {card.url ? (
        <p className="font-mono text-[11px] text-text-tertiary break-all">
          {card.url}
        </p>
      ) : null}
      {card.relayWss ? (
        <p className="secondary-text text-xs break-all">
          <span className="font-medium">WSS </span>
          <span className="font-mono opacity-80">{card.relayWss}</span>
        </p>
      ) : null}
    </div>
  )
}

/**
 * Unified Buzz + Hermes **info** surface (Phase-1).
 * Endpoint cards from mesh.v1; optional live embeds; fail-closed private plane.
 */
export const CollabOpsRenderer = ({
  variables: {
    description,
    buzzEmbedBaseUrl = '',
    buzzDefaultView = 'public',
    enableDaoAttest = true,
    hermesEmbedBaseUrl = '',
    hermesDeepLinkUrl = '',
    hermesDeepLinkOnly = true,
    hermesBoardSlug = '',
    privateVisibility = 'only-members',
    defaultPlane = 'public',
    useChainMeshDefault = true,
    meshJson = '',
    showLiveEmbeds = false,
  },
}: ModuleRendererProps<CollabOpsModuleData>) => {
  const { t } = useTranslation()
  const dao = useDao()
  const chainConfig = getSupportedChainConfig(dao.chainId)
  const chainServices = chainConfig?.services

  const { isWalletConnected, address } = useWallet({
    chainId: dao.chainId,
    attemptConnection: true,
  })
  const { isMember = false } = useMembership()

  const isAdmin = useMemo(() => {
    if (!address) return false
    const admins = [dao.info.admin, dao.info.contractAdmin].filter(
      (a): a is string => typeof a === 'string' && a.length > 0
    )
    return admins.includes(address)
  }, [address, dao.info.admin, dao.info.contractAdmin])

  const canPrivate = canShowPrivatePlane({
    isMember: !!isMember,
    isAdmin,
    privateVisibility,
  })

  const legend = privatePlaneLegendState({
    isWalletConnected: !!isWalletConnected,
    isMember: !!isMember,
    isAdmin,
    privateVisibility,
  })

  const tabs = visiblePlaneTabs(privateVisibility)

  const [activePlane, setActivePlane] = useState<CollabOpsPlaneId>(
    defaultPlane === 'private' && canPrivate ? 'private' : 'public'
  )

  const meshQuery = useQuery({
    queryKey: [
      'collabOpsModule',
      'resolveMesh',
      dao.chainId,
      dao.coreAddress,
      meshJson,
      useChainMeshDefault,
      buzzEmbedBaseUrl,
      hermesEmbedBaseUrl,
      hermesDeepLinkUrl,
      dao.info.items[MESH_STORAGE_KEY] ?? null,
    ],
    queryFn: async (): Promise<ResolvedMesh> =>
      resolveMesh({
        chainId: dao.chainId,
        daoAddress: dao.coreAddress,
        chainServices: useChainMeshDefault === false ? {} : chainServices,
        loaders: {
          getDaoStorageItem: async (key) => {
            const fromInfo = dao.info.items[key]
            if (fromInfo !== undefined && fromInfo !== '') {
              return fromInfo
            }
            return null
          },
          getModuleValues: async () => ({
            meshJson: meshJson || undefined,
            embedBuzz: buzzEmbedBaseUrl || undefined,
            embedHermes:
              hermesEmbedBaseUrl || hermesDeepLinkUrl || undefined,
          }),
        },
      }),
    retry: false,
  })

  const mesh = meshQuery.data
  const endpoints = useMemo(
    () =>
      buildCollabEndpoints({
        mesh: mesh ?? null,
        moduleBuzz: buzzEmbedBaseUrl,
        moduleHermes: hermesEmbedBaseUrl,
        moduleHermesDeepLink: hermesDeepLinkUrl,
      }),
    [mesh, buzzEmbedBaseUrl, hermesEmbedBaseUrl, hermesDeepLinkUrl]
  )

  /** Mobile pairing open URL for first public Buzz card (mesh/module only). */
  const buzzPairingUrl = useMemo(() => {
    const buzzCard = endpoints.publicCards.find((c) => c.kind === 'buzz')
    if (!buzzCard?.url) return ''
    return buildBuzzOpenUrl(buzzCard.url, {
      daoAddress: dao.coreAddress,
      chainId: dao.chainId,
    })
  }, [endpoints.publicCards, dao.coreAddress, dao.chainId])

  const buzzPairingWss = useMemo(() => {
    const relay = endpoints.publicCards.find((c) => c.kind === 'relay')
    return relay?.relayWss || ''
  }, [endpoints.publicCards])

  const planeTabs = COLLAB_OPS_PLANES.filter((p) => tabs.includes(p.id)).map(
    (p) => ({
      label: t(`title.collabOpsPlane.${p.id}`, { defaultValue: p.label }),
      value: p.id,
    })
  )

  const legendCopy = (() => {
    switch (legend) {
      case 'available':
        return t('info.collabOpsPrivateAvailable', {
          defaultValue:
            'Private plane unlocked — Hermes ops is member-gated and separate from the public Buzz surface.',
        })
      case 'gated-connect':
        return t('info.collabOpsPrivateConnect', {
          defaultValue:
            'Private plane (Hermes ops) is for DAO members. Connect a wallet that holds membership to open it.',
        })
      case 'gated-member':
        return t('info.collabOpsPrivateMemberOnly', {
          defaultValue:
            'Private plane (Hermes ops) is member-gated. This wallet is not a DAO member — public collab stays available.',
        })
      case 'hidden':
        return t('info.collabOpsPrivateHidden', {
          defaultValue:
            'Private ops plane is disabled for this DAO configuration.',
        })
      default:
        return ''
    }
  })()

  const emptyPublic = (
    <div className="rounded-md border border-dashed border-border-primary px-4 py-5 flex flex-col gap-2">
      <p className="primary-text text-sm">
        {t('title.collabOpsPublicEmpty', {
          defaultValue: 'Public collab not configured',
        })}
      </p>
      <p className="secondary-text text-sm">
        {t('info.collabOpsPublicEmpty', {
          defaultValue:
            'Public chat is not set up for this community yet. Ask a steward to add a Buzz link on Collab & Ops or Event Hub.',
        })}
      </p>
    </div>
  )

  const emptyPrivate = (
    <div className="rounded-md border border-dashed border-border-primary px-4 py-5 flex flex-col gap-2">
      <p className="primary-text text-sm">
        {t('title.collabOpsPrivateEmpty', {
          defaultValue: 'Private ops not configured',
        })}
      </p>
      <p className="secondary-text text-sm">
        {t('info.collabOpsPrivateEmpty', {
          defaultValue:
            'Private ops is not set up for this community yet. Ask a steward to add a Hermes link on Collab & Ops or Event Hub.',
        })}
      </p>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <ModuleSectionHeader
        infoMarkdown={COLLAB_OPS_INFO_MD}
        infoTitle={t('title.collabOps', { defaultValue: 'Collab & Ops' })}
        lede={
          description ? (
            <MarkdownRenderer className="text-sm" markdown={description} />
          ) : (
            t('info.collabOpsPlanesLegend', {
              defaultValue:
                'Public = Buzz chat for everyone · Private = Hermes ops for members only',
            })
          )
        }
        title={t('title.collabOps', { defaultValue: 'Collab & Ops' })}
        trailing={
          <span
            className={`rounded-full px-2 py-0.5 font-mono text-xs ${
              activePlane === 'private'
                ? 'bg-background-interactive-warning text-text-interactive-warning-body'
                : 'bg-background-secondary text-text-secondary'
            }`}
          >
            {activePlane === 'private'
              ? t('info.collabOpsBadgePrivate', {
                  defaultValue: 'Private',
                })
              : t('info.collabOpsBadgePublic', {
                  defaultValue: 'Public',
                })}
          </span>
        }
      />

      {meshQuery.isError ? (
        <p className="secondary-text text-sm rounded-md border border-border-primary p-3">
          {t('info.collabOpsMeshError', {
            defaultValue:
              'Could not load community collab links. Try again later or ask a steward to publish Collab & Ops settings.',
          })}
        </p>
      ) : null}

      {planeTabs.length > 1 ? (
        <SegmentedControls
          onSelect={(value) => setActivePlane(value)}
          selected={activePlane}
          tabs={planeTabs}
        />
      ) : null}

      {activePlane === 'public' ? (
        <div className="flex flex-col gap-3">
          <p className="secondary-text text-sm">
            {t('info.collabOpsPublicIntro', {
              defaultValue:
                'Public chat and coordination for everyone. Open a link or live surface below when available.',
            })}
          </p>
          {endpoints.publicEmpty
            ? emptyPublic
            : endpoints.publicCards.map((c) => (
                <EndpointCardView key={c.id} card={c} />
              ))}
          {buzzPairingUrl ? (
            <MobileBuzzPairing
              openUrl={buzzPairingUrl}
              wssUrl={buzzPairingWss || undefined}
            />
          ) : null}
          {legend !== 'available' && legend !== 'hidden' ? (
            <p className="secondary-text text-xs border-t border-border-secondary pt-3">
              {legendCopy}
            </p>
          ) : null}
          {showLiveEmbeds && !endpoints.publicEmpty ? (
            <div className="flex flex-col gap-2 border-t border-border-secondary pt-3">
              <p className="primary-text text-sm">
                {t('title.collabOpsLivePublic', {
                  defaultValue: 'Live collab surface',
                })}
              </p>
              <BuzzEventSlot
                chainId={dao.chainId}
                daoAddress={dao.coreAddress}
                defaultView={buzzDefaultView}
                embedBase={
                  buzzEmbedBaseUrl || mesh?.embeds?.buzz || ''
                }
                enableDaoAttest={enableDaoAttest}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {activePlane === 'private' ? (
        <div className="flex flex-col gap-3">
          {canPrivate ? (
            <>
              <p className="secondary-text text-sm">
                {t('info.collabOpsPrivateIntro', {
                  defaultValue:
                    'Member ops tools (Hermes). Not shown to visitors — open a link below when you need the full board.',
                })}
              </p>
              {endpoints.privateEmpty
                ? emptyPrivate
                : endpoints.privateCards.map((c) => (
                    <EndpointCardView key={c.id} card={c} />
                  ))}
              {showLiveEmbeds && !endpoints.privateEmpty ? (
                <div className="flex flex-col gap-2 border-t border-border-secondary pt-3">
                  <p className="primary-text text-sm">
                    {t('title.collabOpsLivePrivate', {
                      defaultValue: 'Live ops surface',
                    })}
                  </p>
                  <HermesEventSlot
                    address={address}
                    boardSlug={hermesBoardSlug || undefined}
                    chainId={dao.chainId}
                    daoAddress={dao.coreAddress}
                    deepLinkOnly={hermesDeepLinkOnly}
                    deepLinkUrl={
                      hermesDeepLinkUrl ||
                      hermesEmbedBaseUrl ||
                      mesh?.embeds?.hermes ||
                      ''
                    }
                    embedBase={
                      hermesEmbedBaseUrl || mesh?.embeds?.hermes || ''
                    }
                    isAdmin={isAdmin}
                    isMember={!!isMember}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-md border border-border-primary bg-background-tertiary p-4">
              <p className="primary-text text-sm mb-2">
                {t('title.collabOpsPrivateGated', {
                  defaultValue: 'Private plane gated',
                })}
              </p>
              <p className="secondary-text text-sm">{legendCopy}</p>
              <p className="secondary-text text-xs mt-3">
                {t('info.collabOpsNoPrivateLeak', {
                  defaultValue:
                    'Hermes URLs and operator context are not mounted for this viewer.',
                })}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
