import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ButtonLink } from '@dao-dao/stateless'
import { getSupportedChainConfig } from '@dao-dao/utils'

import { buildBountiesEmbedUrl } from '../../Bounties/BountiesRenderer'
import { BountiesIframeBridge } from '../../Bounties/components/BountiesIframeBridge'
import {
  BOUNTIES_IFRAME_MIN_HEIGHT,
  DEFAULT_BOUNTIES_EMBED,
} from '../../Bounties/constants'
import {
  DevOpsDisclosure,
  DevOpsMonoLine,
} from '../../../components/DevOpsDisclosure'
import { EVENT_HUB_SLOT_MIN_HEIGHT } from '../constants'
import {
  RegistrationBountyGate,
  shouldShowRegistrationBountyPending,
} from '../registrationBountyGate'

export type BountiesEventSlotProps = {
  daoAddress: string
  chainId: string
  embedBase?: string
  defaultView?: 'public' | 'members'
  eventId?: string | null
  eventSlug?: string | null
  /** Resolved ceremony contract (module first, else mesh.v1.ceremony). */
  ceremonyContract?: string | null
  /** OD-session-map session_id when known. */
  sessionId?: string | null
  /** Soft-gate result from EventHubRenderer (required for honest pending). */
  registrationGate?: RegistrationBountyGate
}

/** Work surface — Bounties bridge + optional event deep-link params. */
export const BountiesEventSlot = ({
  daoAddress,
  chainId,
  embedBase,
  defaultView = 'members',
  eventId,
  eventSlug,
  ceremonyContract,
  sessionId,
  registrationGate,
}: BountiesEventSlotProps) => {
  const { t } = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [iframeHeight, setIframeHeight] = useState(EVENT_HUB_SLOT_MIN_HEIGHT)
  const [iframeFailed, setIframeFailed] = useState(false)

  const base = useMemo(() => {
    const trimmed = embedBase?.trim()
    if (trimmed) return trimmed.replace(/\/$/, '')
    const fromChain = getSupportedChainConfig(chainId)?.services?.bountiesEmbed
    return (fromChain || DEFAULT_BOUNTIES_EMBED).replace(/\/$/, '')
  }, [embedBase, chainId])

  const embedOrigin = useMemo(() => {
    try {
      return new URL(base).origin
    } catch {
      return ''
    }
  }, [base])

  const registrationMapped =
    registrationGate?.allowOpenRegistrationBounty === true ||
    !!(ceremonyContract?.trim())

  const src = useMemo(() => {
    if (!embedOrigin) return ''
    return buildBountiesEmbedUrl({
      embedBase: base,
      daoAddress,
      chainId,
      defaultView: defaultView === 'public' ? 'public' : 'members',
      eventId,
      eventSlug,
      ceremonyContract,
      sessionId,
      registrationMapped:
        registrationGate?.allowOpenRegistrationBounty ?? registrationMapped,
    })
  }, [
    base,
    embedOrigin,
    daoAddress,
    chainId,
    defaultView,
    eventId,
    eventSlug,
    ceremonyContract,
    sessionId,
    registrationGate?.allowOpenRegistrationBounty,
    registrationMapped,
  ])

  const apiBaseUrl =
    getSupportedChainConfig(chainId)?.services?.bountiesApi || undefined

  const showRegistrationPending =
    !!registrationGate && shouldShowRegistrationBountyPending(registrationGate)

  if (!embedOrigin || !src) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-dashed border-border-primary px-4 py-6">
        <p className="primary-text text-sm">
          {t('info.eventHubNoBountiesEmbedTitle', {
            defaultValue: 'Work board not configured',
          })}
        </p>
        <p className="secondary-text text-sm">
          {t('info.eventHubNoBountiesEmbed', {
            defaultValue:
              'Set bounties embed base on Event Hub or publish mesh.v1 embeds.bounties.',
          })}
        </p>
      </div>
    )
  }

  if (showRegistrationPending) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-border-primary bg-background-secondary p-4">
        <p className="primary-text text-sm">
          {t('info.registrationPathPendingTitle', {
            defaultValue: 'Registration path pending',
          })}
        </p>
        <p className="secondary-text text-sm">
          {t('info.registrationPathPending', {
            defaultValue:
              registrationGate?.detail ||
              'No ceremony/registration contract mapped — registration bounties stay pending until mesh.v1.ceremony or Event Hub ceremonyContract is set.',
          })}
        </p>
        <p className="caption-text font-mono text-[11px] opacity-70">
          REGISTRATION_PATH_PENDING
          {registrationGate?.code ? ` · ${registrationGate.code}` : ''}
          {' · registrationMapped=0'}
        </p>
        <DevOpsDisclosure
          label={t('info.eventHubWorkBoardOps', {
            defaultValue: 'Operator · work board (unmapped)',
          })}
        >
          <DevOpsMonoLine label="embed" value={src} />
          <DevOpsMonoLine
            label="ceremony"
            value={ceremonyContract?.trim() || '(empty)'}
          />
          <DevOpsMonoLine
            label="sessionId"
            value={sessionId?.trim() || '(empty)'}
          />
          <p className="caption-text opacity-70">
            Full board still reachable for operators — open in new tab if needed.
            Child boards should honor registrationMapped=0.
          </p>
          <ButtonLink href={src} openInNewTab size="sm" variant="ghost">
            {t('button.openBounties', { defaultValue: 'Open bounties' })}
          </ButtonLink>
        </DevOpsDisclosure>
      </div>
    )
  }

  if (iframeFailed) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-border-primary bg-background-secondary p-4">
        <p className="primary-text text-sm">
          {t('info.eventHubBountiesOffline', {
            defaultValue: 'Work board is offline or blocked in this browser.',
          })}
        </p>
        <p className="secondary-text text-sm">
          {t('info.eventHubBountiesOfflineHint', {
            defaultValue: 'Open the board in a new tab, or try again later.',
          })}
        </p>
        <ButtonLink href={src} openInNewTab variant="primary">
          {t('button.openBounties', { defaultValue: 'Open bounties' })}
        </ButtonLink>
        <DevOpsDisclosure>
          <DevOpsMonoLine label="embed" value={src} />
        </DevOpsDisclosure>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="secondary-text text-sm">
          {t('info.eventHubWorkSurface', {
            defaultValue: 'Work board',
          })}
        </p>
        <ButtonLink href={src} openInNewTab size="sm" variant="ghost">
          {t('button.openInNewTab', { defaultValue: 'Open in new tab' })}
        </ButtonLink>
      </div>
      {registrationGate?.code === 'session_unmapped' ? (
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
          setIframeHeight(
            Math.max(
              EVENT_HUB_SLOT_MIN_HEIGHT,
              BOUNTIES_IFRAME_MIN_HEIGHT,
              height
            )
          )
        }
      />
      <iframe
        allow="clipboard-write"
        className="w-full rounded-md border border-border-primary bg-background-base"
        onError={() => setIframeFailed(true)}
        ref={iframeRef}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        src={src}
        style={{
          height: iframeHeight,
          minHeight: EVENT_HUB_SLOT_MIN_HEIGHT,
        }}
        title={t('title.bounties', { defaultValue: 'Bounties' })}
      />
      <DevOpsDisclosure>
        <DevOpsMonoLine label="embed" value={src} />
        <DevOpsMonoLine
          label="registrationMapped"
          value={registrationMapped ? '1' : '0'}
        />
        <DevOpsMonoLine
          label="ceremony"
          value={ceremonyContract?.trim() || '(empty)'}
        />
      </DevOpsDisclosure>
    </div>
  )
}
