import { ActionContextType, Module } from '@dao-dao/types'
import {
  MESH_STORAGE_KEY,
  getSupportedChainConfig,
} from '@dao-dao/utils'

import { ManageStorageItemsAction } from '../../../actions/core/actions/ManageStorageItems'
import { buildCalendarMeshStorageValue } from './meshValue'
import { CalendarModuleData } from './types'

/**
 * Extra data carried on Manage Modules when Calendar also writes mesh.v1.
 */
export type CalendarModuleExtraData = {
  /**
   * Serialized mesh.v1 value. When omitted, encode builds defaults from chain
   * services + calendarContract (or advanced meshJson).
   */
  meshValue?: string
}

/**
 * On Calendar enable/edit, also write DAO core storage item `mesh.v1` so any FE
 * can resolveMesh without hardcoding headstash endpoints.
 */
export const editAction: Module<
  CalendarModuleData,
  CalendarModuleExtraData
>['editAction'] = {
  encode: async ({ data, options, extra }) => {
    if (options.context.type !== ActionContextType.Dao) {
      throw new Error('Invalid context')
    }

    const calendarContract = data.calendarContract?.trim()
    if (!calendarContract) {
      // Incomplete module config — ManageModules still stores module values;
      // skip mesh write until a calendar address is set.
      return []
    }

    const chainId = options.chain.chainId
    const services = getSupportedChainConfig(chainId)?.services ?? {}

    const meshValue =
      extra?.meshValue?.trim() ||
      buildCalendarMeshStorageValue({
        chainServices: services,
        calendarContract,
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
