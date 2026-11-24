import { CalendarMonthOutlined, CalendarMonthRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { CalendarEditor as Editor } from './CalendarEditor'
import { CalendarRenderer as Renderer } from './CalendarRenderer'
import { CalendarModuleExtraData, editAction } from './editAction'
import { CalendarModuleData } from './types'

/**
 * DAO Calendar / Noster-style scheduled events.
 * Events may be NFT-backed on-chain (dao-calendar) but UI leads with calendar UX.
 * code_id 32 injected from terp-state as daoCalendar.
 *
 * Enable/edit also writes DAO storage mesh.v1 (headstash defaults + calendar).
 * Contract types: @dao-dao/types/contracts/DaoCalendar (cwgen from production schema).
 */
export const CalendarModule: Module<
  CalendarModuleData,
  CalendarModuleExtraData
> = {
  id: ModuleId.Calendar,
  title: 'Calendar',
  description:
    'Schedule and browse DAO events. Propose to enable; manages mesh.v1 for off-chain discovery.',
  Icon: CalendarMonthOutlined,
  IconFilled: CalendarMonthRounded,
  location: ModuleDisplayLocation.Tab,
  visibilityContext: ModuleVisibilityContext.Always,
  isChainSupported: (chainId) =>
    chainId === ChainId.TerpMainnet || chainId === ChainId.TerpTestnet,
  defaultValues: {
    // Lab 120u-1 defaults (overridden by widget / inject when set)
    calendarContract:
      typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CALENDAR
        ? process.env.NEXT_PUBLIC_CALENDAR
        : 'terp1lstuws59hjswletwmskefdajhq76pz9tlfq84perndemrzztda0q6qnacs',
    description: '',
    useChainMeshDefault: true,
    meshJson: '',
  },
  Renderer,
  Editor,
  editAction,
}

export type { CalendarModuleData } from './types'
export type { CalendarModuleExtraData } from './editAction'
