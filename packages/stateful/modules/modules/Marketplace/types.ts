/**
 * DAO-stored variables for the Marketplace module (M0 shell).
 * Handoff: docs/superpowers/specs/2026-07-20-dao-marketplace-nostr-ui-handoff.md
 *
 * Chain owns money/stock/auction state. mesh.v1.marketplace discovers contracts
 * + content plane. HTTP first; Nostr progressive (calendar C6 pattern).
 */
export type MarketplaceModuleData = {
  /**
   * marketplace-mirror contract (fixed-price SKU inventory).
   */
  fixedPriceContract: string
  /**
   * revenue/auction contract (NFT auction + buy-now).
   */
  auctionContract: string
  /**
   * Comma-separated CW721 collection addresses for auction catalog
   * (`auction_by_contract`). Optional: DAO-as-seller path still works.
   */
  nftCollections?: string
  /**
   * Optional markdown intro above the catalog.
   */
  description: string
  /**
   * Content plane base for bare sha256 content_cid (default: chain merkle/hash host).
   */
  contentBase: string
  /**
   * Accepted purchase denom (e.g. uterp). Empty → chain native / mesh default.
   */
  acceptedDenom: string
  /**
   * Fixed-price buffer escrow blocks (default 7 on chain).
   */
  minBufferBlocks: number
  /**
   * When true (default), resolveMesh uses chain headstash defaults if DAO has
   * not published mesh.v1 yet.
   */
  useChainMeshDefault?: boolean
  /**
   * Optional inline mesh.v1 JSON (advanced). Prefer DAO storage mesh.v1.
   */
  meshJson?: string
}
