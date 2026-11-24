/** React binding for the shared query cache (useSyncExternalStore). */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { hashKey, isAbortError, queryCache, type QueryDef, type QueryState } from './core'

const IDLE: QueryState<never> = { status: 'idle', data: undefined, error: undefined, updatedAt: 0, fetching: false, version: 0 }

export type UseQueryResult<T> = QueryState<T> & { refetch: () => Promise<T | undefined> }

const same = (a: QueryState<unknown>, b: QueryState<unknown>) =>
  a.status === b.status &&
  a.data === b.data &&
  a.error === b.error &&
  a.updatedAt === b.updatedAt &&
  a.fetching === b.fetching &&
  a.version === b.version

/**
 * Watch one query. Every component with the same key shares one request and
 * one cached value. Fetches on mount or key change when the entry is not
 * fresh, and again after invalidate(). No retry loop on error. Pass null to
 * disable (e.g. no contract configured).
 */
export function useQuery<T>(def: QueryDef<T> | null): UseQueryResult<T> {
  const hash = def ? hashKey(def.key) : ''
  const defRef = useRef(def)
  defRef.current = def

  const subscribe = useCallback(
    (cb: () => void) => (defRef.current ? queryCache.subscribe(defRef.current.key, cb) : () => {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hash],
  )
  const snapRef = useRef<QueryState<T>>(IDLE as QueryState<T>)
  const getSnapshot = useCallback((): QueryState<T> => {
    const d = defRef.current
    const s = (d && queryCache.peek<T>(d.key)) || (IDLE as QueryState<T>)
    if (same(s, snapRef.current)) return snapRef.current
    snapRef.current = s
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash])
  const state = useSyncExternalStore(subscribe, getSnapshot, () => IDLE as QueryState<T>)

  // One abort controller per key: aborts only on unmount or key change.
  const ctrlRef = useRef<AbortController | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    return () => ctrl.abort()
  }, [hash])

  useEffect(() => {
    const d = defRef.current
    const ctrl = ctrlRef.current
    if (!d || !ctrl || queryCache.isFresh(d)) return
    queryCache.fetch(d, { signal: ctrl.signal }).catch((e) => {
      if (!isAbortError(e)) {
        /* the error is on the entry; read state.error */
      }
    })
  }, [hash, state.version])

  const refetch = useCallback(async () => {
    const d = defRef.current
    if (!d) return undefined
    return queryCache.fetch(d, { force: true })
  }, [])

  return useMemo(() => ({ ...state, refetch }), [state, refetch])
}
