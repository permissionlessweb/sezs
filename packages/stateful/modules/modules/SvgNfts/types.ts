/**
 * Module variables for SVG NFT collections (cw-svg-minter + cw721_svg).
 * Shaped for dao-dao Module editor / renderer patterns (same spirit as MintNft).
 */
export type SvgNftModuleData = {
  /**
   * cw721_svg collection address to browse / mint from.
   */
  nftCollection: string
  /**
   * Optional cw-svg-minter factory/registry (list collections, create).
   */
  svgMinter: string
  description: string
  create: {
    /**
     * Contract to call for collection creation (usually svg minter).
     */
    contract: string
    /**
     * JSON-encoded message. {{wallet}} replaced with connected address.
     */
    msg: string
    buttonLabel: string
  }
  mint: {
    /**
     * Contract to execute mint against (collection or minter).
     */
    contract: string
    /**
     * JSON-encoded message. {{wallet}} replaced with connected address.
     */
    msg: string
    buttonLabel: string
  }
  market: {
    contract: string
    buyer_action: string
    vendor_action: string
  }
}

/** @deprecated Prefer SvgNftModuleData — kept for file renames in flight. */
export type MintNftData = SvgNftModuleData
