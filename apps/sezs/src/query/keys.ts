/** Typed query keys. Every client read in SEZS gets its key here, so
 * invalidation by prefix is exact (e.g. sezsKeys.event.all(chainId)).
 * Query key shape:
 * [app, domain, chainId, kind, ...args]. */

export const sezsKeys = {
  all: ['sezs'] as const,
  event: {
    all: (chainId: string) => ['sezs', 'event', chainId] as const,
    /** cw_event_manifold { event_view: {} } (or the fan-out on older code). */
    view: (chainId: string, contract: string) => ['sezs', 'event', chainId, 'view', contract] as const,
    /** View plus NIP-52 metadata resolution. */
    resolved: (chainId: string, contract: string) => ['sezs', 'event', chainId, 'resolved', contract] as const,
    /** { event_info: {} } name/start only, for the event picker. */
    summary: (chainId: string, contract: string) => ['sezs', 'event', chainId, 'summary', contract] as const,
  },
  /** Metadata documents. With a content hash they are immutable. */
  metadata: (url: string, hash: string) => ['sezs', 'metadata', url, hash] as const,
  raffle: {
    all: (chainId: string, contract: string) => ['sezs', 'raffle', chainId, contract] as const,
    listings: (chainId: string, contract: string) => ['sezs', 'raffle', chainId, contract, 'listings'] as const,
    mine: (chainId: string, contract: string, owner: string) =>
      ['sezs', 'raffle', chainId, contract, 'mine', owner] as const,
  },
  session: {
    all: ['sezs', 'session'] as const,
    me: (contract: string) => ['sezs', 'session', 'me', contract] as const,
  },
} as const

/** Freshness per data class (ms). */
export const STALE = {
  /** Event record: admins edit it rarely; 30s keeps navigation free. */
  event: 30_000,
  /** Picker labels: name and date. */
  summary: 5 * 60_000,
  /** Hash-checked metadata never changes for the same hash. */
  metadataHashed: Number.POSITIVE_INFINITY,
  metadataUnhashed: 30_000,
  raffle: 15_000,
  /** Role lookups are dedupe-only: always ask again once settled. */
  session: 0,
} as const
