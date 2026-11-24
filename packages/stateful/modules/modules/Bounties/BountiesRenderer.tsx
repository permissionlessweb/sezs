import { useMemo, useRef, useState } from 'react'
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
  buildBountiesBoardEmbedUrl,
  getSupportedChainConfig,
  listBountyBoardTabs,
  resolveMesh,
  resolveSelectedBountyBoardTab,
  type BountyBoardTab,
  type ResolvedMesh,
} from '@dao-dao/utils'

import {
  DevOpsDisclosure,
  DevOpsMonoLine,
} from '../../components/DevOpsDisclosure'
import { ModuleSectionHeader } from '../../components/ModuleSectionHeader'
import {
  evaluateRegistrationBountyGate,
  shouldShowRegistrationBountyPending,
} from '../EventHub/registrationBountyGate'
import { BountiesIframeBridge } from './components/BountiesIframeBridge'
import { BOUNTIES_IFRAME_MIN_HEIGHT, DEFAULT_BOUNTIES_EMBED } from './constants'
import { BountiesModuleData } from './types'

const BOUNTIES_INFO_MD = `### What this is

**Bounties** is this community’s work board — open tasks, rewards, and claims for members and contributors.

### How to use it

1. Browse the board below (or switch boards if more than one is listed).  
2. Open a bounty to read the ask and reward.  
3. Connect your wallet when the board asks you to prove membership.  
4. If the board will not load, use **Open in new tab**.

### Tips

- Your wallet proof stays in this DAO page; only public identity is shared with the board.  
- Event-scoped boards may appear when you join from Event Hub’s Work tab.  
- Empty boards usually mean stewards have not published tasks yet.
`

const resolveEmbedBase = (
  embedBaseUrl: string | undefined,
  chainId: string
): string => {
  const trimmed = embedBaseUrl?.trim()
  if (trimmed) {
    return trimmed.replace(/\/$/, '')
  }
  const fromChain = getSupportedChainConfig(chainId)?.services?.bountiesEmbed
  return (fromChain || DEFAULT_BOUNTIES_EMBED).replace(/\/$/, '')
}

/**
 * Build embed URL:
 * `{embedBase}/embed?dao={daoAddress}&chain={chainId}&view={defaultView}&parent=daodao&auth=adr36`
 * Optional event-scoped board: `&eventId=` (EN-F6 / Event Hub Work slot).
 * Optional registration soft-gate: `ceremony`, `sessionId`, `registrationMapped`.
 */
export const buildBountiesEmbedUrl = ({
  embedBase,
  daoAddress,
  chainId,
  defaultView,
  eventId,
  eventSlug,
  ceremonyContract,
  sessionId,
  registrationMapped,
}: {
  embedBase: string
  daoAddress: string
  chainId: string
  defaultView: 'public' | 'members'
  eventId?: string | null
  eventSlug?: string | null
  ceremonyContract?: string | null
  sessionId?: string | null
  registrationMapped?: boolean | null
}): string =>
  buildBountiesBoardEmbedUrl({
    embedBase,
    daoAddress,
    chainId,
    defaultView,
    eventId,
    eventSlug,
    ceremonyContract,
    sessionId,
    registrationMapped,
  })

/**
 * Bounties tab — multi-board switcher + iframe shell + terp-bounties/v1 bridge.
 */
export const BountiesRenderer = ({
  variables: {
    description,
    embedBaseUrl = '',
    defaultView = 'members',
    bountiesChainId,
  },
}: ModuleRendererProps<BountiesModuleData>) => {
  const { t } = useTranslation()
  const dao = useDao()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [iframeHeight, setIframeHeight] = useState(BOUNTIES_IFRAME_MIN_HEIGHT)
  const [iframeFailed, setIframeFailed] = useState(false)
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null)

  const chainId = bountiesChainId?.trim() || dao.chainId
  const daoAddress = dao.coreAddress

  const embedBase = useMemo(
    () => resolveEmbedBase(embedBaseUrl, chainId),
    [embedBaseUrl, chainId]
  )

  const embedOrigin = useMemo(() => {
    try {
      return new URL(embedBase).origin
    } catch {
      return ''
    }
  }, [embedBase])

  const chainConfig = getSupportedChainConfig(chainId)
  const chainServices = chainConfig?.services

  const meshQuery = useQuery({
    queryKey: [
      'bountiesModule',
      'resolveMesh',
      chainId,
      daoAddress,
      dao.info.items[MESH_STORAGE_KEY] ?? null,
      embedBaseUrl,
    ],
    queryFn: async (): Promise<ResolvedMesh | null> => {
      try {
        return await resolveMesh({
          chainId,
          daoAddress,
          chainServices,
          loaders: {
            getDaoStorageItem: async (key) => {
              const fromInfo = dao.info.items[key]
              if (fromInfo !== undefined && fromInfo !== '') {
                return fromInfo
              }
              return null
            },
            getModuleValues: async () => ({
              embedBounties: embedBaseUrl || undefined,
            }),
          },
        })
      } catch {
        return null
      }
    },
    retry: false,
  })

  const boardTabs: BountyBoardTab[] = useMemo(
    () =>
      listBountyBoardTabs(meshQuery.data?.bounties?.boards, {
        daoLabel: t('title.bountiesAllDao', { defaultValue: 'All DAO' }),
      }),
    [meshQuery.data?.bounties?.boards, t]
  )

  const activeTab = useMemo(
    () => resolveSelectedBountyBoardTab(boardTabs, selectedBoardId),
    [boardTabs, selectedBoardId]
  )

  // EH-REG-4 / EN-F6: event-scoped boards pass ceremony + session so the child
  // can honor registrationMapped and IsRegistered/capacity when mapped.
  // DAO-wide board still emits registrationMapped so orphans stay honest.
  const ceremonyContract = meshQuery.data?.ceremony?.trim() || undefined
  const calendarContract = meshQuery.data?.calendar?.trim() || undefined
  const boardSessionId =
    activeTab.eventId?.trim() || activeTab.slug?.trim() || undefined

  const registrationGate = useMemo(
    () =>
      evaluateRegistrationBountyGate({
        ceremonyContract,
        calendarContract,
        // Session only meaningful for event-scoped boards.
        sessionId: activeTab.eventId ? boardSessionId : undefined,
        requireRegistration:
          meshQuery.data?.eventDefaults?.requireRegistration,
      }),
    [
      ceremonyContract,
      calendarContract,
      activeTab.eventId,
      boardSessionId,
      meshQuery.data?.eventDefaults?.requireRegistration,
    ]
  )

  const registrationMapped = registrationGate.allowOpenRegistrationBounty
  // Soft-pending only for event boards when ceremony missing (registration path).
  const showRegistrationPending =
    !!activeTab.eventId && shouldShowRegistrationBountyPending(registrationGate)

  const src = useMemo(
    () =>
      buildBountiesEmbedUrl({
        embedBase,
        daoAddress,
        chainId,
        defaultView: defaultView === 'public' ? 'public' : 'members',
        eventId: activeTab.eventId,
        eventSlug: activeTab.slug,
        ceremonyContract: registrationGate.ceremonyContract,
        sessionId: activeTab.eventId
          ? registrationGate.sessionId || boardSessionId
          : undefined,
        registrationMapped,
      }),
    [
      embedBase,
      daoAddress,
      chainId,
      defaultView,
      activeTab,
      registrationGate.ceremonyContract,
      registrationGate.sessionId,
      boardSessionId,
      registrationMapped,
    ]
  )

  const apiBaseUrl =
    meshQuery.data?.bounties?.apiBase ||
    getSupportedChainConfig(chainId)?.services?.bountiesApi ||
    undefined

  const title = t('title.bounties', { defaultValue: 'Bounties' })

  // Reset soft-fail when switching boards (new iframe src).
  const onSelectBoard = (id: string) => {
    setSelectedBoardId(id)
    setIframeFailed(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <ModuleSectionHeader
        infoMarkdown={BOUNTIES_INFO_MD}
        infoTitle={title}
        lede={
          description ? (
            <MarkdownRenderer className="text-sm" markdown={description} />
          ) : (
            t('info.bountiesEmbedHintShort', {
              defaultValue:
                'Browse and claim community bounties below. Sign-in stays on this page.',
            })
          )
        }
        title={title}
        trailing={
          embedOrigin ? (
            <ButtonLink href={src} openInNewTab size="sm" variant="ghost">
              {t('button.openInNewTab', { defaultValue: 'Open in new tab' })}
            </ButtonLink>
          ) : undefined
        }
      />

      {boardTabs.length > 1 && (
        <div className="flex flex-col gap-2">
          <p className="secondary-text text-sm">
            {t('info.bountiesBoardTabs', {
              defaultValue:
                'Community-wide and event boards. Switch tabs without leaving this page.',
            })}
          </p>
          <SegmentedControls
            onSelect={onSelectBoard}
            selected={activeTab.id}
            tabs={boardTabs.map((tab) => ({
              label: tab.label,
              value: tab.id,
            }))}
          />
        </div>
      )}

      {!embedOrigin ? (
        <div className="rounded-md border border-dashed border-border-primary px-4 py-6">
          <p className="primary-text text-sm">
            {t('info.bountiesInvalidEmbed', {
              defaultValue:
                'This bounties board is not available yet. Ask a steward to configure the board link for this community.',
            })}
          </p>
        </div>
      ) : showRegistrationPending ? (
        <div className="flex flex-col gap-3 rounded-md border border-border-primary bg-background-secondary p-4">
          <p className="primary-text text-sm">
            {t('info.registrationPathPendingTitle', {
              defaultValue: 'Registration path pending',
            })}
          </p>
          <p className="secondary-text text-sm">
            {t('info.registrationPathPending', {
              defaultValue:
                registrationGate.detail ||
                'No ceremony/registration contract mapped — registration bounties stay pending until mesh.v1.ceremony is set.',
            })}
          </p>
          <p className="caption-text font-mono text-[11px] opacity-70">
            REGISTRATION_PATH_PENDING · {registrationGate.code} ·
            registrationMapped=0 · eventId={activeTab.eventId}
          </p>
          <DevOpsDisclosure
            label={t('info.eventHubWorkBoardOps', {
              defaultValue: 'Operator · event board (unmapped)',
            })}
          >
            <DevOpsMonoLine label="embed" value={src} />
            <DevOpsMonoLine
              label="ceremony"
              value={ceremonyContract || '(empty)'}
            />
            <ButtonLink href={src} openInNewTab size="sm" variant="ghost">
              {t('button.openBounties', { defaultValue: 'Open bounties' })}
            </ButtonLink>
          </DevOpsDisclosure>
        </div>
      ) : iframeFailed ? (
        <div className="flex flex-col gap-3 rounded-md border border-border-primary bg-background-secondary p-4">
          <p className="primary-text text-sm">
            {t('info.bountiesOffline', {
              defaultValue: 'Bounties board could not load in this view.',
            })}
          </p>
          <ButtonLink href={src} openInNewTab variant="primary">
            {t('button.openBounties', { defaultValue: 'Open bounties' })}
          </ButtonLink>
          <DevOpsDisclosure>
            <DevOpsMonoLine label="embed" value={src} />
          </DevOpsDisclosure>
        </div>
      ) : (
        <>
          {registrationGate.code === 'session_unmapped' && activeTab.eventId ? (
            <p className="caption-text opacity-70">
              {t('info.registrationSessionUnmapped', {
                defaultValue:
                  registrationGate.detail ||
                  'Ceremony mapped; session_id not linked yet — chips stay unknown until OD-session-map resolves.',
              })}
            </p>
          ) : null}
          <BountiesIframeBridge
            apiBaseUrl={apiBaseUrl}
            chainId={chainId}
            daoAddress={daoAddress}
            embedOrigin={embedOrigin}
            iframeRef={iframeRef}
            onResize={(height) =>
              setIframeHeight(Math.max(BOUNTIES_IFRAME_MIN_HEIGHT, height))
            }
          />

          <iframe
            allow="clipboard-write"
            className="w-full rounded-md border border-border-primary bg-background-base"
            // Key forces clean load when switching boards.
            key={src}
            onError={() => setIframeFailed(true)}
            ref={iframeRef}
            // Match AppsRenderer capabilities + design sandbox notes.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            src={src}
            style={{
              height: iframeHeight,
              minHeight: BOUNTIES_IFRAME_MIN_HEIGHT,
            }}
            title={t('title.bounties', { defaultValue: 'Bounties' })}
          />
          <DevOpsDisclosure>
            <DevOpsMonoLine label="embed" value={src} />
            <DevOpsMonoLine
              label="board"
              value={
                activeTab.eventId
                  ? `event:${activeTab.eventId}`
                  : 'dao-default'
              }
            />
            <DevOpsMonoLine
              label="registrationMapped"
              value={registrationMapped ? '1' : '0'}
            />
            <DevOpsMonoLine
              label="ceremony"
              value={registrationGate.ceremonyContract || '(empty)'}
            />
            {meshQuery.data?.source ? (
              <DevOpsMonoLine label="mesh.source" value={meshQuery.data.source} />
            ) : null}
          </DevOpsDisclosure>
        </>
      )}
    </div>
  )
}
