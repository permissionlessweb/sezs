import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ButtonLink } from '@dao-dao/stateless'
import {
  describeEmbedFriction,
  hasEmbedBase,
} from '@dao-dao/utils'

import { HermesOpsIframeBridge } from '../../HermesOps/components/HermesOpsIframeBridge'
import { HERMES_OPS_IFRAME_MIN_HEIGHT } from '../../HermesOps/constants'
import { buildHermesOpsEmbedUrl } from '../../HermesOps/embedUrl'
import { EVENT_HUB_SLOT_MIN_HEIGHT } from '../constants'
import { EmbedFrictionPanel } from './EmbedFrictionPanel'

export type HermesEventSlotProps = {
  daoAddress: string
  chainId: string
  /**
   * Resolved embed base from EventHubRenderer (module → mesh.embeds.hermes).
   * Never invent hosts here.
   */
  embedBase?: string
  deepLinkUrl?: string
  deepLinkOnly?: boolean
  boardSlug?: string
  eventId?: string | null
  /** Parent membership — if false, do not mount (OnlyMembers). */
  isMember: boolean
  isAdmin?: boolean
  address?: string
}

/**
 * Ops surface — member-only. Unmounts for non-members; deep-link fallback OK.
 * Never posts Hermes API keys, bounty JWT, or nsec.
 * Never invents DEFAULT hermes host URLs.
 */
export const HermesEventSlot = ({
  daoAddress,
  chainId,
  embedBase,
  deepLinkUrl = '',
  deepLinkOnly = true,
  boardSlug,
  eventId,
  isMember,
  isAdmin = false,
  address,
}: HermesEventSlotProps) => {
  const { t } = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [iframeHeight, setIframeHeight] = useState(EVENT_HUB_SLOT_MIN_HEIGHT)

  // Parent owns mesh/module resolution. Do not fall back to DEFAULT_* hosts.
  const base = useMemo(() => {
    if (!hasEmbedBase(embedBase)) return null
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
    if (!base) return ''
    const url = new URL(
      buildHermesOpsEmbedUrl({
        embedBase: base,
        daoAddress,
        chainId,
        defaultView: 'kanban',
      })
    )
    if (boardSlug) url.searchParams.set('board', boardSlug)
    if (eventId) url.searchParams.set('eventId', eventId)
    return url.toString()
  }, [base, daoAddress, chainId, boardSlug, eventId])

  const configuredDeepLink = deepLinkUrl?.trim() || ''

  // Hard gate: never mount Hermes for non-members / non-admins.
  // Parent showOps already applies hermesVisibility; keep fail-closed here.
  if (!isMember && !isAdmin) {
    return null
  }

  // Product default: deep-link only (no iframe). Prefer configured deepLinkUrl —
  // do not invent ops.terp.network hosts.
  // Intentionally do NOT treat empty origin as deep-link (that would hide EMBED_MISSING).
  if (deepLinkOnly) {
    const deepLinkFriction = describeEmbedFriction('DEEP_LINK_ONLY')
    return (
      <div className="flex flex-col gap-3 rounded-md border border-border-primary p-4">
        <p className="primary-text font-mono text-xs text-text-secondary">
          {deepLinkFriction.code}
        </p>
        <p className="secondary-text text-sm">
          {t(deepLinkFriction.messageKey, {
            defaultValue: deepLinkFriction.defaultMessage,
          })}
        </p>
        <p className="secondary-text text-sm">
          {t('info.eventHubHermesDeepLink', {
            defaultValue:
              'Hermes ops is available as a member deep-link for this event board.',
          })}
        </p>
        {configuredDeepLink ? (
          <ButtonLink href={configuredDeepLink} variant="primary">
            {t('button.openHermesOps', {
              defaultValue: 'Open Hermes Ops',
            })}
          </ButtonLink>
        ) : (
          <p className="secondary-text text-xs">
            {t('info.eventHubHermesNoLink', {
              defaultValue:
                'Set hermes deep-link URL in the Event Hub editor. Hosts are not invented.',
            })}
          </p>
        )}
      </div>
    )
  }

  // deepLinkOnly=false but no valid embed origin → EMBED_MISSING (not blank iframe).
  if (!hasEmbedBase(embedBase) || !embedOrigin) {
    return <EmbedFrictionPanel code="EMBED_MISSING" surface="hermes" />
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="secondary-text text-xs break-all">
        {t('info.eventHubOpsSurface', {
          defaultValue: 'Ops surface (terp-hermes-ops/v1) — members only',
        })}{' '}
        <span className="font-mono opacity-70">{src}</span>
      </p>
      <HermesOpsIframeBridge
        address={address}
        chainId={chainId}
        daoAddress={daoAddress}
        defaultView="kanban"
        embedOrigin={embedOrigin}
        iframeRef={iframeRef}
        isAdmin={isAdmin}
        isMember={isMember}
        onResize={(height) =>
          setIframeHeight(
            Math.max(
              EVENT_HUB_SLOT_MIN_HEIGHT,
              HERMES_OPS_IFRAME_MIN_HEIGHT,
              height
            )
          )
        }
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
        title={t('title.hermesOps', { defaultValue: 'Hermes Ops' })}
      />
    </div>
  )
}
