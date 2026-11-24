/**
 * DAO-stored variables for the Event Hub module.
 *
 * Design: docs/research/dao-event-ui-orch/STATUS-U0.md §3.1
 * mesh.v1 extensions: docs/research/dao-event-ui-orch/STATUS-U1.md
 */

export type EventHubModuleData = {
  /**
   * Optional markdown intro above the hub.
   */
  description: string
  /**
   * dao-calendar contract (prefer mesh.v1.calendar when empty).
   */
  calendarContract?: string
  /**
   * Ceremony module contract (prefer mesh.v1.ceremony when empty).
   */
  ceremonyContract?: string
  /**
   * When true (default), resolveMesh uses chain headstash defaults if DAO has not published mesh.v1.
   */
  useChainMeshDefault?: boolean
  /**
   * Optional advanced mesh.v1 JSON (prefer DAO storage item mesh.v1).
   */
  meshJson?: string
  /**
   * Embed bases — empty → mesh.embeds / chain services.
   */
  bountiesEmbedBaseUrl?: string
  buzzEmbedBaseUrl?: string
  hermesEmbedBaseUrl?: string
  hermesDeepLinkUrl?: string
  hermesDeepLinkOnly?: boolean
  /**
   * Default event slug when deep-linking from proposal / URL.
   */
  defaultEventSlug?: string
  /**
   * Buzz view for event rooms.
   */
  buzzDefaultView?: 'public' | 'event'
  /**
   * Bounties view for work surface.
   */
  bountiesDefaultView?: 'public' | 'members'
  /**
   * Hermes board / kanban id for facilitators.
   */
  hermesBoardSlug?: string
  /**
   * When true, Buzz may request ADR-36 daoAttest for gated rooms.
   */
  enableDaoAttest?: boolean
  /**
   * Curator event story (checklist C1).
   */
  eventTitle?: string
  eventAudience?: string
  eventCodeOfConductUrl?: string
  /**
   * Registration policy (checklist C4).
   */
  registrationPolicy?: 'open' | 'members' | 'ceremony'
  /**
   * Buzz room gate policy hint written into mesh.eventDefaults.
   */
  buzzGate?: 'public' | 'dao-member' | 'registered'
  /**
   * Hermes visibility policy hint.
   */
  hermesVisibility?: 'only-members' | 'admins' | 'hidden'
}

/**
 * Extra data on Manage Modules when Event Hub also writes mesh.v1.
 */
export type EventHubModuleExtraData = {
  /**
   * Serialized mesh.v1 value. When omitted, encode builds from chain + module fields.
   */
  meshValue?: string
}

/**
 * postMessage protocol envelope for parent ↔ Event Hub shell (future).
 * Individual slots use terp-bounties/v1, terp-buzz/v1, terp-hermes-ops/v1.
 */
export type EventHubBridgeMessageType = 'ready' | 'init' | 'resize' | 'error'

export type EventHubBridgeEnvelope<
  T extends EventHubBridgeMessageType = EventHubBridgeMessageType,
  P = unknown,
> = {
  protocol: 'terp-eventhub/v1'
  type: T
  payload?: P
  requestId?: string
}
