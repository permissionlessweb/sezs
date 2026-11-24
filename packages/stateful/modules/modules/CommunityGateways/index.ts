import { HubOutlined, HubRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { CommunityGatewaysEditor as Editor } from './CommunityGatewaysEditor'
import { CommunityGatewaysRenderer as Renderer } from './CommunityGatewaysRenderer'
import {
  DEFAULT_COMMUNITY_GATEWAYS_DESCRIPTION,
  LAB_STARTER_GATEWAYS,
} from './constants'
import { CommunityGatewaysModuleData } from './types'

/**
 * Unified Buzz + Hermes gateway guide for DAO users.
 * Phase 0: directory + connect steps only (no Hermes dashboard iframe).
 */
export const CommunityGatewaysModule: Module<CommunityGatewaysModuleData> = {
  id: ModuleId.CommunityGateways,
  title: 'Community gateways',
  description:
    'Buzz + Hermes in one place: public and registered gateway links, plus steps to connect. Hermes dashboards are not embedded yet.',
  Icon: HubOutlined,
  IconFilled: HubRounded,
  location: ModuleDisplayLocation.Tab,
  visibilityContext: ModuleVisibilityContext.Always,
  isChainSupported: (chainId) =>
    chainId === ChainId.TerpMainnet ||
    chainId === ChainId.TerpTestnet ||
    chainId === '120u-1',
  defaultValues: {
    description: DEFAULT_COMMUNITY_GATEWAYS_DESCRIPTION,
    useChainMeshDefault: true,
    meshJson: '',
    gateways: LAB_STARTER_GATEWAYS,
    showBuzzSteps: true,
    showHermesSteps: true,
  },
  Renderer,
  Editor,
}

export type { CommunityGatewaysModuleData, GatewayEntry } from './types'
export {
  resolveGatewayDirectory,
  gatewaysFromMesh,
  partitionGateways,
} from './resolveGateways'
