/**
 * Unified marketplace catalog model + pure search/filter (M3).
 *
 * Handoff: docs/superpowers/specs/2026-07-20-dao-marketplace-nostr-ui-handoff.md §5
 * Chain types: MarketplaceMirror + TerpAuction (cwgen).
 * ICT races: oversell / early settle / seller-cancel — surface via available & honesty copy.
 *
 * Pure functions only — safe for unit tests / Storybook; no React, no RPC.
 */

import type {
  Product,
  ProductResponse,
} from '@dao-dao/types/contracts/MarketplaceMirror'

/** Matches TerpAuction `AuctionType` without hard import cycle in pure utils. */
export type AuctionTypeLike = 'auction' | 'buy_now' | string

export type MarketplaceListingKind = 'fixed' | 'auction' | 'buy_now'

export type MarketplaceListingSource = 'chain' | 'query' | 'nostr' | 'demo'

export type NormalizedMarketplaceListing = {
  /** sku | `${nft}:${tokenId}` | auction_id string */
  id: string
  kind: MarketplaceListingKind
  title: string
  description?: string
  imageUrl?: string
  contentCid?: string
  /** unit_price or current bid / reserve (Uint128 string) */
  price?: string
  denom: string
  seller?: string
  // fixed
  sku?: string
  stock?: number
  available?: number
  reserved?: number
  // auction
  auctionId?: string
  nftContract?: string
  tokenId?: string
  /** unix seconds when known */
  endTime?: number
  reservePrice?: string
  highBid?: string
  isSettled?: boolean
  // source
  contract: string
  source: MarketplaceListingSource
}

export type MarketplaceSearchState = {
  q: string
  /** empty = all modes */
  modes: MarketplaceListingKind[]
  priceMin?: string
  priceMax?: string
  /** When true, drop sold-out fixed and settled auctions */
  onlyAvailable: boolean
  /** Auction/buy_now ending within this many hours from `nowSec` */
  endingWithinHours?: number
  sort: 'newest' | 'price_asc' | 'price_desc' | 'ending'
}

export const defaultMarketplaceSearchState = (): MarketplaceSearchState => ({
  q: '',
  modes: [],
  onlyAvailable: true,
  sort: 'newest',
})

/** Map auction_type → catalog kind. */
export const auctionTypeToKind = (
  t: AuctionTypeLike | undefined
): MarketplaceListingKind => {
  if (t === 'buy_now' || t === 'BuyNow') return 'buy_now'
  return 'auction'
}

/**
 * Normalize marketplace-mirror ProductResponse into catalog row.
 * Title defaults to sku until content plane body fills title/image (M6).
 */
export const normalizeFixedProduct = ({
  response,
  contract,
  denom,
  source = 'chain',
}: {
  response: ProductResponse | { product: Product; reserved: number; available: number }
  contract: string
  denom: string
  source?: MarketplaceListingSource
}): NormalizedMarketplaceListing => {
  const { product, reserved, available } = response
  return {
    id: product.sku,
    kind: 'fixed',
    title: product.sku,
    contentCid: product.content_cid ?? undefined,
    price: product.unit_price,
    denom,
    seller: product.seller,
    sku: product.sku,
    stock: product.stock,
    available,
    reserved,
    contract,
    source,
  }
}

/** Structural auction row (matches TerpAuction AuctionResponse). */
export type AuctionRowLike = {
  auction_id: string
  auction_type: AuctionTypeLike
  nft_contract: string
  token_id: string
  seller: string
  denom: string
  reserve_price: string
  end_time: number
  amount: string
  bidder?: string | null
  is_settled: boolean
}

export const normalizeAuction = ({
  auction,
  contract,
  source = 'chain',
}: {
  auction: AuctionRowLike
  contract: string
  source?: MarketplaceListingSource
}): NormalizedMarketplaceListing => {
  const kind = auctionTypeToKind(auction.auction_type)
  const id = String(auction.auction_id)
  const highBid = auction.amount && auction.amount !== '0' ? auction.amount : undefined
  return {
    id: `auction:${id}`,
    kind,
    title: `${auction.nft_contract.slice(0, 8)}… #${auction.token_id}`,
    price: highBid ?? auction.reserve_price,
    denom: auction.denom,
    seller: auction.seller,
    auctionId: id,
    nftContract: auction.nft_contract,
    tokenId: auction.token_id,
    endTime: auction.end_time,
    reservePrice: auction.reserve_price,
    highBid,
    isSettled: auction.is_settled,
    contract,
    source,
  }
}

/**
 * ICT `vectors.catalog_gap.demo_skus` + seed.js fixtures.
 * Used until on-chain `list_products` exists (AGENT-M3-ICT-DELTA-SYNC §3).
 * Race demo SKU is `GL-LTD-001` (stock 2).
 */
export type IctDemoFixedSkuSeed = {
  sku: string
  title: string
  stock: number
  /** unit_price in micro-denom (uterp) */
  unitPrice: string
  /** Fixture content_cid when documented; not required for purchase path */
  contentCid?: string
  description?: string
}

export const ICT_CATALOG_GAP_DEMO_SKUS: readonly IctDemoFixedSkuSeed[] = [
  {
    sku: 'GL-FLW-3.5',
    title: 'Indoor Flower 3.5g',
    stock: 40,
    unitPrice: '25000000',
    contentCid: 'budsha256:aaa',
    description: 'ICT catalog_gap demo SKU (seed). Chain Product{} wins when listed.',
  },
  {
    sku: 'GL-PRL-001',
    title: 'Pre-Roll Single',
    stock: 100,
    unitPrice: '8000000',
    contentCid: 'budsha256:bbb',
    description: 'ICT catalog_gap demo SKU (seed). Chain Product{} wins when listed.',
  },
  {
    sku: 'HC-TIN-30',
    title: 'CBD Tincture 30ml',
    stock: 25,
    unitPrice: '35000000',
    description: 'ICT catalog_gap demo SKU (seed). No content_cid in fixtures.',
  },
  {
    sku: 'HC-GUM-10',
    title: 'Gummies 10pk',
    stock: 60,
    unitPrice: '18000000',
    description: 'ICT catalog_gap demo SKU (seed). No content_cid in fixtures.',
  },
  {
    sku: 'GL-LTD-001',
    title: 'Limited Drop Rosin',
    stock: 2,
    unitPrice: '120000000',
    contentCid: 'budsha256:ccc',
    description:
      'ICT purchase_buffer / oversell race demo (stock 2). Prefer for collab demos.',
  },
] as const

/** SKU list for per-SKU Product{} probes (same order as ICT table). */
export const ICT_DEMO_FIXED_SKU_IDS: readonly string[] =
  ICT_CATALOG_GAP_DEMO_SKUS.map((s) => s.sku)

/**
 * Demo seed listings aligned with ICT catalog_gap + auction placeholders.
 * Always labeled `source: 'demo'`. Used when mesh contracts exist but
 * list_products is missing — merge with chain rows via mergeCatalogPreferChain.
 */
export const demoListingsFromMesh = ({
  fixedPriceContract,
  auctionContract,
  acceptedDenom = 'uterp',
}: {
  fixedPriceContract?: string
  auctionContract?: string
  acceptedDenom?: string
}): NormalizedMarketplaceListing[] => {
  const out: NormalizedMarketplaceListing[] = []
  if (fixedPriceContract) {
    for (const seed of ICT_CATALOG_GAP_DEMO_SKUS) {
      out.push({
        id: seed.sku,
        kind: 'fixed',
        title: `${seed.title} (demo)`,
        description: seed.description,
        price: seed.unitPrice,
        denom: acceptedDenom,
        sku: seed.sku,
        stock: seed.stock,
        available: seed.stock,
        reserved: 0,
        contentCid: seed.contentCid,
        contract: fixedPriceContract,
        source: 'demo',
      })
    }
  }
  if (auctionContract) {
    const end = Math.floor(Date.now() / 1000) + 3600 * 6
    out.push({
      id: 'auction:demo-1',
      kind: 'auction',
      title: 'Demo NFT lot',
      description:
        'Placeholder auction until mesh.nftCollections or DAO-as-seller AuctionBySeller returns rows.',
      price: '5000000',
      denom: acceptedDenom,
      auctionId: '1',
      nftContract: 'terp1nft…',
      tokenId: '1',
      endTime: end,
      reservePrice: '5000000',
      isSettled: false,
      contract: auctionContract,
      source: 'demo',
    })
    out.push({
      id: 'auction:demo-buy-now',
      kind: 'buy_now',
      title: 'Demo Buy Now',
      description:
        'Placeholder buy_now until mesh.nftCollections or DAO-as-seller AuctionBySeller returns rows.',
      price: '2500000',
      denom: acceptedDenom,
      auctionId: '2',
      nftContract: 'terp1nft…',
      tokenId: '2',
      endTime: end + 86400,
      reservePrice: '2500000',
      isSettled: false,
      contract: auctionContract,
      source: 'demo',
    })
  }
  return out
}

/**
 * Prefer chain/query rows over demo seeds per listing id (SKU or auction:id).
 * Keeps demo-labeled gaps so partial Product{} success does not wipe the catalog.
 */
export const mergeCatalogPreferChain = ({
  chain,
  demo,
}: {
  chain: NormalizedMarketplaceListing[]
  demo: NormalizedMarketplaceListing[]
}): NormalizedMarketplaceListing[] => {
  const byId = new Map<string, NormalizedMarketplaceListing>()
  for (const row of demo) {
    byId.set(row.id, row)
  }
  for (const row of chain) {
    byId.set(row.id, row)
  }
  return [...byId.values()].sort((a, b) => {
    const rank = (s: MarketplaceListingSource) =>
      s === 'chain' ? 0 : s === 'query' ? 1 : s === 'nostr' ? 2 : 3
    if (a.source !== b.source) return rank(a.source) - rank(b.source)
    return a.id.localeCompare(b.id)
  })
}

const priceNum = (s?: string): number | undefined => {
  if (s == null || s === '') return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

const matchesQuery = (
  item: NormalizedMarketplaceListing,
  q: string
): boolean => {
  if (!q.trim()) return true
  const hay = [
    item.title,
    item.description,
    item.sku,
    item.tokenId,
    item.auctionId,
    item.nftContract,
    item.seller,
    item.contentCid,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(q.trim().toLowerCase())
}

const isAvailable = (item: NormalizedMarketplaceListing): boolean => {
  if (item.kind === 'fixed') {
    return (item.available ?? 0) > 0
  }
  // auction / buy_now
  return !item.isSettled
}

/**
 * Pure filter + sort for catalog and purchase drawer.
 * @param nowSec — inject for ending-soon tests (default Date.now/1000)
 */
export const filterListings = (
  items: NormalizedMarketplaceListing[],
  s: MarketplaceSearchState,
  nowSec: number = Math.floor(Date.now() / 1000)
): NormalizedMarketplaceListing[] => {
  const modes = s.modes.length ? new Set(s.modes) : null
  const min = priceNum(s.priceMin)
  const max = priceNum(s.priceMax)
  const endingHorizon =
    s.endingWithinHours != null && s.endingWithinHours > 0
      ? nowSec + s.endingWithinHours * 3600
      : undefined

  let out = items.filter((item) => {
    if (modes && !modes.has(item.kind)) return false
    if (!matchesQuery(item, s.q)) return false
    if (s.onlyAvailable && !isAvailable(item)) return false

    const p = priceNum(item.price)
    if (min != null && (p == null || p < min)) return false
    if (max != null && (p == null || p > max)) return false

    if (endingHorizon != null) {
      // Fixed listings have no end — exclude when ending filter active
      if (item.kind === 'fixed') return false
      if (item.endTime == null || item.endTime > endingHorizon) return false
      if (item.endTime <= nowSec) return false // already ended / ending now
    }

    return true
  })

  out = [...out].sort((a, b) => {
    switch (s.sort) {
      case 'price_asc': {
        const pa = priceNum(a.price) ?? Number.POSITIVE_INFINITY
        const pb = priceNum(b.price) ?? Number.POSITIVE_INFINITY
        return pa - pb
      }
      case 'price_desc': {
        const pa = priceNum(a.price) ?? -1
        const pb = priceNum(b.price) ?? -1
        return pb - pa
      }
      case 'ending': {
        const ea = a.endTime ?? Number.POSITIVE_INFINITY
        const eb = b.endTime ?? Number.POSITIVE_INFINITY
        return ea - eb
      }
      case 'newest':
      default:
        // Prefer chain over demo; then id
        if (a.source !== b.source) {
          const rank = (s: MarketplaceListingSource) =>
            s === 'chain' ? 0 : s === 'query' ? 1 : s === 'nostr' ? 2 : 3
          return rank(a.source) - rank(b.source)
        }
        return a.id.localeCompare(b.id)
    }
  })

  return out
}

/**
 * Buffer honesty: settle allowed only when height >= settle_after.
 * Mirrors ICT purchase_buffer vectors (default min_buffer 7).
 */
export const settleAllowedAtHeight = (
  settleAfter: number,
  height: number
): boolean => height >= settleAfter

export const computeSettleAfter = (
  reserveHeight: number,
  minBufferBlocks: number = 7
): number => reserveHeight + minBufferBlocks

/** ICT-aligned honesty labels for reserved fixed-price orders. */
export const BUFFER_HONESTY_COPY = {
  reserved: 'Confirming purchase (on-chain buffer)',
  earlySettle: 'Available after block N (buffer not elapsed)',
  oversell: 'Insufficient available stock',
  sellerCancel: 'Seller cannot cancel reserved orders',
  nostrNotFinal: 'Nostr never finalizes purchases',
  wrongDenom: 'Wallet funds must use the listing denom',
  connectWallet: 'Connect a wallet to purchase',
  demoNoChain: 'Demo seed only — product not on-chain; purchase will fail until listed',
} as const

// ── M4 purchase helpers (pure) ──────────────────────────────────────────────

/** Clamp qty to [1, available]; 0 available → 0. */
export const clampPurchaseQty = (
  qty: number,
  available: number
): number => {
  if (!Number.isFinite(qty) || !Number.isFinite(available)) return 0
  if (available <= 0) return 0
  const q = Math.floor(qty)
  if (q < 1) return 1
  return Math.min(q, available)
}

/**
 * Total funds for Purchase msg: unit_price * qty (Uint128 string).
 * Uses bigint so micro-denom amounts stay exact.
 */
export const computePurchaseFunds = (
  unitPrice: string,
  qty: number
): string => {
  const q = BigInt(Math.max(0, Math.floor(qty)))
  const p = BigInt(unitPrice || '0')
  return (p * q).toString()
}

/** Map chain/query errors to honesty copy when possible. */
export const mapPurchaseError = (err: unknown): string => {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : String(err)
  const lower = msg.toLowerCase()
  if (
    lower.includes('insufficient') ||
    lower.includes('oversell') ||
    lower.includes('available')
  ) {
    return BUFFER_HONESTY_COPY.oversell
  }
  if (
    lower.includes('buffer') ||
    lower.includes('settle_after') ||
    lower.includes('not elapsed')
  ) {
    return BUFFER_HONESTY_COPY.earlySettle
  }
  if (lower.includes('seller') && lower.includes('cancel')) {
    return BUFFER_HONESTY_COPY.sellerCancel
  }
  return msg
}

export type PurchaseIntent = {
  sku: string
  qty: number
  unitPrice: string
  denom: string
  fundsAmount: string
  available: number
  minBufferBlocks: number
  contract: string
  /** Expected settle_after once height known: height + buffer */
  estimatedSettleAfterHint: string
}

export const buildPurchaseIntent = ({
  listing,
  qty,
  minBufferBlocks = 7,
}: {
  listing: NormalizedMarketplaceListing
  qty: number
  minBufferBlocks?: number
}): PurchaseIntent | { error: string } => {
  if (listing.kind !== 'fixed' || !listing.sku) {
    return { error: 'Purchase drawer is for fixed-price SKUs only (M4)' }
  }
  const available = listing.available ?? 0
  const clamped = clampPurchaseQty(qty, available)
  if (clamped < 1) {
    return { error: BUFFER_HONESTY_COPY.oversell }
  }
  if (!listing.price) {
    return { error: 'Listing has no unit price' }
  }
  const fundsAmount = computePurchaseFunds(listing.price, clamped)
  return {
    sku: listing.sku,
    qty: clamped,
    unitPrice: listing.price,
    denom: listing.denom,
    fundsAmount,
    available,
    minBufferBlocks,
    contract: listing.contract,
    estimatedSettleAfterHint: `reserve_height + ${minBufferBlocks}`,
  }
}
