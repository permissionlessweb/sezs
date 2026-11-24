import { MonitorHeartOutlined, MonitorHeartRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { CommunityInfraEditor as Editor } from './CommunityInfraEditor'
import { CommunityInfraRenderer as Renderer } from './CommunityInfraRenderer'
import { DEFAULT_COMMUNITY_INFRA_VALUES } from './constants'
import { CommunityInfraModuleData } from './types'

/**
 * CommunityInfra — admin glass for community instance endpoints.
 * Design: orch/stack-stable-…/gateway/DESIGN-community-infra-monitor-dashboard.md
 * M1: ENDPOINTS-SSOT seed + browser probe matrix (no new hosts, no secrets).
 * M2: multi-instance + location filter + LAB-IMAGE-DIGESTS pins.
 * M3: HermesOps board deep-link + dual-gated residual card spawn (no Akash LIVE).
 */
export const CommunityInfraModule: Module<CommunityInfraModuleData> = {
  id: ModuleId.CommunityInfra,
  title: 'Community Infra',
  description:
    'Per-community multi-instance infra matrix (location, digests, probes). Hermes residual spawn dual-gated; admin/curator glass.',
  Icon: MonitorHeartOutlined,
  IconFilled: MonitorHeartRounded,
  location: ModuleDisplayLocation.Tab,
  visibilityContext: ModuleVisibilityContext.Always,
  isChainSupported: (chainId) =>
    chainId === ChainId.TerpMainnet || chainId === ChainId.TerpTestnet,
  defaultValues: { ...DEFAULT_COMMUNITY_INFRA_VALUES },
  Renderer,
  Editor,
}

export type {
  CommunityInfraModuleData,
  CommunityInfraComponentRow,
  CommunityInfraInstanceConfig,
  CommunityInfraResolvedInstance,
  CommunityInfraDigestPin,
  CommunityInfraLocation,
} from './types'
export {
  DEFAULT_COMMUNITY_INFRA_VALUES,
  DEFAULT_MULTI_INSTANCES,
  LAB_ENDPOINTS_SSOT_SEED,
  LAB_IMAGE_DIGEST_CATALOG,
  DEFAULT_HERMES_BOARD_LABEL,
  DEFAULT_REGISTRY_POINTER,
  formatDigestPin,
  fullDigestRef,
} from './constants'
export {
  buildComponentRows,
  buildResolvedInstances,
  resolveInstances,
  probeComponent,
  probeAllComponents,
  probeResolvedInstances,
} from './probe'
export {
  buildHermesBoardDeepLink,
  buildResidualCardDraft,
  canSpawnResidualForRow,
  advanceResidualGate,
  residualSpawnUnlocked,
} from './hermesBridge'
