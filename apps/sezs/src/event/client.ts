/** Event manifold loader.
 *
 * Generated CosmJS clients live in api/ts/cw-event-manifold/ (see make codegen).
 * This file stays a lightweight LCD fetch + EventView normalizer so the
 * Next pages do not need a SigningCosmWasmClient in the browser. Query
 * bodies match the generated QueryMsg ({ event_view: {} } and the
 * older fan-out queries). Remaining hand-written pieces: LCD fetch,
 * EventView camelCase normalize, NIP-52 metadata resolve, boot, and the
 * local fixture fallback.
 */
import { API_VERSION, EventManifold, ResolvedEvent, SCHEMA } from './api'
import { MetadataFetch, resolveEventMetadata } from './metadata'
import { ChainBoot, readBoot } from './boot'
import { FIXTURE } from './fixture'
import { queryCache, settleAll, type QueryDef } from '../query/core'
import { isUnknownQuery, lcdAllowed, lcdSmart } from '../query/lcd'
import { indexerFirst, indexerFromEnv, queryIndexer } from '../query/indexer'
import { STALE, sezsKeys } from '../query/keys'

export type EventSource = 'chain' | 'fixture' | 'none'

export type EventLoad = {
  source: EventSource
  data: ResolvedEvent | null
  note: string
}

/** Contract address from boot (query, inject, or env). Empty ⇒ no chain query. */
export const eventContract = () => readBoot().contract

const fixtureOn = () =>
  (typeof process !== 'undefined' ? String(process.env.NEXT_PUBLIC_SEZS_EVENT_FIXTURE || '').trim() : '') !== '0'

/**
 * Read the event manifold. Prefers EventView on a configured contract + LCD.
 * Instantiation is purely from the contract address and chain config.
 * Mainnet LCDs are refused. The local fixture is only used when no contract
 * is configured (so the lab dev server still has something to render).
 */
export async function loadEvent(opts: { signal?: AbortSignal } = {}): Promise<EventLoad> {
  const boot = readBoot()
  const def = eventLoadQuery(boot, typeof window !== 'undefined' ? window.location.origin : undefined)
  return queryCache.fetch(def, { signal: opts.signal })
}

/** Plain-data shape check for an EventView answer (indexer or chain). */
const isEventViewRaw = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !!(v as { event?: unknown }).event && typeof (v as { event?: unknown }).event === 'object'

/** Raw EventView, indexer first. Older code without event_view uses the fan-out. */
export const eventViewQuery = (boot: Pick<ChainBoot, 'chainId' | 'lcd'>, contract: string): QueryDef<EventManifold> => ({
  key: sezsKeys.event.view(boot.chainId, contract),
  staleTime: STALE.event,
  fn: async ({ signal }) => {
    const got = await indexerFirst({
      indexer: indexerFromEnv(boot.chainId),
      fromIndexer: (cfg, sig) => queryIndexer(cfg, contract, 'sezs/eventView', undefined, { signal: sig }),
      accept: isEventViewRaw,
      fromChain: (sig) => queryChain(boot.lcd, contract, sig),
      signal,
    })
    return normalize(got.data)
  },
})

/** Metadata bytes through the cache. Hash-pinned documents are kept for the tab's life. */
const cachedMetadataFetch =
  (hash: string, signal: AbortSignal): MetadataFetch =>
  (url) =>
    queryCache.fetch(
      {
        key: sezsKeys.metadata(url, hash),
        staleTime: hash.length === 64 ? STALE.metadataHashed : STALE.metadataUnhashed,
        fn: async ({ signal: s }) => {
          const r = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: s })
          const bytes = new Uint8Array(await r.arrayBuffer())
          return { ok: r.ok, status: r.status, bytes, text: new TextDecoder().decode(bytes) }
        },
      },
      { signal },
    )

/** The page-level read: EventView plus metadata, as an EventLoad. */
export const eventLoadQuery = (boot: ChainBoot, origin?: string): QueryDef<EventLoad> => ({
  key: sezsKeys.event.resolved(boot.chainId || '-', boot.contract || '-'),
  staleTime: STALE.event,
  fn: async ({ signal }) => {
    const addr = boot.contract
    const lcd = boot.lcd
    if (addr && lcd) {
      if (!lcdAllowed(lcd)) {
        return { source: 'none', data: null, note: 'The configured LCD is not on the allowlist.' }
      }
      try {
        const data = await queryCache.fetch(eventViewQuery(boot, addr), { signal })
        // The view is a superset of event_info: seed the picker label for free.
        queryCache.setData<EventSummary>(sezsKeys.event.summary(boot.chainId, addr), {
          contract: addr,
          name: data.event.name,
          startsAt: data.event.start,
        })
        const hash = String(data.event.metadataHash || '').toLowerCase()
        const resolved = await resolveEventMetadata(data, { origin, fetch: cachedMetadataFetch(hash, signal) })
        // Metadata fetch/hash failures are logged in resolveEventMetadata, not shown in the UI.
        return { source: 'chain', data: resolved, note: '' }
      } catch (e) {
        if (signal.aborted) throw e
        return {
          source: 'none',
          data: null,
          note: `The event contract could not be read (${e instanceof Error ? e.message : 'error'}).`,
        }
      }
    }
    if (fixtureOn()) {
      const resolved = await resolveEventMetadata(FIXTURE, { origin })
      return {
        source: 'fixture',
        data: resolved,
        note: 'Showing the local event record until a contract is configured.',
      }
    }
    return {
      source: 'none',
      data: null,
      note: 'No event contract is configured, so there is nothing to show yet.',
    }
  },
})

async function queryChain(lcd: string, addr: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const q = <T = Record<string, unknown>>(msg: object) => lcdSmart<T>(lcd, addr, msg, { signal })
  try {
    return await q({ event_view: {} })
  } catch (e) {
    // Only older code without EventView gets the fan-out. A network error or
    // a missing contract fails fast instead of costing 11 more requests.
    if (signal?.aborted || !isUnknownQuery(e, 'event_view')) throw e
    // Older deployments without EventView still answer the fan-out queries.
    // They are independent, so ask them in parallel (was 11 sequential calls).
    type Items = { items?: unknown[] }
    const [info, venue, lineup, timeline, sponsors, tiers, raffles, roles] = await Promise.all([
      q({ event_info: {} }),
      q({ venue: {} }),
      q<Items>({ lineup: { limit: 100 } }),
      q<Items>({ timeline: { limit: 100 } }),
      q<Items>({ sponsors: { limit: 100 } }),
      q<Items>({ tiers: {} }),
      q<Items>({ raffles: { limit: 100 } }),
      q({ roles: {} }),
    ])
    const [faq, consume, roots] = await settleAll<Record<string, unknown>>([
      () => q({ faq: {} }),
      () => q({ consume_config: {} }),
      () => q({ roots: {} }),
    ])
    return {
      event: info,
      venue,
      lineup: lineup.items || [],
      timeline: timeline.items || [],
      sponsors: sponsors.items || [],
      tiers: tiers.items || [],
      raffles: raffles.items || [],
      faq: (faq as Items | null)?.items || [],
      roles,
      consume: consume || {},
      roots: (roots as Items | null)?.items || [],
    }
  }
}

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)
const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : Number(v) || d)
const ts = (v: unknown) => {
  const iso = (ms: number) => {
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString()
  }
  if (v && typeof v === 'object' && 'seconds' in (v as object)) {
    return iso(Number((v as { seconds: string | number }).seconds) * 1000)
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return iso(v > 1e15 ? v / 1e6 : v > 1e12 ? v : v * 1000)
  }
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) {
      return iso(v.length >= 18 ? Number(v) / 1e6 : v.length >= 13 ? Number(v) : Number(v) * 1000)
    }
    return iso(Date.parse(v)) || v
  }
  return ''
}
const hex = (v: unknown) => {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && 'data' in (v as object)) return str((v as { data: unknown }).data)
  return ''
}

const allowedRail = (r: string): r is EventManifold['tiers'][0]['rails'][number] =>
  r === 'zec' || r === 'penumbra'

/** Accept snake_case chain JSON or the camelCase fixture. */
export function normalize(raw: Record<string, unknown>): EventManifold {
  const ev = (raw.event || raw) as Record<string, unknown>
  const venue = (raw.venue || {}) as Record<string, unknown>
  const roles = (raw.roles || {}) as Record<string, unknown>
  const consume = (raw.consume || raw.consume_config || {}) as Record<string, unknown>
  const tagsRaw = ev.tags
  const tags = Array.isArray(tagsRaw) ? tagsRaw.map((t) => String(t)) : []
  return {
    api: API_VERSION,
    schema: str(raw.schema || ev.schema, SCHEMA),
    event: {
      api: API_VERSION,
      schema: str(ev.schema, SCHEMA),
      cwAve: str(ev.cw_ave || ev.cwAve) || undefined,
      id: str(ev.id) || undefined,
      name: str(ev.name),
      status: (str(ev.status, 'announced') as EventManifold['event']['status']),
      start: ts(ev.start),
      end: ts(ev.end),
      timezone: str(ev.timezone, 'UTC'),
      domain: str(ev.domain) || undefined,
      doorAuthPubkey: hex(ev.door_auth_pubkey || ev.doorAuthPubkey) || undefined,
      kind: ev.kind != null ? num(ev.kind, 31923) : 31923,
      dTag: str(ev.d_tag || ev.dTag || ev.id) || undefined,
      summary: str(ev.summary) || undefined,
      content: str(ev.content) || undefined,
      location: str(ev.location) || undefined,
      geohash: str(ev.geohash) || undefined,
      image: str(ev.image) || undefined,
      tags,
      metadataUri: str(ev.metadata_uri || ev.metadataUri) || undefined,
      metadataHash: hex(ev.metadata_hash || ev.metadataHash) || undefined,
    },
    venue: {
      api: API_VERSION,
      revealed: venue.revealed === true,
      label: str(venue.label) || undefined,
      note: str(venue.note, 'Location is shared with ticket holders.'),
    },
    lineup: ((raw.lineup as unknown[]) || []).map((s, i) => {
      const x = s as Record<string, unknown>
      return {
        id: str(x.id, `slot-${i}`),
        index: num(x.index, i + 1),
        role: (str(x.role, 'other').toLowerCase() as EventManifold['lineup'][0]['role']),
        handle: str(x.handle, `Artist ${String(i + 1).padStart(2, '0')}`),
        ref: str(x.reference || x.ref) || undefined,
        start: ts(x.start),
        durationMin: num(x.duration_min ?? x.durationMin, 45),
        lane: str(x.lane, 'floor'),
      }
    }),
    timeline: ((raw.timeline as unknown[]) || []).map((s, i) => {
      const x = s as Record<string, unknown>
      return {
        id: str(x.id, `tl-${i}`),
        start: ts(x.start),
        end: ts(x.end) || undefined,
        label: str(x.label),
        lane: str(x.lane) || undefined,
        slotId: str(x.slot_id || x.slotId) || undefined,
        untimed: x.untimed === true,
      }
    }),
    sponsors: ((raw.sponsors as unknown[]) || []).map((s, i) => {
      const x = s as Record<string, unknown>
      return {
        id: str(x.id, `sp-${i}`),
        handle: str(x.handle || x.name, `Sponsor ${String(i + 1).padStart(2, '0')}`),
        note: str(x.note) || undefined,
        href: str(x.href || x.url) || undefined,
        logo: str(x.logo) || undefined,
        tier: str(x.tier) || undefined,
        example: x.example === true ? true : undefined,
      }
    }),
    tiers: ((raw.tiers as unknown[]) || []).map((s, i) => {
      const x = s as Record<string, unknown>
      const bps: EventManifold['tiers'][0]['discountsBps'] = {}
      const rawBps = x.discounts_bps || x.discountsBps
      if (Array.isArray(rawBps)) {
        for (const pair of rawBps) {
          if (Array.isArray(pair) && pair.length === 2) {
            const rail = String(pair[0]).toLowerCase()
            if (allowedRail(rail)) bps[rail] = Number(pair[1]) || 0
          }
        }
      } else if (rawBps && typeof rawBps === 'object') {
        for (const [k, v] of Object.entries(rawBps as Record<string, number>)) {
          const rail = k.toLowerCase()
          if (allowedRail(rail)) bps[rail] = Number(v) || 0
        }
      }
      const rails = ((x.rails as unknown[]) || ['zec', 'penumbra'])
        .map((r) => String(r).toLowerCase())
        .filter(allowedRail)
      return {
        id: str(x.id, `tier-${i}`),
        label: str(x.label, 'Admission'),
        guestWeight: x.guest_weight != null ? num(x.guest_weight) : undefined,
        listCents: num(x.list_cents ?? x.listCents, 4000),
        discountsBps: bps,
        supply: num(x.supply, 0),
        sold: num(x.sold, 0),
        rails,
      }
    }),
    raffles: ((raw.raffles as unknown[]) || []).map((s, i) => {
      const x = s as Record<string, unknown>
      const d = (x.draw || null) as Record<string, unknown> | null
      return {
        id: str(x.id, `rf-${i}`),
        title: str(x.title, `Prize ${String(i + 1).padStart(2, '0')}`),
        note: str(x.note) || undefined,
        entries: num(x.entries, 0),
        status: (str(x.status, 'open') as EventManifold['raffles'][0]['status']),
        draw: d
          ? {
              jobId: str(d.job_id || d.jobId),
              winnerIndex: d.winner_index != null ? num(d.winner_index ?? d.winnerIndex) : undefined,
              proofHref: str(d.proof_href || d.proofHref) || undefined,
              oracle: (str(d.oracle, 'pending') as 'nois' | 'pending' | 'none'),
              randomness: str(d.randomness) || undefined,
            }
          : undefined,
      }
    }),
    faq: ((raw.faq as unknown[]) || []).map((s, i) => {
      const x = s as Record<string, unknown>
      return {
        id: str(x.id, `q-${i}`),
        question: str(x.question || x.q),
        answer: str(x.answer || x.a),
      }
    }),
    roles: {
      curators: Array.isArray(roles.curators) ? (roles.curators as string[]) : [],
      coordinators: Array.isArray(roles.coordinators) ? (roles.coordinators as string[]) : [],
      ushers: Array.isArray(roles.ushers) ? (roles.ushers as string[]) : [],
      coordinatorsGroup: str(roles.coordinators_group || roles.coordinatorsGroup) || undefined,
      usherGroup: str(roles.usher_group || roles.usherGroup) || undefined,
      serviceKey: str(roles.service_key || roles.serviceKey) || undefined,
    },
    consume: {
      api: num(consume.api, API_VERSION),
      schema: str(consume.schema, SCHEMA),
      zkid: num(consume.zkid, 0),
      eventIdFp: hex(consume.event_id_fp || consume.eventIdFp) || undefined,
      domain: str(consume.domain) || undefined,
      domainFp: hex(consume.domain_fp || consume.domainFp) || undefined,
      guestRoot: hex(consume.guest_root || consume.guestRoot) || undefined,
      epoch: num(consume.epoch, 0),
      leafCount: num(consume.leaf_count ?? consume.leafCount, 0),
      serviceKey: str(consume.service_key || consume.serviceKey) || undefined,
      usherGroup: str(consume.usher_group || consume.usherGroup) || undefined,
      doorAuthPubkey: hex(consume.door_auth_pubkey || consume.doorAuthPubkey) || undefined,
      verifier: str(consume.verifier, 'stub'),
    },
    roots: ((raw.roots as unknown[]) || []).map((s) => {
      const x = s as Record<string, unknown>
      return {
        root: hex(x.root),
        epoch: num(x.epoch, 0),
        leafCount: num(x.leaf_count ?? x.leafCount, 0),
        time: ts(x.time) || undefined,
      }
    }),
  }
}


export type EventSummary = {
  contract: string
  name: string
  startsAt: string
}

/** Picker label read: { event_info: {} } (indexer first), or the cached view. */
export const eventSummaryQuery = (
  boot: Pick<ChainBoot, 'chainId' | 'lcd'>,
  contract: string,
  opts: { viaView?: boolean } = {},
): QueryDef<EventSummary> => {
  const addr = contract.trim()
  return {
    key: sezsKeys.event.summary(boot.chainId, addr),
    staleTime: STALE.summary,
    fn: async ({ signal }) => {
      const empty = { contract: addr, name: '', startsAt: '' }
      if (!addr || !boot.lcd || !lcdAllowed(boot.lcd)) return empty
      const view = queryCache.peek<EventManifold>(sezsKeys.event.view(boot.chainId, addr))
      if (view?.data) return { contract: addr, name: view.data.event.name, startsAt: view.data.event.start }
      try {
        if (opts.viaView) {
          // The selected event's page needs its EventView anyway: join that
          // one request instead of sending a separate event_info.
          const v = await queryCache.fetch(eventViewQuery(boot, addr), { signal })
          return { contract: addr, name: v.event.name, startsAt: v.event.start }
        }
        const got = await indexerFirst({
          indexer: indexerFromEnv(boot.chainId),
          fromIndexer: (cfg, sig) => queryIndexer(cfg, addr, 'sezs/eventInfo', undefined, { signal: sig }),
          accept: (v): v is Record<string, unknown> => !!v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string',
          fromChain: (sig) => lcdSmart(boot.lcd, addr, { event_info: {} }, { signal: sig }),
          signal,
        })
        const info = got.data
        return {
          contract: addr,
          name: typeof info.name === 'string' ? info.name : '',
          startsAt: ts(info.start ?? info.starts_at ?? info.startsAt),
        }
      } catch (e) {
        if (signal.aborted) throw e
        return empty
      }
    },
  }
}

export async function loadEventSummary(lcd: string, addr: string, chainId = readBoot().chainId): Promise<EventSummary> {
  return queryCache.fetch(eventSummaryQuery({ lcd, chainId }, addr))
}
