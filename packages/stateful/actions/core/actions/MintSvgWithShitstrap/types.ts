import { SvgMintPaymentPath } from '@dao-dao/utils'

export type MintSvgWithShitstrapData = {
  chainId: string
  /**
   * cw721_svg (or mint target) collection.
   */
  collectionAddress: string
  /**
   * Optional minter contract if mint is not on the collection.
   */
  mintContract?: string
  /**
   * Quantity of NFTs to mint.
   */
  quantity: number
  /**
   * Price per token in mint denom base units (e.g. uthiol).
   */
  pricePerToken: string
  /**
   * Mint payment denom (default uthiol on Terp).
   */
  mintDenom: string
  /**
   * Payment path selected in UI.
   */
  path: SvgMintPaymentPath
  /**
   * For atomic / legacy: shitstrap contract(s) and slop.
   */
  shitstrapAddress?: string
  slopDenom?: string
  slopAmount?: string
  /**
   * Merkle proof hashes for whitelist / fee-bypass.
   */
  proofHashes?: string[]
  allocation?: number | null
}
