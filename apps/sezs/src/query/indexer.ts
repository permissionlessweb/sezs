/** Indexer-first reads with a typed chain fallback.
 *
 * Same URL shape as @dao-dao/state queryIndexer:
 *   {base}/{chainId}/contract/{address}/{formula}?{args}
 *
 * Today no indexer serves morocco-1 SEZS contracts: indexer.daodao.zone
 * answers "Invalid chain ID" for morocco-1, and Argus is not running on our
 * hosts. So the indexer is off unless NEXT_PUBLIC_SEZS_INDEXER is set, and
 * the LCD smart query is the production path. When an Argus instance with
 * the SEZS formulas is live, set the env var; nothing else changes.
 *
 * A failing indexer is skipped for a cool-down so a dead indexer costs one
 * request per window, not one per read.
 */
import type { FetchLike } from './lcd.ts'

export type IndexerConfig = { base: string; chainId: string }

export const INDEXER_COOLDOWN_MS = 60_000

export const indexerFromEnv = (chainId: string): IndexerConfig | null => {
  const base =
    typeof process !== 'undefined' && process.env ? String(process.env.NEXT_PUBLIC_SEZS_INDEXER || '').trim() : ''
  if (!base || !chainId) return null
  try {
    const u = new URL(base)
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) return null
  } catch {
    return null
  }
  return { base: base.replace(/\/$/, ''), chainId }
}

export class IndexerMiss extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Indexer returned HTTP ${status}`)
    this.name = 'IndexerMiss'
    this.status = status
  }
}

/** Tracks indexer health per base URL. */
export class IndexerHealth {
  private downUntil = new Map<string, number>()
  private now: () => number
  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }
  isDown(base: string) {
    return (this.downUntil.get(base) || 0) > this.now()
  }
  markDown(base: string, ms = INDEXER_COOLDOWN_MS) {
    this.downUntil.set(base, this.now() + ms)
  }
  markUp(base: string) {
    this.downUntil.delete(base)
  }
}

export const indexerHealth = new IndexerHealth()

export async function queryIndexer<T>(
  cfg: IndexerConfig,
  address: string,
  formula: string,
  args: Record<string, string | number> | undefined,
  opts: { signal?: AbortSignal; fetch?: FetchLike } = {},
): Promise<T> {
  const f = opts.fetch || ((i, init) => fetch(i, init))
  const qs = args && Object.keys(args).length ? '?' + new URLSearchParams(Object.entries(args).map(([k, v]) => [k, String(v)])) : ''
  const url = `${cfg.base}/${encodeURIComponent(cfg.chainId)}/contract/${encodeURIComponent(address)}/${formula}${qs}`
  const r = await f(url, { credentials: 'omit', cache: 'no-store', signal: opts.signal })
  if (!r.ok) throw new IndexerMiss(r.status)
  const text = await r.text()
  // DAO DAO / Argus answer 204 or an empty body for "no value yet".
  if (!text) throw new IndexerMiss(204)
  return JSON.parse(text) as T
}

export type Sourced<T> = { data: T; source: 'indexer' | 'chain' }

/**
 * Indexer first, chain second. The indexer answer must pass `accept`
 * (a type guard) or the chain is asked. Aborts are passed through, never
 * treated as an indexer failure.
 */
export async function indexerFirst<T>(args: {
  indexer: IndexerConfig | null
  fromIndexer: (cfg: IndexerConfig, signal?: AbortSignal) => Promise<unknown>
  accept: (v: unknown) => v is T
  fromChain: (signal?: AbortSignal) => Promise<T>
  signal?: AbortSignal
  health?: IndexerHealth
}): Promise<Sourced<T>> {
  const health = args.health || indexerHealth
  const cfg = args.indexer
  if (cfg && !health.isDown(cfg.base)) {
    try {
      const v = await args.fromIndexer(cfg, args.signal)
      if (args.accept(v)) {
        health.markUp(cfg.base)
        return { data: v, source: 'indexer' }
      }
      // Reachable but no usable value: not "down", just fall through.
    } catch (e) {
      if (args.signal?.aborted) throw e
      // 404/204 means the formula has no value for this contract; 5xx and
      // network errors mean the indexer is unhealthy.
      if (!(e instanceof IndexerMiss) || e.status >= 500) health.markDown(cfg.base)
    }
  }
  return { data: await args.fromChain(args.signal), source: 'chain' }
}
