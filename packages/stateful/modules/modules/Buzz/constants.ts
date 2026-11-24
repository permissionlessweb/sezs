/**
 * Default hosts for Terp Buzz embed / NOSA relayer.
 * Overridable via module vars, mesh.v1, or chain `services.buzzEmbed`.
 *
 * Identity plane: **Nostr** inside child. Parent optional ADR-36 daoAttest is
 * membership eligibility only — never mint nsec or pass bounty JWT.
 *
 * Lab topology (event-night): see
 * docs/superpowers/orch/event-night-2026-08-07/NOSTR-ENV.md
 * Design: docs/superpowers/specs/2026-07-21-dao-multi-surface-iframe-interop.md
 */
export const DEFAULT_BUZZ_EMBED = 'https://buzz.terp.network'

/**
 * Lab defaults for the informational Buzz tab (HTTP + WSS).
 * Prefer env (`NEXT_PUBLIC_BUZZ_EMBED` / `NEXT_PUBLIC_BUZZ_WSS`) or module vars.
 * Event-night live surface on build-host: :3001 (buzz-prod). Canonical when up: deploy-host:3000.
 */
/**
 * Lab / chain fallback HTTP for relayer status (BuzzRenderer).
 * Prefer module `relayerHttpUrl` / `embedBaseUrl` / chain services.buzzEmbed.
 * Env → local lab (:3001) → public embed origin.
 */
export const DEFAULT_BUZZ_HTTP =
  (typeof process !== 'undefined' &&
    process.env?.NEXT_PUBLIC_BUZZ_EMBED?.trim()) ||
  'http://127.0.0.1:3001'

/** Lab / chain fallback WSS for clients. */
export const DEFAULT_BUZZ_WSS =
  (typeof process !== 'undefined' &&
    process.env?.NEXT_PUBLIC_BUZZ_WSS?.trim()) ||
  'ws://127.0.0.1:3001'

/** Operator-facing connect steps (Nostr plane only — not ADR-36 / bounties JWT). */
export const BUZZ_CONNECT_STEPS: string[] = [
  'Phone: scan the QR under Mobile / pairing, or tap Open Buzz (new tab).',
  'Desktop: open Buzz in a new tab or point a NOSA client at the WSS URL.',
  'Identity is Nostr inside Buzz — not ADR-36 wallet login and not bounties JWT.',
  'Optional: parent DAO may offer ADR-36 daoAttest for gated rooms only.',
  'Never paste nsec, Hermes tokens, or bounty JWT into public channels or kanban comments.',
]

/** postMessage protocol version shared with the Buzz embed FE. */
export const BUZZ_PROTOCOL_VERSION = 'terp-buzz/v1' as const

/**
 * Build canonical ADR-36 daoAttest message bytes (parent signs; eligibility only).
 * Protocol: terp-buzz/v1
 * ```
 * terp-buzz/v1/dao-attest
 * chain_id=…
 * dao=…
 * addr=…
 * nonce=…
 * purpose=…
 * exp=…
 * ```
 */
export const buildBuzzDaoAttestMessage = ({
  chainId,
  daoAddress,
  addr,
  nonce,
  purpose,
  exp,
}: {
  chainId: string
  daoAddress: string
  addr: string
  nonce: string
  purpose: string
  exp: number
}): string =>
  [
    `${BUZZ_PROTOCOL_VERSION}/dao-attest`,
    `chain_id=${chainId}`,
    `dao=${daoAddress}`,
    `addr=${addr}`,
    `nonce=${nonce}`,
    `purpose=${purpose}`,
    `exp=${exp}`,
  ].join('\n')

/** Default daoAttest proof lifetime (seconds) when child does not specify. */
export const BUZZ_DAO_ATTEST_EXP_SECONDS = 15 * 60

/** Minimum iframe height before resize messages. */
export const BUZZ_IFRAME_MIN_HEIGHT = 640

/**
 * How long the parent waits for child `ready` before labeling HOST_UNREACHABLE.
 * Soft timeout only — iframe stays mounted so late handshakes still work.
 */
export const BUZZ_READY_TIMEOUT_MS = 12_000