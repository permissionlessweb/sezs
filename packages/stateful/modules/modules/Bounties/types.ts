/**
 * DAO-stored variables for the Bounties module (zec-bounties iframe embed).
 *
 * Design: docs/superpowers/specs/2026-07-20-dao-bounties-zec-iframe-design.md
 */
export type BountiesModuleData = {
  /**
   * Optional markdown intro above the embed.
   */
  description: string
  /**
   * Override embed base URL. Empty → chain services.bountiesEmbed → default.
   */
  embedBaseUrl: string
  /**
   * `members` = ADR-36 gated private board; `public` = open catalog + members
   * for private rows.
   */
  defaultView: 'public' | 'members'
  /**
   * Optional chain id override for multi-chain DAOs (defaults to host DAO chain).
   */
  bountiesChainId?: string
}

/**
 * postMessage protocol envelope for parent ↔ zec-bounties embed.
 *
 * Auth capability discovery (multi-auth chooser):
 * - Parent includes `authCapabilities` on `init` (and optional `authCapabilities` type).
 * - Child may send `requestAuthCapabilities` to refresh.
 * - Membership (`requestMembershipProof`) and fund/claim derive (`requestZcashDerive`)
 *   remain **separate** steps — never auto-authorize fund movement from iframe alone.
 */
export type BountiesBridgeMessageType =
  | 'ready'
  | 'init'
  | 'ping'
  | 'handshake'
  | 'requestAuthCapabilities'
  | 'authCapabilities'
  | 'requestMembershipProof'
  | 'membershipProof'
  | 'requestZcashDerive'
  | 'zcashDeriveResult'
  | 'resize'
  | 'navigate'
  | 'error'

export type BountiesBridgeEnvelope<
  T extends BountiesBridgeMessageType = BountiesBridgeMessageType,
  P = unknown,
> = {
  protocol: 'terp-bounties/v1'
  type: T
  payload?: P
  requestId?: string
}
