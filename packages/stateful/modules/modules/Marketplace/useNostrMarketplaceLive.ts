import { useEffect, useMemo, useState } from 'react'

import {
  buildMarketplaceNostrFilters,
  subscribeNostr,
  type NostrEvent,
} from '@dao-dao/utils'

export type NostrMarketplaceLiveStatus =
  | 'off'
  | 'connecting'
  | 'live'
  | 'idle'
  | 'error'

/**
 * M7: Progressive Nostr subscribe for marketplace kinds.
 * Subscribe-only; never auto-executes PurchaseIntent; never blocks UI.
 */
export function useNostrMarketplaceLive({
  relays,
  dao,
  enabled = true,
}: {
  relays?: string[]
  dao?: string
  enabled?: boolean
}): {
  status: NostrMarketplaceLiveStatus
  eventCount: number
  lastError?: string
  /** Distinct event ids seen this session */
  eventIds: string[]
} {
  const [status, setStatus] = useState<NostrMarketplaceLiveStatus>('off')
  const [eventIds, setEventIds] = useState<string[]>([])
  const [lastError, setLastError] = useState<string | undefined>()

  const relayKey = (relays ?? []).join('|')
  const filters = useMemo(
    () =>
      buildMarketplaceNostrFilters({
        dao,
        mode: 'all',
        limit: 50,
      }),
    [dao]
  )

  useEffect(() => {
    if (!enabled || !relays?.length) {
      setStatus('off')
      return
    }

    setStatus('connecting')
    setLastError(undefined)
    const seen = new Set<string>()

    const sub = subscribeNostr({
      relays,
      filters,
      subPrefix: 'mkt-live',
      onStatus: (s) => {
        if (s === 'open') setStatus('live')
        if (s === 'connecting') setStatus('connecting')
        if (s === 'error') setStatus('error')
      },
      onEvent: (event: NostrEvent) => {
        if (seen.has(event.id)) return
        seen.add(event.id)
        setEventIds((prev) => {
          if (prev.includes(event.id)) return prev
          return [...prev, event.id]
        })
        setStatus('live')
      },
      onEose: () => {
        setStatus((prev) => (prev === 'connecting' ? 'idle' : prev))
      },
      onError: (err) => {
        setLastError(err.message)
        // Soft error: stay live if we already have events
        setStatus((prev) =>
          prev === 'live' || seen.size > 0 ? prev : 'error'
        )
      },
    })

    return () => {
      sub.close()
    }
  }, [enabled, relayKey, filters, relays])

  return {
    status,
    eventCount: eventIds.length,
    lastError,
    eventIds,
  }
}
