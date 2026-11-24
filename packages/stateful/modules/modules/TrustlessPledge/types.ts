import { PledgeDataCommitment, PledgeDigestAlg } from '@dao-dao/utils'

/**
 * Module variables for Trustless Pledge NFT.
 * Spec: docs/superpowers/specs/2026-07-22-trustless-pledge-nft-module.md §4.2
 */
export type TrustlessPledgeModuleData = {
  /**
   * cw721_svg (or collection) contract address.
   */
  collection: string
  /**
   * Optional cw-svg-minter if mint goes through minter.
   */
  minter?: string
  /**
   * IPFS CID of manifesto markdown/HTML (canonical content).
   * May also be `ipfs://…`, `/ipfs/…`, or absolute https (see resolvePledgeDocUrl).
   */
  manifestoCid: string
  /**
   * Optional team-variant document CID/URI (second slot in the product body).
   */
  teamCid?: string
  /**
   * Optional verified ETH NFT contract (fill only from TP-ETH-1 SSOT).
   * When empty, document body uses manifestoCid/teamCid only.
   */
  ethContract?: string
  /**
   * Optional ETH token id for the canonical pledge document (tokenURI).
   */
  ethDocumentTokenId?: string
  /**
   * Optional ETH token id for the team-variant document.
   */
  ethTeamTokenId?: string
  /**
   * Public gateway base e.g. https://ipfs.terp.network/ipfs/
   */
  ipfsGateway: string
  /**
   * Fileverse (or other) long-form doc URL — secondary deep link.
   */
  pledgeDocUrl: string
  /**
   * Public Trustlessness Pledge website (permissionless.money/pledge).
   * Primary “Visit site” CTA. Defaults to DEFAULT_PLEDGE_SITE_URL.
   */
  pledgeSiteUrl?: string
  /**
   * ADR-032 domain tag e.g. terp-adr032/v1.
   */
  signDomain: string
  /**
   * Digest algorithm (default blake2b256 to align zkpallas).
   */
  digestAlg: PledgeDigestAlg
  /**
   * Optional project scope bound into the ADR-032 preimage
   * (e.g. grant id, product slug, DAO core address). Empty = unscoped.
   */
  projectId?: string
  /**
   * Optional multi-destination data commitments (kind|ref|digest) bound into
   * the ADR-032 preimage. Prepared for pledges to boards, proposals, IPFS
   * payloads, milestones, etc.
   *
   * Prefer structured array; editors may also store a JSON string which the
   * renderer parses via {@link parseModuleCommitments}.
   */
  commitments?: PledgeDataCommitment[] | string
  /**
   * Bech32 HRP for CosmosArbitrary mint auth (default `terp`).
   */
  authHrp?: string
  /**
   * Override CW721SVG_DST prefix for auth messages (default mainnet tag).
   */
  authDst?: string
  /**
   * Max one pledge NFT per wallet (UI + prefer contract mint_count).
   */
  onePerWallet: boolean
  buttonLabel?: string
  /**
   * “Team commitment first; open mint for demos”
   */
  teamNote?: string
  /**
   * Optional subtitle / description markdown.
   */
  description?: string
}

export type HasPledgedResult = {
  hasPledged: boolean
  /** First token id owned by wallet when known. */
  tokenId?: string
  /** Mint count from collection when available. */
  mintCount?: number
  /** How ownership was determined. */
  source: 'mint_count' | 'tokens' | 'none'
}
