import { ImageOutlined, ImageRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { MintNftEditor as Editor } from './MintSvgEditor'
import { MintNftRenderer as Renderer } from './MintSvgRenderer'
import { SvgNftModuleData } from './types'

/** Terp mainnet defaults from terp-state.json (cw-svg-minter / cw721_svg). */
const TERP_SVG_MINTER =
  'terp188jpppxtfpf0vvt5gypdj52hk2xuswwcn38auczzxv20fcxz3kss9fhlru'
const TERP_CW721_SVG =
  'terp1vp7smemrv846hpsyqrzlnqapmu3sv7hyygf4rrnw3ls26ezk864qupr5zt'

export const SvgNftModule: Module<SvgNftModuleData> = {
  id: ModuleId.SvgNfts,
  title: 'SVG NFTs',
  description:
    'Create, mint, and browse on-chain SVG NFT collections (cw-svg-minter).',
  Icon: ImageOutlined,
  IconFilled: ImageRounded,
  location: ModuleDisplayLocation.Home,
  visibilityContext: ModuleVisibilityContext.Always,
  isChainSupported: (chainId) => chainId === ChainId.TerpMainnet,
  defaultValues: {
    nftCollection: TERP_CW721_SVG,
    svgMinter: TERP_SVG_MINTER,
    description:
      'On-chain SVG art collections. Mint uses your connected wallet and Terp dual-fee gas (THIOL preferred).',
    create: {
      contract: TERP_SVG_MINTER,
      msg: '{"create":{}}',
      buttonLabel: 'Create SVG Collection',
    },
    mint: {
      // Default mint path: execute on collection (static site often mints on collection or minter).
      contract: TERP_CW721_SVG,
      msg: '{"mint":{"amount":"1"}}',
      buttonLabel: 'Mint SVG NFT',
    },
    market: {
      contract: '',
      buyer_action: '{}',
      vendor_action: '{}',
    },
  },
  Renderer,
  Editor,
}
