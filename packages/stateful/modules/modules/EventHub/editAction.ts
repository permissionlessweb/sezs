import { ActionContextType, Module } from '@dao-dao/types'
import {
  MESH_STORAGE_KEY,
  getSupportedChainConfig,
} from '@dao-dao/utils'

import { ManageStorageItemsAction } from '../../../actions/core/actions/ManageStorageItems'
import { buildEventHubMeshStorageValue } from './meshValue'
import { EventHubModuleData, EventHubModuleExtraData } from './types'

/**
 * On Event Hub enable/edit, write DAO core storage item `mesh.v1` with embeds,
 * ceremony, and eventDefaults (read-merge-write via existing storage when present).
 */
export const editAction: Module<
  EventHubModuleData,
  EventHubModuleExtraData
>['editAction'] = {
  encode: async ({ data, options, extra }) => {
    if (options.context.type !== ActionContextType.Dao) {
      throw new Error('Invalid context')
    }

    const chainId = options.chain.chainId
    const services = getSupportedChainConfig(chainId)?.services ?? {}

    // Preserve existing mesh when possible (sibling marketplace / auth / relays).
    let existingMeshJson: string | null = null
    try {
      const dao = options.context.dao
      const fromInfo = dao?.info?.items?.[MESH_STORAGE_KEY]
      if (typeof fromInfo === 'string' && fromInfo) {
        existingMeshJson = fromInfo
      }
    } catch {
      existingMeshJson = null
    }

    const meshValue =
      extra?.meshValue?.trim() ||
      buildEventHubMeshStorageValue({
        chainServices: services,
        data,
        existingMeshJson,
      })

    // Skip write if we still have no query plane (build would throw) — surface via FE.
    if (!meshValue) {
      return []
    }

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
