/**
 * Unified Buzz + Hermes gateway directory (informational).
 *
 * Phase 0: links + connect steps only — no Hermes dashboard iframe, no
 * operator kanban shell. Live collab embeds stay on Event Hub slots when needed.
 */

export type GatewayKind = 'buzz' | 'hermes'

export type GatewayVisibility =
  | 'public'
  | 'registered'
  | 'members'
  | 'operators'

/**
 * One gateway a DAO publishes for members/visitors to open externally.
 */
export type GatewayEntry = {
  /** Stable id within module config (slug). */
  id: string
  kind: GatewayKind
  /** Human label (e.g. "Lab Buzz embed", "Community Hermes"). */
  label: string
  /**
   * Primary open URL (HTTPS preferred).
   * Buzz: embed UI or client deep-link. Hermes: gateway/status page — not SDA iframe.
   */
  url: string
  /** Optional Nostr WSS for Buzz (relay plane; never use as iframe src). */
  relayWss?: string
  visibility: GatewayVisibility
  /** Short note shown under the link. */
  note?: string
}

export type CommunityGatewaysModuleData = {
  /** Optional markdown intro above the directory. */
  description: string
  /**
   * When true, merge mesh.v1 embeds.buzz / embeds.hermes / relays into the list
   * (registered mesh gateways) in addition to explicit entries.
   */
  useChainMeshDefault: boolean
  /** Optional advanced mesh JSON override (same shape as mesh.v1 fragment). */
  meshJson?: string
  /** Curator-registered gateways (DAO widget storage). */
  gateways: GatewayEntry[]
  /** Show Buzz connect steps (Nostr client / key hygiene). */
  showBuzzSteps: boolean
  /** Show Hermes connect steps (profile / ACP / board deep-link). */
  showHermesSteps: boolean
}
