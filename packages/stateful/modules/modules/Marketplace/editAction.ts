import { ActionContextType, Module } from '@dao-dao/types'
import {
  MESH_STORAGE_KEY,
  getSupportedChainConfig,
} from '@dao-dao/utils'

import { ManageStorageItemsAction } from '../../../actions/core/actions/ManageStorageItems'
import { buildMarketplaceMeshStorageValue } from './meshValue'
import { MarketplaceModuleData } from './types'

/**
 * Extra data carried on Manage Modules when Marketplace also writes mesh.v1.
 */
export type MarketplaceModuleExtraData = {
  /**
   * Serialized mesh.v1 value. When omitted, encode builds defaults from chain
   * services + marketplace contracts (or advanced meshJson).
   */
  meshValue?: string
}

/**
 * On Marketplace enable/edit, also write DAO core storage item `mesh.v1` so any
 * FE can resolveMesh (fixedPrice / auction / contentBase) without hardcoding.
 *
 * Same C4 pattern as Calendar — mesh write is additive; module values still
 * store independently via Manage Modules.
 */
export const editAction: Module<
  MarketplaceModuleData,
  MarketplaceModuleExtraData
>['editAction'] = {
  encode: async ({ data, options, extra }) => {
    if (options.context.type !== ActionContextType.Dao) {
      throw new Error('Invalid context')
    }

    const fixed = data.fixedPriceContract?.trim()
    const auction = data.auctionContract?.trim()
    if (!fixed && !auction) {
      // Incomplete config — skip mesh write until at least one contract is set.
      return []
    }

    const chainId = options.chain.chainId
    const services = getSupportedChainConfig(chainId)?.services ?? {}

    const meshValue =
      extra?.meshValue?.trim() ||
      buildMarketplaceMeshStorageValue({
        chainServices: services,
        data,
        meshJson: data.meshJson,
      })

    const manageStorageItemsAction = new ManageStorageItemsAction(options)
    return [
      manageStorageItemsAction.encode({
        setting: true,
        key: MESH_STORAGE_KEY,
        value: meshValue,
      }),
    ]
  },

  match: async ({ messages, options }) => {
    if (!messages.length) {
      return false
    }
    if (options.context.type !== ActionContextType.Dao) {
      return false
    }

    const manageStorageItemsAction = new ManageStorageItemsAction(options)
    if (!manageStorageItemsAction.match([messages[0]])) {
      return false
    }

    const { setting, key } = manageStorageItemsAction.decode([messages[0]])
    return setting && key === MESH_STORAGE_KEY ? 1 : false
  },

  decode: async ({ messages, options }) => {
    const manageStorageItemsAction = new ManageStorageItemsAction(options)
    const { value } = manageStorageItemsAction.decode([messages[0]])
    return {
      meshValue: value,
    }
  },
}
