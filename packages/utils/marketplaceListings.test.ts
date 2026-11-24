import { describe, expect, test } from 'vitest'

import {
  BUFFER_HONESTY_COPY,
  ICT_CATALOG_GAP_DEMO_SKUS,
  ICT_DEMO_FIXED_SKU_IDS,
  buildPurchaseIntent,
  clampPurchaseQty,
  computePurchaseFunds,
  computeSettleAfter,
  defaultMarketplaceSearchState,
  demoListingsFromMesh,
  filterListings,
  mapPurchaseError,
  mergeCatalogPreferChain,
  normalizeAuction,
  normalizeFixedProduct,
  settleAllowedAtHeight,
  type NormalizedMarketplaceListing,
  type MarketplaceSearchState,
} from './marketplaceListings'

const fixed = (partial: Partial<NormalizedMarketplaceListing> & { id: string }): NormalizedMarketplaceListing => ({
  kind: 'fixed',
  title: partial.id,
  denom: 'uterp',
  contract: 'terp1fp',
  source: 'chain',
  available: 1,
  stock: 1,
  reserved: 0,
  price: '100',
  sku: partial.id,
  ...partial,
})

const auction = (
  partial: Partial<NormalizedMarketplaceListing> & { id: string }
): NormalizedMarketplaceListing => ({
  kind: 'auction',
  title: partial.id,
  denom: 'uterp',
  contract: 'terp1auc',
  source: 'chain',
  price: '500',
  endTime: 1_700_000_100,
  isSettled: false,
  auctionId: '1',
  ...partial,
})

describe('normalizeFixedProduct', () => {
  test('maps ProductResponse + available', () => {
    const row = normalizeFixedProduct({
      response: {
        product: {
          sku: 'GL-LTD-001',
          seller: 'terp1seller',
          stock: 2,
          unit_price: '1000000',
          content_cid: 'abc',
          d_tag: 'gl',
        },
        reserved: 0,
        available: 2,
      },
      contract: 'terp1fp',
      denom: 'uterp',
    })
    expect(row.kind).toBe('fixed')
    expect(row.sku).toBe('GL-LTD-001')
    expect(row.available).toBe(2)
    expect(row.price).toBe('1000000')
    expect(row.contentCid).toBe('abc')
  })
})

describe('normalizeAuction', () => {
  test('buy_now kind from auction_type', () => {
    const row = normalizeAuction({
      auction: {
        auction_id: '9',
        auction_type: 'buy_now',
        nft_contract: 'terp1nft',
        token_id: '3',
        seller: 'terp1s',
        denom: 'uterp',
        reserve_price: '10',
        end_time: 99,
        amount: '0',
        is_settled: false,
      },
      contract: 'terp1auc',
    })
    expect(row.kind).toBe('buy_now')
    expect(row.id).toBe('auction:9')
    expect(row.price).toBe('10')
  })
})

describe('filterListings (ICT-aligned)', () => {
  const items: NormalizedMarketplaceListing[] = [
    fixed({ id: 'GL-LTD-001', price: '1000000', available: 2, title: 'Demo Tee' }),
    fixed({ id: 'SOLD', price: '50', available: 0, stock: 0, title: 'Sold out' }),
    auction({
      id: 'auction:1',
      price: '5000000',
      endTime: 1_700_000_200,
      title: 'Lot A',
    }),
    auction({
      id: 'auction:2',
      kind: 'buy_now',
      price: '2500000',
      endTime: 1_700_003_600,
      title: 'Buy Now B',
    }),
    auction({
      id: 'auction:done',
      price: '1',
      isSettled: true,
      endTime: 1_700_000_000,
      title: 'Settled',
    }),
  ]

  const now = 1_700_000_000

  test('default onlyAvailable drops sold-out and settled', () => {
    const s = defaultMarketplaceSearchState()
    const out = filterListings(items, s, now)
    const ids = out.map((x) => x.id).sort()
    expect(ids).toEqual(['GL-LTD-001', 'auction:1', 'auction:2'].sort())
    expect(out.some((x) => x.id === 'SOLD' || x.id === 'auction:done')).toBe(
      false
    )
  })

  test('mode chips filter fixed | auction | buy_now', () => {
    const s: MarketplaceSearchState = {
      ...defaultMarketplaceSearchState(),
      modes: ['fixed'],
      onlyAvailable: false,
    }
    expect(filterListings(items, s, now).every((x) => x.kind === 'fixed')).toBe(
      true
    )

    const a = filterListings(
      items,
      { ...defaultMarketplaceSearchState(), modes: ['buy_now'], onlyAvailable: false },
      now
    )
    expect(a.map((x) => x.id)).toEqual(['auction:2'])
  })

  test('free-text matches sku / title', () => {
    const s: MarketplaceSearchState = {
      ...defaultMarketplaceSearchState(),
      q: 'GL-LTD',
      onlyAvailable: false,
    }
    expect(filterListings(items, s, now).map((x) => x.id)).toEqual([
      'GL-LTD-001',
    ])
  })

  test('price range', () => {
    const s: MarketplaceSearchState = {
      ...defaultMarketplaceSearchState(),
      priceMin: '2000000',
      priceMax: '6000000',
      onlyAvailable: true,
    }
    const ids = filterListings(items, s, now).map((x) => x.id)
    expect(ids).toContain('auction:1')
    expect(ids).toContain('auction:2')
    expect(ids).not.toContain('GL-LTD-001')
  })

  test('ending soon excludes fixed, ended, and far auctions', () => {
    // now=1700000000; horizon 1h → endTime in (now, now+3600]
    // auction:1 ends 1700000200, auction:2 ends 1700003600, auction:done ends now
    const s: MarketplaceSearchState = {
      ...defaultMarketplaceSearchState(),
      endingWithinHours: 1,
      onlyAvailable: false,
    }
    const out = filterListings(items, s, now)
    expect(out.every((x) => x.kind !== 'fixed')).toBe(true)
    expect(out.map((x) => x.id).sort()).toEqual(['auction:1', 'auction:2'])
  })

  test('sort price_asc', () => {
    const s: MarketplaceSearchState = {
      ...defaultMarketplaceSearchState(),
      sort: 'price_asc',
      onlyAvailable: true,
    }
    const prices = filterListings(items, s, now).map((x) => Number(x.price))
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
  })

  test('sort ending', () => {
    const s: MarketplaceSearchState = {
      ...defaultMarketplaceSearchState(),
      sort: 'ending',
      onlyAvailable: true,
      modes: ['auction', 'buy_now'],
    }
    const ends = filterListings(items, s, now).map((x) => x.endTime!)
    expect(ends).toEqual([...ends].sort((a, b) => a - b))
  })
})

describe('buffer honesty (ICT purchase_buffer)', () => {
  test('default buffer 7', () => {
    expect(computeSettleAfter(1000, 7)).toBe(1007)
    expect(settleAllowedAtHeight(1007, 1006)).toBe(false)
    expect(settleAllowedAtHeight(1007, 1007)).toBe(true)
  })

  test('honesty copy constants exist for UI', () => {
    expect(BUFFER_HONESTY_COPY.sellerCancel).toMatch(/Seller cannot cancel/)
    expect(BUFFER_HONESTY_COPY.nostrNotFinal).toMatch(/Nostr never/)
  })
})

describe('demoListingsFromMesh', () => {
  test('seeds full ICT catalog_gap SKU set when fixed contract set', () => {
    const rows = demoListingsFromMesh({
      fixedPriceContract: 'terp1fp',
      auctionContract: 'terp1auc',
      acceptedDenom: 'uterp',
    })
    const fixedSkus = rows.filter((r) => r.kind === 'fixed').map((r) => r.sku)
    expect(fixedSkus).toEqual([...ICT_DEMO_FIXED_SKU_IDS])
    expect(ICT_CATALOG_GAP_DEMO_SKUS).toHaveLength(5)

    const limited = rows.find((r) => r.sku === 'GL-LTD-001')
    expect(limited?.stock).toBe(2)
    expect(limited?.price).toBe('120000000')
    expect(limited?.source).toBe('demo')
    expect(limited?.title).toMatch(/Limited Drop Rosin/)

    const flower = rows.find((r) => r.sku === 'GL-FLW-3.5')
    expect(flower?.stock).toBe(40)
    expect(flower?.price).toBe('25000000')
    expect(flower?.source).toBe('demo')

    expect(rows.every((r) => r.source === 'demo')).toBe(true)
    expect(rows.some((r) => r.kind === 'buy_now')).toBe(true)
    expect(rows.some((r) => r.kind === 'auction')).toBe(true)
  })

  test('mergeCatalogPreferChain keeps demo gaps and lets chain win per id', () => {
    const demo = demoListingsFromMesh({
      fixedPriceContract: 'terp1fp',
      acceptedDenom: 'uterp',
    })
    const chainOnly = normalizeFixedProduct({
      response: {
        product: {
          sku: 'GL-LTD-001',
          seller: 'terp1seller',
          stock: 2,
          unit_price: '120000000',
          content_cid: null,
          d_tag: 'gl-ltd-001',
        },
        reserved: 1,
        available: 1,
      },
      contract: 'terp1fp',
      denom: 'uterp',
      source: 'chain',
    })
    const merged = mergeCatalogPreferChain({ chain: [chainOnly], demo })
    const limited = merged.find((r) => r.id === 'GL-LTD-001')
    expect(limited?.source).toBe('chain')
    expect(limited?.available).toBe(1)
    // Other ICT seeds remain demo-labeled
    expect(merged.find((r) => r.sku === 'GL-FLW-3.5')?.source).toBe('demo')
    expect(merged.filter((r) => r.kind === 'fixed')).toHaveLength(
      ICT_DEMO_FIXED_SKU_IDS.length
    )
  })
})

describe('M4 purchase helpers (ICT-aligned)', () => {
  test('clampPurchaseQty respects available not stock', () => {
    expect(clampPurchaseQty(5, 2)).toBe(2)
    expect(clampPurchaseQty(0, 2)).toBe(1)
    expect(clampPurchaseQty(1, 0)).toBe(0)
    expect(clampPurchaseQty(2.9, 2)).toBe(2)
  })

  test('computePurchaseFunds exact micro amounts', () => {
    // ICT GL-LTD-001: 120000000 * 2
    expect(computePurchaseFunds('120000000', 2)).toBe('240000000')
    expect(computePurchaseFunds('1000000', 1)).toBe('1000000')
  })

  test('buildPurchaseIntent for fixed listing', () => {
    const listing = fixed({
      id: 'GL-LTD-001',
      sku: 'GL-LTD-001',
      price: '120000000',
      available: 2,
      stock: 2,
    })
    const intent = buildPurchaseIntent({
      listing,
      qty: 5,
      minBufferBlocks: 7,
    })
    expect('error' in intent).toBe(false)
    if ('error' in intent) return
    expect(intent.qty).toBe(2)
    expect(intent.fundsAmount).toBe('240000000')
    expect(intent.estimatedSettleAfterHint).toContain('7')
  })

  test('buildPurchaseIntent rejects sold out', () => {
    const listing = fixed({
      id: 'SOLD',
      sku: 'SOLD',
      available: 0,
      price: '1',
    })
    const intent = buildPurchaseIntent({ listing, qty: 1 })
    expect('error' in intent && intent.error).toBe(BUFFER_HONESTY_COPY.oversell)
  })

  test('mapPurchaseError surfaces oversell honesty', () => {
    expect(mapPurchaseError(new Error('insufficient available stock'))).toBe(
      BUFFER_HONESTY_COPY.oversell
    )
  })
})
