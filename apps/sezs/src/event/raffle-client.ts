/** Thin LCD client for the nftfi_raffle contract.
 *
 * Query bodies follow the pweb NftfiRaffle bundle
 * (config, raffle, ticket_count). Generated TS clients in this repo
 * cover only the SEZS contracts, so this stays a hand-written LCD fetch
 * in the same shape as `client.ts`.
 */
import { readBoot } from './boot'
import { queryCache, type QueryDef } from '../query/core'
import { lcdAllowed, lcdSmart } from '../query/lcd'
import { STALE, sezsKeys } from '../query/keys'
import type { ChainRaffle } from './raffle-types'
import { normalizeRaffle } from './raffle-shape.mjs'

export type { ChainRaffle, Coin, RaffleAsset, RafflePhase } from './raffle-types'
export { asCoin, formatCoin, formatWhen, normalizeRaffle, rafflePhase } from './raffle-shape.mjs'

export type RaffleLoad = {
  source: 'chain' | 'none'
  contract: string
  lastRaffleId: number | null
  items: ChainRaffle[]
  note: string
  randomness?: string
}

const rec = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const num = (v: unknown, d = 0) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : d
  }
  return d
}
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)

const smart = (lcd: string, addr: string, msg: object, signal?: AbortSignal) =>
  lcdSmart<Record<string, unknown>>(lcd, addr, msg, { signal })

export async function ticketCount(
  lcd: string,
  addr: string,
  raffleId: number,
  owner: string,
  signal?: AbortSignal,
): Promise<number> {
  const data = await smart(lcd, addr, { ticket_count: { owner, raffle_id: raffleId } }, signal)
  return num(data.count ?? data)
}

/** Listings for the configured raffle contract. Shared by the gallery and
 * the raffle room, so opening both costs one fan-out per STALE.raffle. */
export async function loadRaffleListings(): Promise<RaffleLoad> {
  const boot = readBoot()
  return queryCache.fetch(raffleListingsQuery(boot))
}

const raffleListingsQuery = (boot: ReturnType<typeof readBoot>): QueryDef<RaffleLoad> => ({
  key: sezsKeys.raffle.listings(boot.chainId || '-', (boot.raffle || '').trim() || '-'),
  staleTime: STALE.raffle,
  fn: ({ signal }) => fetchRaffleListings(boot, signal),
})

async function fetchRaffleListings(boot: ReturnType<typeof readBoot>, signal: AbortSignal): Promise<RaffleLoad> {
  const lcd = boot.lcd
  const addr = (boot.raffle || '').trim()
  const empty = (note: string): RaffleLoad => ({
    source: 'none',
    contract: addr,
    lastRaffleId: null,
    items: [],
    note,
    randomness: boot.randomness || undefined,
  })
  if (!addr || !lcd) {
    return empty('No raffle contract is configured, so ticket listings cannot be read from chain.')
  }
  if (!lcdAllowed(lcd)) {
    return empty('The configured LCD is not on the allowlist.')
  }
  try {
    const cfg = await smart(lcd, addr, { config: {} }, signal)
    const lastRaw = cfg.last_raffle_id
    const last = lastRaw == null || lastRaw === '' ? null : num(lastRaw)
    const randomness = str(rec(rec(cfg.randomness).callback).verifier) || boot.randomness || undefined
    if (last == null) {
      return {
        source: 'chain',
        contract: addr,
        lastRaffleId: null,
        items: [],
        note: 'The raffle contract has no ticket listings yet.',
        randomness,
      }
    }
    const ids: number[] = []
    for (let id = last; id >= 0 && ids.length < 30; id--) ids.push(id)
    const rows = await Promise.all(
      ids.map((raffle_id) => smart(lcd, addr, { raffle: { raffle_id } }, signal).catch(() => null)),
    )
    const items: ChainRaffle[] = []
    for (const row of rows) {
      const n = row ? normalizeRaffle(row) : null
      if (n) items.push(n as ChainRaffle)
    }
    return {
      source: 'chain',
      contract: addr,
      lastRaffleId: last,
      items,
      note: items.length ? '' : 'The raffle contract has no ticket listings yet.',
      randomness,
    }
  } catch (e) {
    return empty(`The raffle contract could not be read (${e instanceof Error ? e.message : 'error'}).`)
  }
}

export async function loadMine(
  listings: RaffleLoad,
  owner?: string,
): Promise<Record<number, number>> {
  const boot = readBoot()
  if (!owner || !boot.lcd || !listings.contract || listings.source !== 'chain') return {}
  const ids = listings.items.map((r) => r.raffleId).join(',')
  return queryCache.fetch({
    key: [...sezsKeys.raffle.mine(boot.chainId || '-', listings.contract, owner), ids],
    staleTime: STALE.raffle,
    fn: ({ signal }) => fetchMine(boot.lcd, listings, owner, signal),
  })
}

async function fetchMine(lcd: string, listings: RaffleLoad, owner: string, signal: AbortSignal): Promise<Record<number, number>> {
  const out: Record<number, number> = {}
  await Promise.all(
    listings.items.map(async (r) => {
      try {
        out[r.raffleId] = await ticketCount(lcd, listings.contract, r.raffleId, owner, signal)
      } catch {
        out[r.raffleId] = 0
      }
    }),
  )
  return out
}

