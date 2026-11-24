/**
 * DAO-stored variables for the HermesOps module (Hermes ops iframe/deep-link).
 *
 * Design: docs/superpowers/specs/2026-07-21-dao-multi-surface-iframe-interop.md
 */
export type HermesOpsModuleData = {
  /**
   * Optional markdown intro above the embed.
   */
  description: string
  /**
   * Override embed base URL. Empty → chain services.hermesEmbed → default.
   * When empty and no chain default, module renders as a deep-link only.
   */
  embedBaseUrl: string
  /**
   * Optional deep-link URL for the Hermes ops surface.
   * Used when embedBaseUrl is not configured (deepLinkOnly mode).
   */
  deepLinkUrl?: string
  /**
   * Default child view: kanban board, gateway status, or system status.
   */
  defaultView: 'kanban' | 'gateway' | 'status'
  /**
   * When true, skip the iframe entirely and show a deep-link button.
   */
  deepLinkOnly: boolean
  /**
   * When true, non-admin members see an operators-only empty state.
   */
  requireAdmin: boolean
}

/**
 * postMessage protocol envelope for parent ↔ Hermes ops embed (`terp-hermes/v1`).
 * Includes operator-context handshake (membership facts only — no secrets).
 */
export type HermesOpsBridgeMessageType =
  | 'ready'
  | 'init'
  | 'requestOperatorContext'
  | 'operatorContext'
  | 'sessionDenied'
  | 'resize'
  | 'navigate'
  | 'error'
  | 'ping'
  | 'handshake'

export type HermesOpsBridgeEnvelope<
  T extends HermesOpsBridgeMessageType = HermesOpsBridgeMessageType,
  P = unknown,
> = {
  protocol: 'terp-hermes/v1'
  type: T
  payload?: P
  requestId?: string
}

/** Alias used by HermesOpsIframeBridge. */
export type HermesBridgeEnvelope = HermesOpsBridgeEnvelope