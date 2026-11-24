/**
 * Shared defaults for Trustless Pledge (mainnet from SvgNfts / terp-state.json).
 */

export const TERP_MAINNET_SVG_MINTER =
  'terp188jpppxtfpf0vvt5gypdj52hk2xuswwcn38auczzxv20fcxz3kss9fhlru'

export const TERP_MAINNET_CW721_SVG =
  'terp1vp7smemrv846hpsyqrzlnqapmu3sv7hyygf4rrnw3ls26ezk864qupr5zt'

/**
 * Testnet `120u-1` slots — fill when collections are deployed.
 * Empty string means “not configured yet”; Editor requires addresses before mint.
 */
export const TERP_TESTNET_SVG_MINTER = ''
export const TERP_TESTNET_CW721_SVG = ''

export const DEFAULT_IPFS_GATEWAY = 'https://ipfs.terp.network/ipfs/'

/**
 * Public Trustlessness Pledge home — marketing + explanation site.
 * Module UI “Visit site” should always resolve here (not raw Fileverse).
 * Override with NEXT_PUBLIC_PLEDGE_SITE_URL.
 */
export const DEFAULT_PLEDGE_SITE_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_PLEDGE_SITE_URL) ||
  'https://permissionless.money/pledge'

/**
 * Full pledge text (Fileverse). Secondary deep-link for readers who want the
 * long-form document; not the primary brand destination.
 */
export const DEFAULT_PLEDGE_DOC_URL =
  'https://docs.fileverse.io/0x421f908d9f6bcac09ed3539fae6261f88dc87fe0/7#key=Lbuusw4wCGlqFoMkxrWExI1IxVqNFkfTvnmhesJgIAq49ahYXKT-zij044tIncFI'

export const DEFAULT_SIGN_DOMAIN = 'terp-adr032/v1'

/**
 * Placeholder manifesto CID — replace with pinned team pledge content.
 * Fileverse + site remain the human-readable docs.
 */
export const DEFAULT_MANIFESTO_CID = ''

/**
 * When instantiating a dedicated pledge cw721_svg collection, set
 * `SvgCollectionMetadata.require_auth = true` so the contract rejects mint
 * without ADR-36 `ext`. The UI always sends auth; this flag makes it mandatory
 * on-chain for that collection.
 */
export const PLEDGE_COLLECTION_REQUIRE_AUTH = true
