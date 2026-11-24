import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { queryCache } from '../query/core'
import { readBoot } from './boot'
import { EventSummary, eventSummaryQuery } from './client'

const NONE: string[] = []

export type EventSummariesOpts = {
  /** When false (the default), only the selected event's label is read, and
   *  it joins the page's EventView. Other contracts are fetched when true
   *  (picker open, hover, or focus). */
  others?: boolean
}

/**
 * Picker labels for several event contracts, cached for STALE.summary.
 * The selected contract's label is read from its EventView, the same
 * request useEvent makes, so it costs nothing extra. Other labels stay
 * unloaded until `others` is set, so a page load is one LCD request.
 */
export function useEventSummaries(contracts: string[], opts: EventSummariesOpts = {}): EventSummary[] {
  const list = contracts.length ? contracts : NONE
  const boot = typeof window !== 'undefined' ? readBoot() : null
  const chainId = boot?.chainId || ''
  const lcd = boot?.lcd || ''
  const active = boot?.contract || ''
  const others = !!opts.others
  const defs = useMemo(
    () => (lcd ? list.map((c) => eventSummaryQuery({ chainId, lcd }, c, { viaView: c === active })) : []),
    [list, chainId, lcd, active],
  )

  const subscribe = useMemo(
    () => (cb: () => void) => {
      const offs = defs.map((d) => queryCache.subscribe(d.key, cb))
      return () => offs.forEach((off) => off())
    },
    [defs],
  )
  // Primitive snapshot so React can compare it cheaply.
  const snap = useSyncExternalStore(
    subscribe,
    () => defs.map((d) => queryCache.peek<EventSummary>(d.key)?.updatedAt || 0).join(','),
    () => '',
  )

  useEffect(() => {
    if (!defs.length) return
    const ctrl = new AbortController()
    for (let i = 0; i < defs.length; i++) {
      if (list[i] === active || others) queryCache.fetch(defs[i], { signal: ctrl.signal }).catch(() => {})
    }
    return () => ctrl.abort()
  }, [defs, list, active, others])

  return useMemo(
    () =>
      list.map((c, i) => (defs[i] && queryCache.peek<EventSummary>(defs[i].key)?.data) || { contract: c, name: '', startsAt: '' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, list, defs],
  )
}
