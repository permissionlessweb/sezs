import { HubOutlined, HubRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { IbcEditor as Editor } from './IbcEditor'
import { IbcRenderer as Renderer } from './IbcRenderer'
import { IbcModuleData } from './types'

/**
 * IBC ops dashboard for DAOs — channels from terp-state, foundation relayer
 * deposits, and swap entry aligned with Spend / Skip action heuristics.
 */
export const IbcModule: Module<IbcModuleData> = {
  id: ModuleId.Ibc,
  title: 'IBC',
  description:
    'Live IBC channels, foundation relayer gas deposits, and cross-chain transfer entry points.',
  Icon: HubOutlined,
  IconFilled: HubRounded,
  location: ModuleDisplayLocation.Tab,
  visibilityContext: ModuleVisibilityContext.Always,
  isChainSupported: (chainId) => chainId === ChainId.TerpMainnet,
  defaultValues: {
    description: '',
    showRelayerFund: true,
    showSwapTab: true,
  },
  Renderer,
  Editor,
}

export type { IbcModuleData } from './types'
