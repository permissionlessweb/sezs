import { ActionBase, ClockEmoji } from '@dao-dao/stateless'
import { ModuleId, UnifiedCosmosMsg } from '@dao-dao/types'
import {
  ActionKey,
  ActionMatch,
  ActionOptions,
  ActionContextType,
  ProcessedMessage,
} from '@dao-dao/types/actions'
import {
  MESH_STORAGE_KEY,
  buildCancelEventMsg,
  buildCreateEventMsg,
  buildUpdateEventMsg,
  cancelEventMsgStructure,
  createEventMsgStructure,
  curateMeshBountyBoardRecord,
  getChainAddressForActionOptions,
  getSupportedChainConfig,
  makeExecuteSmartContractMessage,
  maybeMakePolytoneExecuteMessages,
  objectMatchesStructure,
  slugifyBountyBoardKey,
  updateEventMsgStructure,
} from '@dao-dao/utils'

import { ManageStorageItemsAction } from '../ManageStorageItems'
import {
  ManageCalendarEventsComponent,
  ManageCalendarEventsData,
} from './Component'

const parseGroups = (raw: string): string[] =>
  raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)

export class ManageCalendarEventsAction extends ActionBase<ManageCalendarEventsData> {
  public readonly key = ActionKey.ManageCalendarEvents
  public readonly Component = ManageCalendarEventsComponent

  constructor(options: ActionOptions) {
    super(options, {
      Icon: ClockEmoji,
      label: options.t('title.manageCalendarEvents', {
        defaultValue: 'Manage calendar events',
      }),
      description: options.t('info.manageCalendarEventsDescription', {
        defaultValue:
          'Create, update, or cancel events on a dao-calendar contract (proposal-safe).',
      }),
      keywords: ['calendar', 'event', 'schedule', 'nostr', 'mesh'],
    })

    // Prefer Calendar module contract when present
    let calendarContract = ''
    if (options.context.type === ActionContextType.Dao) {
      try {
        const mod = options.context.dao.getModule<{
          calendarContract?: string
        }>(ModuleId.Calendar)
        calendarContract = mod?.values?.calendarContract || ''
      } catch {
        // module not enabled
      }
    }

    this.defaults = {
      mode: 'create',
      calendarContract,
      title: '',
      description: '',
      startTime: '',
      endTime: '',
      managingGroups: '',
      timezone: '',
      eventId: 1,
      registerBountyBoard: true,
      bountyBoardEventId: '',
    }
  }

  encode(data: ManageCalendarEventsData): UnifiedCosmosMsg[] {
    const chainId = this.options.chain.chainId
    const sender =
      getChainAddressForActionOptions(this.options, chainId) ||
      this.options.address
    if (!data.calendarContract) {
      throw new Error('Calendar contract address is required')
    }

    let msg: Record<string, unknown>
    if (data.mode === 'create') {
      msg = buildCreateEventMsg({
        title: data.title,
        description: data.description,
        startTime: data.startTime,
        endTime: data.endTime,
        managingGroups: parseGroups(data.managingGroups),
        timezone: data.timezone || undefined,
      })
    } else if (data.mode === 'update') {
      msg = buildUpdateEventMsg({
        eventId: Number(data.eventId),
        title: data.title || undefined,
        description: data.description || undefined,
        startTime: data.startTime || null,
        endTime: data.endTime || null,
        managingGroups: data.managingGroups
          ? parseGroups(data.managingGroups)
          : null,
        timezone: data.timezone || null,
      })
    } else {
      msg = buildCancelEventMsg(Number(data.eventId))
    }

    const calendarMsgs = maybeMakePolytoneExecuteMessages(
      this.options.chain.chainId,
      chainId,
      makeExecuteSmartContractMessage({
        chainId,
        sender,
        contractAddress: data.calendarContract,
        msg,
      })
    )

    // EN-F6: optional mesh.v1.bounties.boards upsert (same proposal).
    if (
      data.registerBountyBoard &&
      (data.mode === 'create' || data.mode === 'update') &&
      this.options.context.type === ActionContextType.Dao
    ) {
      const boardEventId =
        data.bountyBoardEventId?.trim() ||
        (data.mode === 'update' && data.eventId
          ? String(data.eventId)
          : slugifyBountyBoardKey(data.title || 'event'))

      let existingMeshJson: string | null = null
      try {
        const dao = this.options.context.dao
        const fromInfo = dao?.info?.items?.[MESH_STORAGE_KEY]
        if (typeof fromInfo === 'string' && fromInfo) {
          existingMeshJson = fromInfo
        }
      } catch {
        existingMeshJson = null
      }

      const services = getSupportedChainConfig(chainId)?.services ?? {}
      const meshValue = curateMeshBountyBoardRecord({
        chainServices: services,
        board: {
          eventId: boardEventId,
          title: data.title?.trim() || boardEventId,
          slug: slugifyBountyBoardKey(data.title || boardEventId),
        },
        meshJson: existingMeshJson,
      })

      const manageStorageItemsAction = new ManageStorageItemsAction(
        this.options
      )
      const meshMsgs = manageStorageItemsAction.encode({
        setting: true,
        key: MESH_STORAGE_KEY,
        value: meshValue,
      })

      return [...calendarMsgs, ...meshMsgs]
    }

    return calendarMsgs
  }

  match([{ decodedMessage }]: ProcessedMessage[]): ActionMatch {
    if (
      !objectMatchesStructure(decodedMessage, {
        wasm: {
          execute: {
            contract_addr: {},
            funds: {},
            msg: {},
          },
        },
      })
    ) {
      return false
    }

    const inner = decodedMessage.wasm.execute.msg
    if (objectMatchesStructure(inner, createEventMsgStructure)) return true
    if (objectMatchesStructure(inner, updateEventMsgStructure)) return true
    if (objectMatchesStructure(inner, cancelEventMsgStructure)) return true
    return false
  }

  decode([
    {
      decodedMessage,
    },
  ]: ProcessedMessage[]): ManageCalendarEventsData {
    const contract = decodedMessage.wasm.execute.contract_addr as string
    const msg = decodedMessage.wasm.execute.msg as Record<string, any>

    if ('create_event' in msg) {
      const c = msg.create_event
      return {
        mode: 'create',
        calendarContract: contract,
        title: c.title ?? '',
        description: c.description ?? '',
        startTime: nanosToDatetimeLocal(c.start_time),
        endTime: nanosToDatetimeLocal(c.end_time),
        managingGroups: Array.isArray(c.managing_groups)
          ? c.managing_groups.join(',')
          : '',
        timezone: c.timezone ?? '',
        eventId: 1,
        registerBountyBoard: false,
        bountyBoardEventId: '',
      }
    }

    if ('update_event' in msg) {
      const u = msg.update_event
      return {
        mode: 'update',
        calendarContract: contract,
        title: u.title ?? '',
        description: u.description ?? '',
        startTime: u.start_time ? nanosToDatetimeLocal(u.start_time) : '',
        endTime: u.end_time ? nanosToDatetimeLocal(u.end_time) : '',
        managingGroups: Array.isArray(u.managing_groups)
          ? u.managing_groups.join(',')
          : '',
        timezone: u.timezone ?? '',
        eventId: Number(u.event_id) || 0,
        registerBountyBoard: false,
        bountyBoardEventId: '',
      }
    }

    const c = msg.cancel_event
    return {
      mode: 'cancel',
      calendarContract: contract,
      title: '',
      description: '',
      startTime: '',
      endTime: '',
      managingGroups: '',
      timezone: '',
      eventId: Number(c?.event_id) || 0,
      registerBountyBoard: false,
      bountyBoardEventId: '',
    }
  }
}

/** Best-effort nanos → datetime-local for form display */
function nanosToDatetimeLocal(nanos: string): string {
  try {
    const ms = Number(BigInt(nanos) / 1_000_000n)
    if (!Number.isFinite(ms)) return ''
    const d = new Date(ms)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return ''
  }
}
