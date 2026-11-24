/** SEZS query core: one shared cache for every client read.
 *
 * Typed query keys, one
 * definition per read, indexer first with a chain fallback), without pulling
 * react-query into the static app. What it does:
 *  - in-flight dedupe: callers asking for the same key share one request
 *  - TTL cache: a fresh entry is served without a request (staleTime)
 *  - gc: entries nobody watches are dropped after gcTime
 *  - abort: the shared request is aborted only when every caller has aborted
 *  - subscribe: React hooks read the cache through useSyncExternalStore
 *
 * Framework-free so node --test can run it directly.
 */

export type QueryKey = readonly (string | number | boolean | null | undefined | Record<string, unknown>)[]

export type QueryContext = { signal: AbortSignal }

export type QueryDef<T> = {
  key: QueryKey
  fn: (ctx: QueryContext) => Promise<T>
  /** ms an entry stays fresh. Infinity for content-addressed data. */
  staleTime?: number
  /** ms an unwatched entry is kept before it is dropped. */
  gcTime?: number
}

export type QueryState<T> = {
  status: 'idle' | 'pending' | 'success' | 'error'
  data: T | undefined
  error: unknown
  updatedAt: number
  fetching: boolean
  /** Bumped by invalidate(); hooks refetch when it changes. */
  version: number
}

type Entry<T> = QueryState<T> & {
  promise: Promise<T> | null
  ctrl: AbortController | null
  waiters: number
  listeners: Set<() => void>
  gcTimer: ReturnType<typeof setTimeout> | null
  gcTime: number
}

export const DEFAULT_STALE_MS = 30_000
export const DEFAULT_GC_MS = 5 * 60_000

/** Stable key hash: object keys sorted, so { a, b } and { b, a } match. */
export const hashKey = (key: QueryKey): string =>
  JSON.stringify(key, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (v as Record<string, unknown>)[k]
            return acc
          }, {})
      : v,
  )

const abortError = () => {
  const e = new Error('The query was aborted.')
  e.name = 'AbortError'
  return e
}

export class QueryCache {
  private entries = new Map<string, Entry<unknown>>()
  private now: () => number
  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  private entry<T>(hash: string, gcTime = DEFAULT_GC_MS): Entry<T> {
    let e = this.entries.get(hash) as Entry<T> | undefined
    if (!e) {
      e = {
        status: 'idle',
        data: undefined,
        error: undefined,
        updatedAt: 0,
        fetching: false,
        version: 0,
        promise: null,
        ctrl: null,
        waiters: 0,
        listeners: new Set(),
        gcTimer: null,
        gcTime,
      }
      this.entries.set(hash, e as Entry<unknown>)
    }
    return e
  }

  private emit(e: Entry<unknown>) {
    for (const l of [...e.listeners]) l()
  }

  private scheduleGc(hash: string, e: Entry<unknown>) {
    if (e.gcTimer) clearTimeout(e.gcTimer)
    e.gcTimer = null
    if (e.listeners.size || e.promise || !Number.isFinite(e.gcTime)) return
    e.gcTimer = setTimeout(() => {
      if (!e.listeners.size && !e.promise) this.entries.delete(hash)
    }, e.gcTime)
    const t = e.gcTimer as unknown as { unref?: () => void }
    if (typeof t.unref === 'function') t.unref()
  }

  isFresh(def: Pick<QueryDef<unknown>, 'key' | 'staleTime'>): boolean {
    const e = this.entries.get(hashKey(def.key))
    if (!e || e.status !== 'success') return false
    const stale = def.staleTime ?? DEFAULT_STALE_MS
    return this.now() - e.updatedAt < stale
  }

  peek<T>(key: QueryKey): QueryState<T> | undefined {
    const e = this.entries.get(hashKey(key)) as Entry<T> | undefined
    if (!e) return undefined
    return { status: e.status, data: e.data, error: e.error, updatedAt: e.updatedAt, fetching: e.fetching, version: e.version }
  }

  /** Seed an entry from a superset read (e.g. event_view ⇒ event summary). */
  setData<T>(key: QueryKey, data: T) {
    const hash = hashKey(key)
    const e = this.entry<T>(hash)
    e.data = data
    e.error = undefined
    e.status = 'success'
    e.updatedAt = this.now()
    this.emit(e as Entry<unknown>)
    this.scheduleGc(hash, e as Entry<unknown>)
  }

  /** Mark entries stale (prefix match on the key tuple). Next read refetches. */
  invalidate(prefix: QueryKey) {
    const p = hashKey(prefix).slice(0, -1)
    for (const [hash, e] of this.entries) {
      if (hash === p + ']' || hash.startsWith(p + ',')) {
        e.updatedAt = 0
        e.version += 1
        this.emit(e)
      }
    }
  }

  subscribe(key: QueryKey, listener: () => void): () => void {
    const hash = hashKey(key)
    const e = this.entry(hash)
    e.listeners.add(listener)
    if (e.gcTimer) clearTimeout(e.gcTimer)
    e.gcTimer = null
    return () => {
      e.listeners.delete(listener)
      this.scheduleGc(hash, e)
    }
  }

  /**
   * Read through the cache. Fresh ⇒ cached value, no request. In flight ⇒
   * join the running request. Otherwise start one. `force` skips freshness.
   */
  fetch<T>(def: QueryDef<T>, opts: { signal?: AbortSignal; force?: boolean } = {}): Promise<T> {
    const hash = hashKey(def.key)
    const e = this.entry<T>(hash, def.gcTime ?? DEFAULT_GC_MS)
    e.gcTime = def.gcTime ?? e.gcTime
    if (!opts.force && e.status === 'success' && this.now() - e.updatedAt < (def.staleTime ?? DEFAULT_STALE_MS)) {
      return Promise.resolve(e.data as T)
    }
    if (opts.signal?.aborted) return Promise.reject(abortError())
    if (!e.promise || e.ctrl?.signal.aborted) {
      const ctrl = new AbortController()
      e.ctrl = ctrl
      e.fetching = true
      e.waiters = 0
      if (e.status === 'idle' || e.status === 'error') e.status = 'pending'
      const startedAt = this.now()
      const p: Promise<T> = def
        .fn({ signal: ctrl.signal })
        .then(
          (data) => {
            if (!ctrl.signal.aborted) {
              e.data = data
              e.error = undefined
              e.status = 'success'
              e.updatedAt = startedAt
            }
            return data
          },
          (err: unknown) => {
            if (!ctrl.signal.aborted) {
              e.error = err
              // Keep earlier good data on a failed refetch.
              e.status = e.data !== undefined ? 'success' : 'error'
            }
            throw err
          },
        )
        .finally(() => {
          if (e.promise !== p) return
          e.promise = null
          e.ctrl = null
          e.fetching = false
          e.waiters = 0
          if (ctrl.signal.aborted && e.status === 'pending') e.status = e.data !== undefined ? 'success' : 'idle'
          this.emit(e as Entry<unknown>)
          this.scheduleGc(hash, e as Entry<unknown>)
        })
      // Callers attach their own handlers; this one only keeps the rejection handled.
      p.catch(() => {})
      e.promise = p
      this.emit(e as Entry<unknown>)
    }
    const shared = e.promise as Promise<T>
    e.waiters += 1
    if (!opts.signal) return shared
    const signal = opts.signal
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        e.waiters -= 1
        if (e.waiters <= 0 && e.ctrl && e.promise === shared) e.ctrl.abort()
        reject(abortError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
      shared.then(
        (v) => {
          signal.removeEventListener('abort', onAbort)
          resolve(v)
        },
        (err) => {
          signal.removeEventListener('abort', onAbort)
          reject(err)
        },
      )
    })
  }

  /** Number of cached keys. For diagnostics only. */
  get size() {
    return this.entries.size
  }
}

/** The app-wide cache. One per tab; static export has no server cache. */
export const queryCache = new QueryCache()

export const isAbortError = (e: unknown) => e instanceof Error && e.name === 'AbortError'

/**
 * Run independent reads in parallel and keep partial results: one failing
 * read does not sink the others (Promise.allSettled shaped for callers).
 */
export async function settleAll<T>(tasks: (() => Promise<T>)[]): Promise<(T | null)[]> {
  const out = await Promise.allSettled(tasks.map((t) => t()))
  return out.map((r) => (r.status === 'fulfilled' ? r.value : null))
}
