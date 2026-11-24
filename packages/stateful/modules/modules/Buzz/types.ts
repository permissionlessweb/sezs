/**
 * DAO-stored variables for the Buzz module (community coordination iframe).
 *
 * Design: docs/superpowers/specs/2026-07-21-dao-multi-surface-iframe-interop.md §5.1
 */
export type BuzzModuleData = {
  /**
   * Optional markdown intro above the embed / relayer panel.
   */
  description: string
  /**
   * Override embed base URL. Empty → chain services.buzzEmbed → default.
   * Also used as HTTP fallback when relayerHttpUrl is empty.
   */
  embedBaseUrl: string
  /**
   * Explicit NOSA / Buzz relay HTTP base (health + open link).
   * Empty → embedBaseUrl → chain / env defaults.
   */
  relayerHttpUrl?: string
  /**
   * Explicit Nostr WSS for clients. Empty → derived from HTTP or chain WSS.
   */
  relayerWssUrl?: string
  /**
   * Optional community / room id for open-URL query params.
   */
  communityId?: string
  /**
   * Optional operator-facing display name for the relayer panel.
   */
  displayName?: string
  /**
   * Default child view: public rooms, event surface, or admin tools.
   */
  defaultView: 'public' | 'event' | 'admin'
  /**
   * When true, child may request ADR-36 daoAttest for gated rooms / admin tools.
   * Membership eligibility only — not a Buzz/Nostr login replacement.
   */
  enableDaoAttest: boolean
}

/**
 * postMessage protocol envelope for parent ↔ Buzz embed (`terp-buzz/v1`).
 * Never mix with `terp-bounties/v1` JWT or Hermes tokens.
 */
export type BuzzBridgeMessageType =
  | 'ready'
  | 'init'
  | 'requestDaoAttest'
  | 'daoAttest'
  | 'daoAttestDenied'
  | 'resize'
  | 'navigate'
  | 'error'
  | 'ping'
  | 'handshake'

export type BuzzBridgeEnvelope<
  T extends BuzzBridgeMessageType = BuzzBridgeMessageType,
  P = unknown,
> = {
  protocol: 'terp-buzz/v1'
  type: T
  payload?: P
  requestId?: string
}
