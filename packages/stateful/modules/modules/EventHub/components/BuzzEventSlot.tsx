import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { hasEmbedBase, isNostrRelayRootAsEmbedBase } from '@dao-dao/utils'

import { BuzzIframeBridge } from '../../Buzz/components/BuzzIframeBridge'
import { BUZZ_IFRAME_MIN_HEIGHT } from '../../Buzz/constants'
import { buildBuzzEmbedUrl } from '../../Buzz/embedUrl'
import { EVENT_HUB_SLOT_MIN_HEIGHT } from '../constants'
import { EmbedFrictionPanel } from './EmbedFrictionPanel'

export type BuzzEventSlotProps = {
  daoAddress: string
  chainId: string
  /**
   * Resolved **embed shell** base from EventHubRenderer
   * (module → mesh.embeds.buzz → chain, relay roots already skipped).
   * Never invent hosts here.
   */
  embedBase?: string
  defaultView?: 'public' | 'event'
  enableDaoAttest?: boolean
  eventId?: string | null
  eventSlug?: string | null
  gateBlocked?: boolean
  gateMessage?: string
  onReady?: () => void
  /**
   * Soft-pending: only Nostr/NIP-11 relay URL(s) were configured — no iframe.
   */
  relayOnlyPending?: boolean
  /** Relay URL shown in friction detail (operator copy). */
  relayOnlyDetail?: string
}

/** Collab surface — Buzz bridge + event params. Never posts nsec/bounty JWT. */
export const BuzzEventSlot = ({
  daoAddress,
  chainId,
  embedBase,
  defaultView = 'event',
  enableDaoAttest = true,
  eventId,
  eventSlug,
  gateBlocked = false,
  gateMessage,
  onReady,
  relayOnlyPending = false,
  relayOnlyDetail,
}: BuzzEventSlotProps) => {
  const { t } = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [iframeHeight, setIframeHeight] = useState(EVENT_HUB_SLOT_MIN_HEIGHT)

  // Parent owns mesh/module resolution. Do not fall back to DEFAULT_* hosts.
  // Refuse relay roots even if a caller forgot to filter.
  const base = useMemo(() => {
    if (!hasEmbedBase(embedBase)) return ''
    if (isNostrRelayRootAsEmbedBase(embedBase)) return ''
    return embedBase!.trim().replace(/\/$/, '')
  }, [embedBase])

  const embedOrigin = useMemo(() => {
    if (!base) return ''
    try {
      return new URL(base).origin
    } catch {
      return ''
    }
  }, [base])

  const src = useMemo(() => {
    if (!embedOrigin) return ''
    const url = new URL(
      buildBuzzEmbedUrl({
        embedBase: base,
        daoAddress,
        chainId,
        defaultView: defaultView === 'public' ? 'public' : 'event',
      })
    )
    if (eventId) url.searchParams.set('eventId', eventId)
    if (eventSlug) url.searchParams.set('event', eventSlug)
    return url.toString()
  }, [base, embedOrigin, daoAddress, chainId, defaultView, eventId, eventSlug])

  if (gateBlocked) {
    return (
      <div className="rounded-md border border-border-primary bg-background-tertiary p-4">
        <p className="secondary-text text-sm">
          {gateMessage ||
            t('info.eventHubBuzzGated', {
              defaultValue:
                'Collab is members-only for this event. Connect a wallet that is a DAO member to join gated rooms.',
            })}
        </p>
      </div>
    )
  }

  if (relayOnlyPending || isNostrRelayRootAsEmbedBase(embedBase)) {
    return (
      <EmbedFrictionPanel
        code="RELAY_NOT_EMBED"
        detail={
          relayOnlyDetail ||
          (hasEmbedBase(embedBase) ? embedBase!.trim() : undefined)
        }
        surface="buzz"
      />
    )
  }

  if (!hasEmbedBase(embedBase) || !embedOrigin) {
    return <EmbedFrictionPanel code="EMBED_MISSING" surface="buzz" />
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="secondary-text text-xs break-all">
        {t('info.eventHubCollabSurface', {
          defaultValue: 'Collab surface (terp-buzz/v1)',
        })}{' '}
        <span className="font-mono opacity-70">{src}</span>
      </p>
      <BuzzIframeBridge
        chainId={chainId}
        daoAddress={daoAddress}
        enableDaoAttest={enableDaoAttest}
        embedOrigin={embedOrigin}
        iframeRef={iframeRef}
        onReady={onReady}
        onResize={(height) => {
          setIframeHeight(
            Math.max(EVENT_HUB_SLOT_MIN_HEIGHT, BUZZ_IFRAME_MIN_HEIGHT, height)
          )
        }}
      />
      <iframe
        allow="clipboard-write"
        className="w-full rounded-md border border-border-primary bg-background-base"
        ref={iframeRef}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        src={src}
        style={{
          height: iframeHeight,
          minHeight: EVENT_HUB_SLOT_MIN_HEIGHT,
        }}
        title={t('title.buzz', { defaultValue: 'Buzz' })}
      />
    </div>
  )
}
