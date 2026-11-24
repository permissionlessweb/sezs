/**
 * Pure auction / buy-now helpers (M5) — TerpAuction + NIP-15 sync.
 *
 * Chain execute (authoritative):
 *   place_bid { auction_id } + funds
 *   settle { auction_id }
 *   cancel_auction { auction_id }  (seller rules)
 *
 * NIP-15 progressive (discovery only — not finality):
 *   30020 auction product · 1021 bid · 1022 confirmation
 *
 * Buy-now on chain = auction_type buy_now / is_instant_sale path;
 * funds typically equal reserve_price (instant take).
 */

import type { NormalizedMarketplaceListing } from './marketplaceListings'
import { BUFFER_HONESTY_COPY } from './marketplaceListings'

export const AUCTION_HONESTY_COPY = {
  ...BUFFER_HONESTY_COPY,
  bidBelowMin: 'Bid below minimum (reserve or high bid + increment)',
  auctionEnded: 'Auction has ended — settle or wait for settle',
  buyNow: 'Buy now: pay reserve (instant sale path)',
  countdown: 'Ends at block/time — chain end_time is authority',
  nipBidNotChain:
    'Nostr kind 1021 bid is social only; wallet must PlaceBid on-chain',
} as const

/** Parse CosmWasm Decimal string (e.g. "0.05") → number fraction. */
export const parseDecimalFraction = (d?: string | null): number => {
  if (d == null || d === '') return 0
  const n = Number(d)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Minimum next bid in micro-denom integer string.
 * - No high bid yet → reserve_price
 * - Else ceil(high * (1 + minIncrement))
 */
export const computeMinBidAmount = ({
  reservePrice,
  highBid,
  minIncrement = '0',
}: {
  reservePrice: string
  highBid?: string | null
  /** CosmWasm Decimal, e.g. "0.05" = 5% */
  minIncrement?: string
}): string => {
  const reserve = BigInt(reservePrice || '0')
  const high =
    highBid && highBid !== '0' && highBid !== ''
      ? BigInt(highBid)
      : BigInt(0)

  if (high === BigInt(0)) {
    return reserve.toString()
  }

  const inc = parseDecimalFraction(minIncrement)
  if (inc <= 0) {
    // must strictly beat high bid by at least 1 micro unit
    return (high + BigInt(1)).toString()
  }

  // high * (1+inc) with ceil: (high * numer + denom - 1) / denom
  // use fixed 1e6 scale for decimal
  const scale = BigInt(1_000_000)
  const incScaled = BigInt(Math.round(inc * 1_000_000))
  const factor = scale + incScaled
  const raw = high * factor
  // ceil div
  const next = (raw + scale - BigInt(1)) / scale
  // never below reserve
  return (next > reserve ? next : reserve).toString()
}

export const secondsUntilEnd = (
  endTime: number | undefined,
  nowSec: number = Math.floor(Date.now() / 1000)
): number | null => {
  if (endTime == null) return null
  return endTime - nowSec
}

export const isAuctionLive = (
  listing: Pick<
    NormalizedMarketplaceListing,
    'endTime' | 'isSettled' | 'kind'
  >,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean => {
  if (listing.isSettled) return false
  if (listing.kind !== 'auction' && listing.kind !== 'buy_now') return false
  if (listing.endTime != null && listing.endTime <= nowSec) return false
  return true
}

export type BidIntent = {
  mode: 'auction' | 'buy_now'
  auctionId: string
  contract: string
  denom: string
  /** Funds attached to place_bid */
  fundsAmount: string
  minBid: string
  endTime?: number
}

export const buildBidIntent = ({
  listing,
  bidAmount,
  minIncrement = '0',
}: {
  listing: NormalizedMarketplaceListing
  /** User-entered bid; for buy_now ignored (uses reserve) */
  bidAmount?: string
  minIncrement?: string
}): BidIntent | { error: string } => {
  if (listing.kind !== 'auction' && listing.kind !== 'buy_now') {
    return { error: 'Bid drawer is for auction / buy_now only (M5)' }
  }
  if (!listing.auctionId) {
    return { error: 'Missing auction_id' }
  }
  if (listing.isSettled) {
    return { error: AUCTION_HONESTY_COPY.auctionEnded }
  }

  const reserve = listing.reservePrice || listing.price || '0'
  const high = listing.highBid

  if (listing.kind === 'buy_now') {
    const funds = reserve
    if (funds === '0') {
      return { error: 'Buy-now missing reserve price' }
    }
    return {
      mode: 'buy_now',
      auctionId: listing.auctionId,
      contract: listing.contract,
      denom: listing.denom,
      fundsAmount: funds,
      minBid: funds,
      endTime: listing.endTime,
    }
  }

  const minBid = computeMinBidAmount({
    reservePrice: reserve,
    highBid: high,
    minIncrement,
  })
  const bid = bidAmount && bidAmount !== '' ? bidAmount : minBid
  try {
    if (BigInt(bid) < BigInt(minBid)) {
      return { error: AUCTION_HONESTY_COPY.bidBelowMin }
    }
  } catch {
    return { error: 'Invalid bid amount' }
  }

  return {
    mode: 'auction',
    auctionId: listing.auctionId,
    contract: listing.contract,
    denom: listing.denom,
    fundsAmount: bid,
    minBid,
    endTime: listing.endTime,
  }
}

/** CosmWasm execute msgs for action library / wallet (snake_case JSON). */
export const buildPlaceBidMsg = (auctionId: string | number) => ({
  place_bid: {
    auction_id: String(auctionId),
  },
})

export const buildSettleAuctionMsg = (auctionId: string | number) => ({
  settle: {
    auction_id: String(auctionId),
  },
})

export const buildCancelAuctionMsg = (auctionId: string | number) => ({
  cancel_auction: {
    auction_id: String(auctionId),
  },
})

export const buildPurchaseMsg = (sku: string, qty: number) => ({
  purchase: {
    sku,
    qty,
  },
})

export const buildSettleFixedMsg = (orderId: number) => ({
  settle: {
    order_id: orderId,
  },
})

export const buildCancelFixedMsg = (orderId: number) => ({
  cancel: {
    order_id: orderId,
  },
})

export const placeBidMsgStructure = {
  place_bid: {
    auction_id: {},
  },
}

export const settleAuctionMsgStructure = {
  settle: {
    auction_id: {},
  },
}
