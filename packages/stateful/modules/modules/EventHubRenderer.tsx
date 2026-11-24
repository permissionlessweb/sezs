import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, MarkdownRenderer, useDao } from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'
import {
  MESH_STORAGE_KEY,
  MeshResolveError,
  ResolvedMesh,
  getSupportedChainConfig,
  resolveMesh,
} from '@dao-dao/utils'

import { useMembership, useWallet } from '../../../hooks'
import { DevOpsDisclosure } from '../../components/DevOpsDisclosure'
import { ModuleSectionHeader } from '../../components/ModuleSectionHeader'
import { BountiesEventSlot } from './components/BountiesEventSlot'
import { BuzzEventSlot } from './components/BuzzEventSlot'
import { EventCalendarStrip } from './components/EventCalendarStrip'
import { EventDetailPanel } from './components/EventDetailPanel'
import {
  EventParticipationStatus,
  buildParticipationChips,
} from './components/EventParticipationStatus'
import { EventSurfaceTabs } from './components/EventSurfaceTabs'
import {
  EventWalkthroughModal,
  useEventWalkthrough,
} from './components/EventWalkthroughModal'
import { HermesEventSlot } from './components/HermesEventSlot'
import { EventHubSurfaceTab } from './constants'
import { EventHubModuleData } from './types'

const EVENT_HUB_INFO_MD = `### What this is

Your community’s **event home**: what’s happening, how to join, and where to work or chat together.

### How to use it

1. Browse the **schedule** and open an event that interests you.  
2. Use **Start here** for a short tour of the steps.  
3. Check **your participation** chips (wallet, membership, registration).  
4. Switch **Work**, **Collab**, or **Ops** tabs for bounties, chat, and team tools.

### Tips

- If a surface is offline, use **Open in new tab** when offered.  
- You never need technical setup notes to take part — ask a steward if something looks empty.
`

const meshSourceLabel = (source: ResolvedMesh['source']): string => {
  switch (source) {
    case 'dao_storage':
      return `DAO storage “${MESH_STORAGE_KEY}”`
    case 'module':
      return 'Event Hub module values'
    case 'text_record':
      return 'account text record'
    case 'chain_default':
      return 'chain headstash defaults'
    case 'override':
      return 'explicit override'
    default:
      return source
  }
}

/**
 * Event Hub tab — zones A–D:
 * A calendar strip · B event detail · C participation chips · D Work|Collab|Ops
 *
 * Config via resolveMesh once. Never invents relays. Hermes unmounted for non-members.
 */
export const EventHubRenderer = ({
  variables: {
    description,
    calendarContract,
    ceremonyContract,
    useChainMeshDefault = true,
    meshJson,
    bountiesEmbedBaseUrl = '',
    buzzEmbedBaseUrl = '',
    hermesEmbedBaseUrl = '',
    hermesDeepLinkUrl = '',
    hermesDeepLinkOnly = true,
    defaultEventSlug,
    buzzDefaultView = 'event',
    bountiesDefaultView = 'members',
    hermesBoardSlug,
    enableDaoAttest = true,
    eventTitle,
    eventAudience,
    eventCodeOfConductUrl,
    buzzGate = 'dao-member',
    hermesVisibility = 'only-members',
  },
}: ModuleRendererProps<EventHubModuleData>) => {
  const { t } = useTranslation()
  const dao = useDao()
  const { isWalletConnected, address } = useWallet({
    chainId: dao.chainId,
    attemptConnection: true,
  })
  const { isMember = false } = useMembership()

  // Contract-level admin (wasm) or DAO-level admin address match.
  // Fail-closed when admin is the DAO itself (no wallet is sole admin).
  const isAdmin = useMemo(() => {
    if (!address) return false
    const admins = [dao.info.admin, dao.info.contractAdmin].filter(
      (a): a is string => typeof a === 'string' && a.length > 0
    )
    return admins.includes(address)
  }, [address, dao.info.admin, dao.info.contractAdmin])

  const [surfaceTab, setSurfaceTab] = useState<EventHubSurfaceTab>('work')
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    defaultEventSlug?.trim() || null
  )
  const [buzzReady, setBuzzReady] = useState(false)
  const walkthrough = useEventWalkthrough()

  const chainConfig = getSupportedChainConfig(dao.chainId)
  const chainServices = chainConfig?.services

  const meshQuery = useQuery({
    queryKey: [
      'eventHubModule',
      'resolveMesh',
      dao.chainId,
      dao.coreAddress,
      calendarContract,
      ceremonyContract,
      meshJson,
      useChainMeshDefault,
      bountiesEmbedBaseUrl,
      buzzEmbedBaseUrl,
      hermesEmbedBaseUrl,
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
            calendarContract: calendarContract || undefined,
            ceremonyContract: ceremonyContract || undefined,
            meshJson: meshJson || undefined,
            embedBounties: bountiesEmbedBaseUrl || undefined,
            embedBuzz: buzzEmbedBaseUrl || undefined,
            embedHermes: hermesEmbedBaseUrl || undefined,
          }),
        },
      }),
    retry: false,
  })

  const mesh = meshQuery.data
  const meshError = meshQuery.error

  const resolvedCalendar =
    calendarContract?.trim() || mesh?.calendar || undefined
  const resolvedCeremony =
    ceremonyContract?.trim() || mesh?.ceremony || undefined

  const resolvedBountiesEmbed =
    bountiesEmbedBaseUrl?.trim() ||
    mesh?.embeds?.bounties ||
    mesh?.bounties?.embedBase ||
    chainServices?.bountiesEmbed ||
    undefined
  const resolvedBuzzEmbed =
    buzzEmbedBaseUrl?.trim() ||
    mesh?.embeds?.buzz ||
    chainServices?.buzzEmbed ||
    undefined
  const resolvedHermesEmbed =
    hermesEmbedBaseUrl?.trim() ||
    mesh?.embeds?.hermes ||
    chainServices?.hermesEmbed ||
    undefined

  // Prefer module / mesh; lab inject sets buzzGate=public for open walkthrough
  const effectiveBuzzGate =
    buzzGate || mesh?.eventDefaults?.buzzGate || 'dao-member'

  const effectiveHermesVisibility =
    mesh?.eventDefaults?.hermesVisibility || hermesVisibility || 'only-members'

  const gateBuzz =
    (effectiveBuzzGate === 'dao-member' ||
      effectiveBuzzGate === 'registered') &&
    !isMember

  const chips = useMemo(
    () =>
      buildParticipationChips({
        isWalletConnected,
        isMember,
        isRegistered: null,
        canVote: null,
        hasBountySession: false,
        buzzReady,
      }),
    [isWalletConnected, isMember, buzzReady]
  )

  // hermesVisibility: only-members | admins | hidden (fail-closed).
  const showOps =
    effectiveHermesVisibility === 'hidden'
      ? false
      : effectiveHermesVisibility === 'admins'
        ? !!isAdmin
        : !!isMember
  const activeTab = surfaceTab === 'ops' && !showOps ? 'work' : surfaceTab

  return (
    <div className="flex flex-col gap-4">
      <ModuleSectionHeader
        infoMarkdown={EVENT_HUB_INFO_MD}
        infoTitle={t('title.eventHub', { defaultValue: 'Event Hub' })}
        lede={
          description ? (
            <MarkdownRenderer className="text-sm" markdown={description} />
          ) : (
            t('info.eventHubLede', {
              defaultValue:
                'Schedule, work, and collab for the next community event.',
            })
          )
        }
        title={t('title.eventHub', { defaultValue: 'Event Hub' })}
        trailing={
          <Button onClick={walkthrough.open} size="lg" variant="primary">
            {t('button.eventWalkthrough', {
              defaultValue: 'Start here',
            })}
          </Button>
        }
      />

      <EventWalkthroughModal
        onClose={walkthrough.close}
        visible={walkthrough.visible}
      />

      {meshQuery.isLoading ? (
        <p className="caption-text opacity-70">
          {t('info.eventHubLoading', {
            defaultValue: 'Loading event surfaces…',
          })}
        </p>
      ) : meshError ? (
        <div className="rounded-md border border-border-primary bg-background-secondary p-3">
          <p className="secondary-text text-sm">
            {t('info.eventHubMeshSoftFail', {
              defaultValue:
                'Schedule uses on-chain defaults. Mesh extras are unavailable right now.',
            })}
          </p>
          <DevOpsDisclosure>
            <p className="caption-text break-all font-mono text-[11px]">
              {meshError instanceof MeshResolveError
                ? meshError.message
                : String(meshError)}
            </p>
          </DevOpsDisclosure>
        </div>
      ) : mesh ? (
        <DevOpsDisclosure
          label={t('info.eventHubMeshSummary', {
            defaultValue: 'Operator · mesh{{warn}}',
            warn: mesh.warnings.length
              ? ` · ${mesh.warnings.length} setup note(s)`
              : '',
          })}
        >
          <p className="caption-text">
            {meshSourceLabel(mesh.source)} · query:{' '}
            {mesh.query?.trim() ? mesh.query : '(chain-only)'}
          </p>
          {mesh.warnings.length ? (
            <ul className="list-inside list-disc text-xs opacity-80">
              {mesh.warnings.slice(0, 5).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </DevOpsDisclosure>
      ) : null}

      <section className="flex flex-col gap-2" id="event-hub-schedule">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="primary-text text-sm">
            {t('title.eventHubCalendar', { defaultValue: 'Schedule' })}
          </p>
          <p className="caption-text opacity-60">
            {resolvedCalendar
              ? t('info.eventHubScheduleHint', {
                  defaultValue: 'On-chain schedule',
                })
              : t('info.eventHubScheduleUnconfigured', {
                  defaultValue: 'No calendar yet',
                })}
          </p>
        </div>
        <EventCalendarStrip
          calendarContract={resolvedCalendar}
          chainId={dao.chainId}
          daoAddress={dao.coreAddress}
          meshJson={meshJson}
          onSelectEvent={(id) => setSelectedEventId(id)}
          selectedEventId={selectedEventId}
        />
      </section>

      <EventDetailPanel
        audience={eventAudience}
        calendarContract={resolvedCalendar}
        ceremonyContract={resolvedCeremony}
        codeOfConductUrl={eventCodeOfConductUrl}
        description={description}
        eventId={selectedEventId}
        title={eventTitle}
      />

      <section className="flex flex-col gap-2">
        <p className="primary-text text-sm">
          {t('title.eventHubStatus', {
            defaultValue: 'Your participation',
          })}
        </p>
        <EventParticipationStatus
          chips={chips}
          onRegisterClick={() => {
            // U8: product CTA — surface schedule / event detail as registration entry.
            // Full ceremony register path remains mesh.v1 + onboarding residual.
            setSurfaceTab('work')
            if (!selectedEventId && defaultEventSlug?.trim()) {
              setSelectedEventId(defaultEventSlug.trim())
            }
            if (typeof document !== 'undefined') {
              document
                .getElementById('event-hub-schedule')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          }}
          registerLabel={t('button.registerForEvent', {
            defaultValue: 'Register for event',
          })}
        />
      </section>

      <section className="flex flex-col gap-3">
        <EventSurfaceTabs
          onSelect={setSurfaceTab}
          selected={activeTab}
          showOps={showOps}
        />

        {activeTab === 'work' ? (
          <BountiesEventSlot
            chainId={dao.chainId}
            daoAddress={dao.coreAddress}
            defaultView={bountiesDefaultView}
            embedBase={resolvedBountiesEmbed}
            eventId={selectedEventId}
            eventSlug={defaultEventSlug}
          />
        ) : null}

        {activeTab === 'collab' ? (
          <BuzzEventSlot
            chainId={dao.chainId}
            daoAddress={dao.coreAddress}
            defaultView={buzzDefaultView}
            embedBase={resolvedBuzzEmbed}
            enableDaoAttest={enableDaoAttest}
            eventId={selectedEventId}
            eventSlug={defaultEventSlug}
            gateBlocked={gateBuzz}
            onReady={() => setBuzzReady(true)}
          />
        ) : null}

        {activeTab === 'ops' && showOps ? (
          <HermesEventSlot
            address={address}
            boardSlug={hermesBoardSlug}
            chainId={dao.chainId}
            daoAddress={dao.coreAddress}
            deepLinkOnly={hermesDeepLinkOnly}
            deepLinkUrl={hermesDeepLinkUrl}
            embedBase={resolvedHermesEmbed}
            eventId={selectedEventId}
            isAdmin={isAdmin}
            isMember={!!isMember}
          />
        ) : null}
      </section>
    </div>
  )
}
