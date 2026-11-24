import { ImageOutlined, ImageRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { InfusionsEditor as Editor } from './InfusionsEditor'
import { InfusionsRenderer as Renderer } from './InfusionsRenderer'
import { InfusionModuleData } from './types'

export const InfusionsModule: Module<InfusionModuleData> = {
  id: ModuleId.Infusions,
  Icon: ImageOutlined,
  title: 'Infusions',
  description:
    'Burn-to-mint NFT infusions — create and execute bundles via the same action heuristics as other DAO modules.',
  IconFilled: ImageRounded,
  location: ModuleDisplayLocation.Home,
  visibilityContext: ModuleVisibilityContext.Always,
  // Infuser is deployed on Terp; allow other chains when code_ids appear later.
  isChainSupported: (chainId) =>
    chainId === ChainId.TerpMainnet || chainId === ChainId.JunoMainnet,
  defaultValues: {
    chainId: ChainId.TerpMainnet,
    infusionId: '1',
    // Demo/default minter used by existing Terp UI; override in module editor.
    infusionMinter:
      'terp1xjgagje7l8qjpv0zgf7zml5qre5mhh29dcwl5f8gf68rz56t9mgqusz8ls',
    fieldNamePrefix: 'infusion.',
  },
  Renderer,
  Editor,
}
