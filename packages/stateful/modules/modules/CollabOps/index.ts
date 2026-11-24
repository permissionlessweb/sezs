import { HubOutlined, HubRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { CollabOpsEditor as Editor } from './CollabOpsEditor'
import { CollabOpsRenderer as Renderer } from './CollabOpsRenderer'
import { editAction } from './editAction'
import { CollabOpsModuleData } from './types'

/**
 * Collab & Ops — unified Buzz (public) + Hermes (private) **info** surface.
 * EN-F2 / t_8365ea2e: mesh.v1 endpoints + Nostr-compatible discovery payload;
 * de-emphasize dual Buzz/Hermes product tabs for visitors.
 */
export const CollabOpsModule: Module<CollabOpsModuleData> = {
  id: ModuleId.CollabOps,
  title: 'Collab & Ops',
  description:
    'Unified public collab (Buzz) and private ops (Hermes) from mesh.v1. Prefer this over separate Buzz / Hermes Ops tabs. Private content is member-gated.',
  Icon: HubOutlined,
  IconFilled: HubRounded,
  location: ModuleDisplayLocation.Tab,
  visibilityContext: ModuleVisibilityContext.Always,
  isChainSupported: (chainId) =>
    chainId === ChainId.TerpMainnet || chainId === ChainId.TerpTestnet,
  defaultValues: {
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
    meshJson: '',
    showLiveEmbeds: false,
  },
  Renderer,
  Editor,
  editAction,
}

export type { CollabOpsModuleData, CollabOpsPlaneId } from './types'
export {
  canShowPrivatePlane,
  resolveActivePlane,
  privatePlaneLegendState,
  visiblePlaneTabs,
} from './planes'
export { COLLAB_OPS_PLANES, COLLAB_OPS_SLOT_MIN_HEIGHT } from './constants'
export { buildCollabEndpoints } from './collabEndpoints'
export { buildCollabOpsMeshStorageValue } from './meshValue'
