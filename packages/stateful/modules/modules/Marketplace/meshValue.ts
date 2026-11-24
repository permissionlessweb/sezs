import {
  ChainMeshServices,
  MeshMarketplaceV1,
  curateMeshMarketplaceRecord,
  parseMeshMarketplace,
} from '@dao-dao/utils'

import { MarketplaceModuleData } from './types'

/**
 * Build marketplace block from module editor fields.
 */
export const marketplaceFromModuleData = (
  data: Pick<
    MarketplaceModuleData,
    | 'fixedPriceContract'
    | 'auctionContract'
    | 'nftCollections'
    | 'contentBase'
    | 'acceptedDenom'
    | 'minBufferBlocks'
  >
): MeshMarketplaceV1 | undefined => {
  const fixedPrice = data.fixedPriceContract?.trim() || undefined
  const auction = data.auctionContract?.trim() || undefined
  const nftCollections = data.nftCollections?.trim() || undefined
  const contentBase = data.contentBase?.trim() || undefined
  const acceptedDenom = data.acceptedDenom?.trim() || undefined
  const minBufferBlocks =
    typeof data.minBufferBlocks === 'number' && data.minBufferBlocks > 0
      ? data.minBufferBlocks
      : undefined

  // No marketplace surface without at least one contract (or explicit content plane).
  if (!fixedPrice && !auction && !contentBase && !acceptedDenom) {
    return undefined
  }

  return parseMeshMarketplace({
    fixedPrice,
    auction,
    nftCollections,
    contentBase,
    acceptedDenom,
    minBufferBlocks,
    modes: ['fixed', 'auction', 'buy_now'],
  })
}

/**
 * Build the mesh.v1 storage item value written when enabling/editing Marketplace.
 * Uses shared daoNipRecords curator (DaoRecordAction-equivalent on FE).
 */
export const buildMarketplaceMeshStorageValue = ({
  chainServices,
  data,
  meshJson,
}: {
  chainServices: ChainMeshServices
  data: Pick<
    MarketplaceModuleData,
    | 'fixedPriceContract'
    | 'auctionContract'
    | 'nftCollections'
    | 'contentBase'
    | 'acceptedDenom'
    | 'minBufferBlocks'
    | 'meshJson'
  >
  meshJson?: string | null
}): string =>
  curateMeshMarketplaceRecord({
    chainServices,
    fixedPrice: data.fixedPriceContract?.trim() || undefined,
    auction: data.auctionContract?.trim() || undefined,
    nftCollections: data.nftCollections
      ?.split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    contentBase: data.contentBase?.trim() || undefined,
    acceptedDenom: data.acceptedDenom?.trim() || undefined,
    minBufferBlocks:
      typeof data.minBufferBlocks === 'number' && data.minBufferBlocks > 0
        ? data.minBufferBlocks
        : 7,
    meshJson: meshJson ?? data.meshJson,
  })
