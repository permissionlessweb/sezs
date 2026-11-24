import { describe, expect, test } from 'vitest'

import {
  AUCTION_HONESTY_COPY,
  buildBidIntent,
  buildPlaceBidMsg,
  computeMinBidAmount,
  isAuctionLive,
  secondsUntilEnd,
} from './marketplaceAuction'
import {
  MARKETPLACE_NOSTR_KINDS,
  buildMarketplaceNostrFilters,
  parseNip15BidAmount,
  parseNip15BidConfirmation,
} from './marketplaceNostr'
import type { NormalizedMarketplaceListing } from './marketplaceListings'

const auctionListing = (
  p: Partial<NormalizedMarketplaceListing> = {}
): NormalizedMarketplaceListing => ({
  id: 'auction:1',
  kind: 'auction',
  title: 'Lot',
  denom: 'uterp',
  contract: 'terp1auc',
  source: 'chain',
  auctionId: '1',
  reservePrice: '1000000',
  highBid: '0',
  price: '1000000',
  endTime: Math.floor(Date.now() / 1000) + 3600,
  isSettled: false,
  ...p,
})

describe('NIP-15 marketplace kinds (sync check)', () => {
  test('kinds match NIP-15 stall/product/auction/bid/confirm', () => {
    expect(MARKETPLACE_NOSTR_KINDS.stall).toBe(30017)
    expect(MARKETPLACE_NOSTR_KINDS.product).toBe(30018)
    expect(MARKETPLACE_NOSTR_KINDS.auctionProduct).toBe(30020)
    expect(MARKETPLACE_NOSTR_KINDS.bid).toBe(1021)
    expect(MARKETPLACE_NOSTR_KINDS.bidConfirmation).toBe(1022)
  })

  test('buildMarketplaceNostrFilters auction mode includes 30020', () => {
    const f = buildMarketplaceNostrFilters({
      dao: 'terp1dao',
      mode: 'auction',
    })
    expect(f[0].kinds).toContain(30020)
    expect(f[0]['#t']).toContain('auction')
  })

  test('bid filters attach #e auction event id', () => {
    const f = buildMarketplaceNostrFilters({
      mode: 'auction',
      auctionEventId: 'abc123',
    })
    const bidF = f.find((x) => x.kinds?.includes(1021))
    expect(bidF?.['#e']).toEqual(['abc123'])
  })

  test('parse NIP-15 bid + confirmation', () => {
    expect(parseNip15BidAmount('5000')).toBe('5000')
    expect(parseNip15BidAmount('nope')).toBeUndefined()
    expect(
      parseNip15BidConfirmation(
        JSON.stringify({ status: 'accepted', duration_extended: 60 })
      )?.status
    ).toBe('accepted')
  })
})

describe('computeMinBidAmount', () => {
  test('starts at reserve when no high bid', () => {
    expect(
      computeMinBidAmount({
        reservePrice: '1000000',
        highBid: '0',
        minIncrement: '0.05',
      })
    ).toBe('1000000')
  })

  test('applies min increment over high bid', () => {
    // 1_000_000 * 1.05 = 1_050_000
    expect(
      computeMinBidAmount({
        reservePrice: '100000',
        highBid: '1000000',
        minIncrement: '0.05',
      })
    ).toBe('1050000')
  })
})

describe('buildBidIntent', () => {
  test('auction uses min bid when amount omitted', () => {
    const intent = buildBidIntent({
      listing: auctionListing({ highBid: '2000000', minIncrement: undefined }),
      minIncrement: '0.1',
    })
    expect('error' in intent).toBe(false)
    if ('error' in intent) return
    expect(intent.mode).toBe('auction')
    expect(intent.fundsAmount).toBe(
      computeMinBidAmount({
        reservePrice: '1000000',
        highBid: '2000000',
        minIncrement: '0.1',
      })
    )
  })

  test('rejects bid below min', () => {
    const intent = buildBidIntent({
      listing: auctionListing({ highBid: '2000000' }),
      bidAmount: '2000000',
      minIncrement: '0.05',
    })
    expect('error' in intent && intent.error).toBe(
      AUCTION_HONESTY_COPY.bidBelowMin
    )
  })

  test('buy_now pays reserve', () => {
    const intent = buildBidIntent({
      listing: auctionListing({
        kind: 'buy_now',
        reservePrice: '2500000',
        price: '2500000',
      }),
    })
    expect('error' in intent).toBe(false)
    if ('error' in intent) return
    expect(intent.mode).toBe('buy_now')
    expect(intent.fundsAmount).toBe('2500000')
  })

  test('chain place_bid msg shape', () => {
    expect(buildPlaceBidMsg(7)).toEqual({
      place_bid: { auction_id: '7' },
    })
  })
})

describe('countdown', () => {
  test('secondsUntilEnd and isAuctionLive', () => {
    const now = 1_700_000_000
    expect(secondsUntilEnd(now + 10, now)).toBe(10)
    expect(
      isAuctionLive(
        auctionListing({ endTime: now + 10, isSettled: false }),
        now
      )
    ).toBe(true)
    expect(
      isAuctionLive(auctionListing({ endTime: now - 1, isSettled: false }), now)
    ).toBe(false)
  })
})
