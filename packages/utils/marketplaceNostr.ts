/**
 * Marketplace Nostr kinds + progressive filters (NIP-15).
 *
 * Spec: https://github.com/nostr-protocol/nips/blob/master/15.md
 * Status: draft / optional (unrecommended in favor of NIP-99 classifieds for
 * some clients) — we still sync kinds so FE filters match hash-market egress
 * and Plebeian/NostrMarket-compatible relays.
 *
 * Authority split (non-negotiable):
 * - Chain (marketplace-mirror / TerpAuction) settles money + inventory
 * - Nostr is progressive discovery / social mirror only
 * - Kind 1021 bid is NOT a chain PlaceBid; ingress → intent only
 *
 * | Kind  | NIP-15 role              | Terp chain analogue              |
 * |-------|--------------------------|----------------------------------|
 * | 30017 | set_stall                | mesh shop / DAO marketplace      |
 * | 30018 | set_product (fixed)      | marketplace-mirror ListProduct   |
 * | 30020 | auction product          | TerpAuction create (SendNft)     |
 * | 1021  | bid (content=amount)     | place_bid + funds                |
 * | 1022  | bid confirmation         | chain bid accept / settle winner |
 * | 1     | optional social mirror   | —                                |
 */

export const MARKETPLACE_NOSTR_KINDS = {
  /** NIP-15 create/update stall */
  stall: 30017,
  /** NIP-15 create/update fixed product */
  product: 30018,
  /** NIP-15 create/update auction product */
  auctionProduct: 30020,
  /** NIP-15 bid — content = amount; tag e = auction event id */
  bid: 1021,
  /** NIP-15 bid confirmation — content status accepted|rejected|pending|winner */
  bidConfirmation: 1022,
  /** Optional social mirror */
  textNote: 1,
} as const

export type MarketplaceNostrMode = 'fixed' | 'auction' | 'buy_now' | 'all'

export type MarketplaceNostrFilter = {
  kinds?: number[]
  authors?: string[]
  since?: number
  until?: number
  limit?: number
  '#t'?: string[]
  '#d'?: string[]
  '#e'?: string[]
  [tag: `#${string}`]: string[] | undefined
}

/**
 * Build subscribe-only filters for marketplace progressive plane.
 * Never used to execute purchases — chain wallet path remains authoritative.
 */
export const buildMarketplaceNostrFilters = ({
  dao,
  mode = 'all',
  sku,
  auctionEventId,
  limit = 50,
}: {
  dao?: string
  mode?: MarketplaceNostrMode
  sku?: string
  /** NIP-15: bids reference auction *event* id via #e */
  auctionEventId?: string
  limit?: number
}): MarketplaceNostrFilter[] => {
  const tBase = ['marketplace', 'dao-marketplace']
  if (dao) tBase.push(dao)

  const commonTags: Pick<MarketplaceNostrFilter, '#t' | '#d' | 'limit'> = {
    '#t': tBase,
    limit,
  }
  if (sku) {
    commonTags['#d'] = [sku]
  }

  if (mode === 'fixed') {
    return [
      {
        kinds: [MARKETPLACE_NOSTR_KINDS.product],
        ...commonTags,
        '#t': [...tBase, 'fixed'],
      },
    ]
  }

  if (mode === 'auction' || mode === 'buy_now') {
    const filters: MarketplaceNostrFilter[] = [
      {
        kinds: [MARKETPLACE_NOSTR_KINDS.auctionProduct],
        ...commonTags,
        '#t': [...tBase, mode],
      },
    ]
    if (auctionEventId) {
      filters.push({
        kinds: [
          MARKETPLACE_NOSTR_KINDS.bid,
          MARKETPLACE_NOSTR_KINDS.bidConfirmation,
        ],
        '#e': [auctionEventId],
        limit,
      })
    }
    return filters
  }

  // all
  return [
    {
      kinds: [
        MARKETPLACE_NOSTR_KINDS.stall,
        MARKETPLACE_NOSTR_KINDS.product,
        MARKETPLACE_NOSTR_KINDS.auctionProduct,
      ],
      ...commonTags,
    },
    {
      kinds: [
        MARKETPLACE_NOSTR_KINDS.bid,
        MARKETPLACE_NOSTR_KINDS.bidConfirmation,
      ],
      ...(dao ? { '#t': tBase } : {}),
      limit,
    },
  ]
}

/** NIP-15 kind 1021 bid event shape (unsigned helper / parse target). */
export type Nip15BidEventContent = string // amount as decimal string in auction currency

export type Nip15BidConfirmation = {
  status: 'accepted' | 'rejected' | 'pending' | 'winner'
  message?: string
  duration_extended?: number
}

export const parseNip15BidAmount = (content: string): string | undefined => {
  const t = content.trim()
  if (!t) return undefined
  // content is int/float amount per NIP-15
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined
  return t
}

export const parseNip15BidConfirmation = (
  content: string
): Nip15BidConfirmation | undefined => {
  try {
    const j = JSON.parse(content) as Nip15BidConfirmation
    if (
      j &&
      (j.status === 'accepted' ||
        j.status === 'rejected' ||
        j.status === 'pending' ||
        j.status === 'winner')
    ) {
      return j
    }
  } catch {
    /* not JSON */
  }
  return undefined
}

/**
 * Map NIP-15 auction product fields → FE listing hints.
 * Chain rows still win for money; this is progressive catalog only.
 */
export type Nip15AuctionProductBody = {
  id: string
  stall_id?: string
  name: string
  description?: string
  images?: string[]
  starting_bid?: number
  start_date?: number
  duration?: number
}

export const parseNip15AuctionProduct = (
  content: string
): Nip15AuctionProductBody | undefined => {
  try {
    const j = JSON.parse(content) as Nip15AuctionProductBody
    if (j && typeof j.id === 'string' && typeof j.name === 'string') return j
  } catch {
    /* */
  }
  return undefined
}
