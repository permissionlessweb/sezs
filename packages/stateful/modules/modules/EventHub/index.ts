import { ViewModuleOutlined, ViewModuleRounded } from '@mui/icons-material'

import {
  ChainId,
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { EventHubEditor as Editor } from './EventHubEditor'
import { EventHubRenderer as Renderer } from './EventHubRenderer'
import { editAction } from './editAction'
import { EventHubModuleData, EventHubModuleExtraData } from './types'

/**
 * DAO Event Hub — unified event-centric compose tab.
 *
 * Composes Calendar, Bounties, Buzz, and HermesOps into a single tab
 * with event selection, participation status chips, and iframe surface
 * slots. No new wallet stack — all identity comes from the parent DAO.
 *
 * Visibility: Always (public event view). Hermes ops slot is gated to
 * members within the renderer.
 *
 * Design: docs/research/dao-event-ui-orch/S-dao-event-ui-orchestration.md
 * Iframe interop: docs/superpowers/specs/2026-07-21-dao-multi-surface-iframe-interop.md
 */
export const EventHubModule: Module<
  EventHubModuleData,
  EventHubModuleExtraData
> = {
  id: ModuleId.EventHub,
  title: 'Event Hub',
  description:
    'Unified event-centric tab: calendar, participation status, bounties work surface, Buzz collab, and Hermes ops. Composes existing modules — no new wallet stack.',
  Icon: ViewModuleOutlined,
  IconFilled: ViewModuleRounded,
  location: ModuleDisplayLocation.Tab,
  visibilityContext: ModuleVisibilityContext.Always,
  // TerpMainnet + local/test (ict-rs localterp chain_id 120u-1).
  isChainSupported: (chainId) =>
    chainId === ChainId.TerpMainnet || chainId === ChainId.TerpTestnet,
  defaultValues: {
    description: '',
    calendarContract: '',
    ceremonyContract: '',
    useChainMeshDefault: true,
    meshJson: '',
    bountiesEmbedBaseUrl: '',
    buzzEmbedBaseUrl: '',
    hermesEmbedBaseUrl: '',
    hermesDeepLinkUrl: '',
    hermesDeepLinkOnly: true,
    hermesBoardSlug: '',
    defaultEventSlug: '',
    buzzDefaultView: 'event',
    bountiesDefaultView: 'members',
    enableDaoAttest: true,
    eventTitle: '',
    eventAudience: '',
    eventCodeOfConductUrl: '',
    registrationPolicy: 'members',
    buzzGate: 'dao-member',
    hermesVisibility: 'only-members',
  },
  Renderer,
  Editor,
  editAction,
}

export type { EventHubModuleData, EventHubModuleExtraData } from './types'
export { buildEventHubMeshStorageValue } from './meshValue'
export { buildParticipationChips } from './components/EventParticipationStatus'
export {
  evaluateRegistrationBountyGate,
  shouldShowRegistrationBountyPending,
} from './registrationBountyGate'
export type {
  RegistrationBountyGate,
  RegistrationBountyGateCode,
} from './registrationBountyGate'
export {
  EVENT_HUB_SLOT_MIN_HEIGHT,
  EVENTHUB_IFRAME_MIN_HEIGHT,
  EVENT_HUB_CALENDAR_MIN_HEIGHT,
  EVENT_HUB_SURFACE_TABS,
  EVENTHUB_PROTOCOL_VERSION,
} from './constants'
export type { EventHubSurfaceTab } from './constants'
