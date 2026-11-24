import { ActionContextType, Module } from '@dao-dao/types'
import { MESH_STORAGE_KEY, getSupportedChainConfig } from '@dao-dao/utils'

import { ManageStorageItemsAction } from '../../../actions/core/actions/ManageStorageItems'
import { buildCollabOpsMeshStorageValue } from './meshValue'
import { CollabOpsModuleData } from './types'

/**
 * On CollabOps enable/edit, write DAO core storage `mesh.v1` with collab embeds
 * (merge-safe with marketplace / calendar siblings).
 */
export const editAction: Module<CollabOpsModuleData>['editAction'] = {
  encode: async ({ data, options }) => {
    if (options.context.type !== ActionContextType.Dao) {
      throw new Error('Invalid context')
    }

    const chainId = options.chain.chainId
    const services = getSupportedChainConfig(chainId)?.services ?? {}

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

    const meshValue = buildCollabOpsMeshStorageValue({
      chainServices: services,
      data,
      existingMeshJson,
    })

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
      data: {
        description: '',
        buzzEmbedBaseUrl: '',
        buzzDefaultView: 'public',
        enableDaoAttest: true,
        hermesEmbedBaseUrl: '',
        hermesDeepLinkUrl: '',
        hermesDeepLinkOnly: true,
        hermesBoardSlug: '',
        privateVisibility: 'only-members',
        defaultPlane: 'public',
        useChainMeshDefault: true,
        meshJson: typeof value === 'string' ? value : '',
        showLiveEmbeds: false,
      },
    }
  },
}
