import { StorefrontOutlined, StorefrontRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { MarketplaceEditor as Editor } from './MarketplaceEditor'
import { MarketplaceRenderer as Renderer } from './MarketplaceRenderer'
import { MarketplaceModuleExtraData, editAction } from './editAction'
import { MarketplaceModuleData } from './types'

/**
 * DAO Marketplace — fixed-price (marketplace-mirror) + auctions.
 * M0–M1: mesh.v1.marketplace enable + discovery
 * M2: MarketplaceMirror + TerpAuction cwgen clients
 * M3: catalog + pure filterListings (ICT-aligned availability / buffer honesty)
 * M4: fixed-price purchase drawer (qty≤available, buffer settle, buyer cancel)
 * M5: auction bid / buy_now drawer (NIP-15 kind sync; chain PlaceBid final)
 * Handoff: docs/superpowers/specs/2026-07-20-dao-marketplace-nostr-ui-handoff.md
 */
export const MarketplaceModule: Module<
  MarketplaceModuleData,
  MarketplaceModuleExtraData
> = {
  id: ModuleId.Marketplace,
  title: 'Marketplace',
  description:
    'Curate fixed-price inventory and NFT auctions. Chain settles money and stock; mesh.v1 discovers contracts and content; Nostr is progressive only.',
  Icon: StorefrontOutlined,
  IconFilled: StorefrontRounded,
  location: ModuleDisplayLocation.Tab,
  visibilityContext: ModuleVisibilityContext.Always,
  isChainSupported: (chainId) =>
    chainId === ChainId.TerpMainnet || chainId === ChainId.TerpTestnet,
  defaultValues: {
    fixedPriceContract: '',
    auctionContract: '',
    nftCollections: '',
    description: '',
    contentBase: '',
    acceptedDenom: '',
    minBufferBlocks: 7,
    useChainMeshDefault: true,
    meshJson: '',
  },
  Renderer,
  Editor,
  editAction,
}

export type { MarketplaceModuleData } from './types'
export type { MarketplaceModuleExtraData } from './editAction'
