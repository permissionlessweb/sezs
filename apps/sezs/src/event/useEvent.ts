import { useRouter } from 'next/router'
import { useMemo } from 'react'
import { useQuery } from '../query/useQuery'
import { ResolvedEvent } from './api'
import { readBoot } from './boot'
import { EventLoad, EventSource, eventLoadQuery } from './client'

export type EventState = {
  loading: boolean
  source: EventSource
  data: ResolvedEvent | null
  note: string
}

const idle: EventState = { loading: true, source: 'none', data: null, note: '' }

/**
 * The event record for the selected contract. Every caller (Frame, the page,
 * modals) shares one cached read keyed by chain + contract, so a page load
 * costs one event_view and client navigation inside the stale window costs
 * none.
 */
export function useEvent(): EventState {
  const router = useRouter()
  const qContract = typeof router.query.contract === 'string' ? router.query.contract : ''
  const isClient = typeof window !== 'undefined'
  // readBoot() reads the URL and the picker's sessionStorage choice.
  const boot = useMemo(
    () => (isClient ? readBoot() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isClient, qContract, router.asPath],
  )
  const def = useMemo(
    () => (boot ? eventLoadQuery(boot, window.location.origin) : null),
    // Key is what matters; origin is fixed per tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boot?.chainId, boot?.contract, boot?.lcd],
  )
  const q = useQuery<EventLoad>(def)
  return useMemo((): EventState => {
    if (q.data) return { loading: false, source: q.data.source, data: q.data.data, note: q.data.note }
    if (q.status === 'error') {
      const e = q.error
      return {
        loading: false,
        source: 'none',
        data: null,
        note: e instanceof Error ? e.message : 'The event record could not be read.',
      }
    }
    return idle
  }, [q.data, q.status, q.error])
}
