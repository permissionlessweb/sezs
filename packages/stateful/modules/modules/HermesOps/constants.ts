/**
 * Default host for the Hermes ops embed.
 * Overridable via module embedBaseUrl or chain services.hermesEmbed.
 *
 * Protocol: terp-hermes/v1
 * Spec: docs/superpowers/specs/2026-07-21-dao-multi-surface-iframe-interop.md
 */
export const DEFAULT_HERMES_OPS_EMBED = 'https://ops.terp.network'

/** Alias for embed base URL. */
export const DEFAULT_HERMES_EMBED = DEFAULT_HERMES_OPS_EMBED

/**
 * Gateway HTTP fallback for HermesOpsRenderer (module → chain → env → default).
 */
export const DEFAULT_HERMES_GATEWAY =
  (typeof process !== 'undefined' &&
    process.env?.NEXT_PUBLIC_HERMES_OPS_URL?.trim()) ||
  DEFAULT_HERMES_OPS_EMBED

/** Operator-facing connect steps under DevOps disclosure. */
export const HERMES_CONNECT_STEPS: string[] = [
  'Open Hermes Ops in a new tab (button above) when a gateway URL is configured.',
  'Use operator credentials only — never paste mnemonics or bounty JWTs into Hermes.',
  'Gateway status is informational in SDA; full agent control stays in the Hermes client.',
  'Identity planes stay separate: Hermes session ≠ ADR-36 wallet ≠ Nostr nsec.',
]

/** Default deep-link URL for Hermes ops when no embed is configured. */
export const DEFAULT_HERMES_DEEP_LINK = 'https://ops.terp.network/dao/...'

/**
 * postMessage protocol version shared with the Hermes ops embed FE.
 * Spec-locked: `terp-hermes/v1` (not bounties/buzz; not a collapsed shared protocol).
 */
export const HERMES_OPS_PROTOCOL_VERSION = 'terp-hermes/v1' as const

/** Alias for protocol string matching. */
export const HERMES_PROTOCOL_VERSION = HERMES_OPS_PROTOCOL_VERSION

/** Minimum iframe height before resize messages. */
export const HERMES_OPS_IFRAME_MIN_HEIGHT = 400

/**
 * How long the parent waits for child `ready` before labeling HOST_UNREACHABLE.
 * Soft timeout only — iframe stays mounted so late handshakes still work.
 */
export const HERMES_OPS_READY_TIMEOUT_MS = 12_000

/**
 * Operator context payload lifetime (seconds) for non-secret membership facts.
 * Never used for API keys or session secrets.
 */
export const HERMES_OPERATOR_CONTEXT_EXP_SECONDS = 15 * 60