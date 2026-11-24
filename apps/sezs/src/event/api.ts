/** Event manifold API v2. Mirrors cw-event-manifold EventView. */

export const API_VERSION = 2 as const
export const SCHEMA = 'sezs-event-v2' as const

export type EventStatus = 'draft' | 'announced' | 'onsale' | 'live' | 'closed' | 'settled'

export type SlotRole = 'dj' | 'vj' | 'flow' | 'vendor' | 'host' | 'other'

export type RailId = 'zec' | 'penumbra'
/** Historic ids still parsed, then dropped. */
export type LegacyRailId = RailId | 'eth' | 'base'

export type EventInfo = {
  api: typeof API_VERSION
  schema?: typeof SCHEMA | string
  id?: string
  cwAve?: string
  name: string
  status: EventStatus
  start: string
  end: string
  timezone: string
  domain?: string
  doorAuthPubkey?: string
  kind?: number
  dTag?: string
  summary?: string
  content?: string
  location?: string
  geohash?: string
  image?: string
  tags?: string[]
  metadataUri?: string
  metadataHash?: string
}

export type VenueView = {
  api: typeof API_VERSION
  revealed: boolean
  label?: string
  note: string
}

export type LineupSlot = {
  id: string
  index: number
  role: SlotRole
  handle: string
  ref?: string
  start: string
  durationMin: number
  lane: string
}

export type TimelineItem = {
  id: string
  start: string
  end?: string
  label: string
  lane?: string
  slotId?: string
  untimed?: boolean
}

export type Sponsor = {
  id: string
  handle: string
  note?: string
  href?: string
  /** Off-chain metadata only. */
  logo?: string
  /** Off-chain metadata only. */
  tier?: string
  /** Off-chain metadata only. Marks invented listings for local events. */
  example?: boolean
}

export type TicketTier = {
  id: string
  label: string
  guestWeight?: number
  listCents: number
  discountsBps: Partial<Record<RailId, number>>
  supply: number
  sold: number
  rails: RailId[]
}

export type RaffleStatus = 'open' | 'closed' | 'drawn'

export type RaffleDraw = {
  jobId: string
  winnerIndex?: number
  proofHref?: string
  oracle: 'nois' | 'pending' | 'none'
  randomness?: string
}

export type RafflePrize = {
  id: string
  title: string
  note?: string
  entries: number
  status: RaffleStatus
  draw?: RaffleDraw
}

export type RoleBook = {
  curators: string[]
  coordinators: string[]
  ushers: string[]
  coordinatorsGroup?: string
  usherGroup?: string
  serviceKey?: string
}

export type FaqItem = {
  id: string
  question: string
  answer: string
}

export type RootRecord = {
  root: string
  epoch: number
  leafCount: number
  time?: string
}

export type ConsumeConfig = {
  api?: number
  schema?: string
  zkid: number
  eventIdFp?: string
  domain?: string
  domainFp?: string
  guestRoot?: string
  epoch: number
  leafCount: number
  serviceKey?: string
  usherGroup?: string
  doorAuthPubkey?: string
  verifier: 'stub' | 'zk-wasmvm' | string
}

export type EventManifold = {
  api: typeof API_VERSION
  schema?: typeof SCHEMA | string
  event: EventInfo
  venue: VenueView
  lineup: LineupSlot[]
  timeline: TimelineItem[]
  sponsors: Sponsor[]
  tiers: TicketTier[]
  raffles: RafflePrize[]
  faq: FaqItem[]
  roles: RoleBook
  consume?: ConsumeConfig
  roots?: RootRecord[]
}

export type StageSet = {
  id: string
  stageId: string
  stage: string
  artist: string
  start: string
  end?: string
  role?: string
}

export type Stage = {
  id: string
  name: string
  sets: StageSet[]
}

export type VendorListing = {
  id: string
  name: string
  services?: string
  href?: string
  handle?: string
  address?: string
}

export type GalleryWork = {
  id: string
  artistId: string
  artist: string
  title: string
  priceZec: number
  img?: string
  alt?: string
  about?: string
}

export type ArtistListing = {
  id: string
  name: string
  address?: string
  about?: string
}

export type MetadataMode = 'inline' | 'uri' | 'uri-unverified' | 'none'

/** EventView plus NIP-52 extras (stages, vendors, gallery, door price). */
export type ResolvedEvent = EventManifold & {
  stages: Stage[]
  vendors: VendorListing[]
  gallery: GalleryWork[]
  artists: ArtistListing[]
  doorCents?: number
  metadataMode: MetadataMode
  metadataNote: string
}

export const LAB_EVENT_ORIGIN = 'http://127.0.0.1:3051'

/** Contract domain / origin that site-scoped ZID keys and ticket signatures bind to. */
export const eventOrigin = (event?: { domain?: string } | null): string => {
  const raw = String(event?.domain || LAB_EVENT_ORIGIN).trim()
  try {
    const u = new URL(raw)
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || u.search || u.hash) {
      return LAB_EVENT_ORIGIN
    }
    if (u.pathname && u.pathname !== '/') return LAB_EVENT_ORIGIN
    if (!u.hostname) return LAB_EVENT_ORIGIN
    const port = u.port ? `:${u.port}` : ''
    return `${u.protocol}//${u.hostname}${port}`
  } catch {
    return LAB_EVENT_ORIGIN
  }
}

export const RAIL_ORDER: RailId[] = ['zec', 'penumbra']

export const RAIL_LABEL: Record<RailId, string> = {
  zec: 'Shielded ZEC',
  penumbra: 'Shielded Penumbra (UM)',
}

export const priceCents = (tier: TicketTier, rail: RailId): number => {
  const bps = tier.discountsBps[rail] || 0
  return Math.floor((tier.listCents * (10_000 - bps)) / 10_000)
}

export const discountPct = (tier: TicketTier, rail: RailId): number =>
  (tier.discountsBps[rail] || 0) / 100
