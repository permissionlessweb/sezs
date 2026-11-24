import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { MarkdownRenderer, SmallLoader } from '@dao-dao/stateless'
import {
  detectPledgeDocKind,
  fetchPledgeDocument,
  PLEDGE_DEFAULT_IPFS_GATEWAY,
  resolvePledgeDocUrl,
} from '@dao-dao/utils'

import { formatLocalRange, type CalendarPanelEvent } from './calendarGrid'

export type CalendarEventDetailProps = {
  event: CalendarPanelEvent | null
  onClose?: () => void
  calendarContract?: string
  /** IPFS gateway base (defaults to terp public gateway). */
  ipfsGateway?: string
}

/**
 * Calendar tab event detail (CAL-UX-2 + CAL-NOSTR-4 CID body).
 * Escape closes when onClose provided.
 * CID body: soft-fail fetch via same gateway helpers as TrustlessPledge.
 */
export const CalendarEventDetail = ({
  event,
  onClose,
  calendarContract,
  ipfsGateway = PLEDGE_DEFAULT_IPFS_GATEWAY,
}: CalendarEventDetailProps) => {
  const { t } = useTranslation()

  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const resolvedCid = useMemo(() => {
    if (!event?.cid || event.cid.startsWith('lab:')) return null
    return resolvePledgeDocUrl(event.cid, ipfsGateway)
  }, [event?.cid, ipfsGateway])

  const cidBody = useQuery({
    queryKey: ['calendar-cid-body', resolvedCid?.url || ''],
    queryFn: () => fetchPledgeDocument(resolvedCid!.url),
    enabled: !!resolvedCid?.url,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  if (!event) {
    return (
      <div className="rounded-md border border-dashed border-border-primary px-4 py-6">
        <p className="secondary-text text-sm">
          {t('info.calendarSelectEvent', {
            defaultValue:
              'Select an event from the grid or schedule list to see details.',
          })}
        </p>
      </div>
    )
  }

  const times = formatLocalRange(event.start, event.end)
  const remoteText = cidBody.data?.text
  const remoteKind =
    cidBody.data?.kind ||
    (remoteText ? detectPledgeDocKind(remoteText) : undefined)
  const showRemoteBody = !!remoteText && !cidBody.isError

  return (
    <div
      aria-live="polite"
      className="flex flex-col gap-3 rounded-md border border-border-primary bg-background-base p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="primary-text text-text-body">{event.title}</p>
          <p className="secondary-text font-mono text-xs break-all">
            {t('info.eventId', { defaultValue: 'Event id' })}: {String(event.id)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {event.access === 'private' ? (
            <span className="caption-text text-text-tertiary rounded-md border border-border-secondary bg-background-tertiary px-1.5 py-0.5">
              {t('info.private', { defaultValue: 'private' })}
            </span>
          ) : (
            <span className="caption-text text-text-tertiary rounded-md border border-border-secondary bg-background-tertiary px-1.5 py-0.5">
              {t('info.public', { defaultValue: 'public' })}
            </span>
          )}
          {onClose ? (
            <button
              aria-label={t('button.close', { defaultValue: 'Close' })}
              className="rounded-md border border-border-primary px-2 py-0.5 text-xs text-text-secondary hover:bg-background-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-interactive-focus"
              onClick={onClose}
              type="button"
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        <p className="secondary-text text-sm">{times.local}</p>
        <p className="caption-text text-text-tertiary font-mono">{times.utc}</p>
      </div>

      {event.description ? (
        <MarkdownRenderer className="text-sm" markdown={event.description} />
      ) : null}

      {event.cid ? (
        <div className="flex flex-col gap-1">
          <p className="caption-text text-text-tertiary">
            {t('info.calendarCid', {
              defaultValue: 'Off-chain content (CID)',
            })}
          </p>
          <p className="secondary-text font-mono text-xs break-all">
            {event.cid}
          </p>
          {cidBody.isLoading || cidBody.isFetching ? (
            <div className="flex items-center gap-2 py-2">
              <SmallLoader size={16} />
              <p className="caption-text text-text-tertiary">
                {t('info.loadingCidBody', {
                  defaultValue: 'Loading off-chain body…',
                })}
              </p>
            </div>
          ) : null}
          {showRemoteBody ? (
            // Always route through MarkdownRenderer (rehypeSanitize) — never raw HTML.
            <MarkdownRenderer
              className="text-sm"
              markdown={
                remoteKind === 'html'
                  ? remoteText!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
                  : remoteText!
              }
            />
          ) : null}
          {cidBody.isError ? (
            <p className="caption-text text-text-tertiary">
              {t('info.calendarCidBodyUnavailable', {
                defaultValue:
                  'Off-chain body could not be loaded (gateway soft-fail). CID pointer still shown.',
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {calendarContract ? (
        <p className="caption-text text-text-tertiary font-mono break-all">
          calendar: {calendarContract}
        </p>
      ) : null}
    </div>
  )
}
