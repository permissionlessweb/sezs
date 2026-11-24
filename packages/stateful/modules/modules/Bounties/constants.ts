/**
 * Default hosts for the Terp zec-bounties fork (D2 locked).
 * Overridable via module `embedBaseUrl` or chain `services.bounties*`.
 *
 * Empty module `embedBaseUrl` → chain `services.bountiesEmbed` → DEFAULT_BOUNTIES_EMBED
 * (see BountiesRenderer.resolveEmbedBase). API base similarly falls through to
 * DEFAULT_BOUNTIES_API in BountiesIframeBridge.
 *
 * Fork API contract (auth plane):
 *   GET  /auth/adr36/challenge?dao=&chainId=  → { nonce, exp?, messageTemplate? }
 *   POST /auth/adr36/verify                   → JWT (bountyPk claim when derived)
 * Design: docs/superpowers/specs/2026-07-20-dao-bounties-zec-iframe-design.md §B5–B6
 *
 * Ops: production parent origins (this app’s host) must be listed in the
 * zec-bounties API `EMBED_PARENT_ORIGINS` / FE frame-ancestors allowlist, or
 * match the documented defaults (daodao.terp.network, dao.terp.network,
 * daodao.zone, dao.daodao.zone, bounties.terp.network).
 */
export const DEFAULT_BOUNTIES_EMBED = 'https://bounties.terp.network'
export const DEFAULT_BOUNTIES_API = 'https://bounties-api.terp.network'

/** postMessage / ADR-36 protocol version shared with the embed FE. */
export const BOUNTIES_PROTOCOL_VERSION = 'terp-bounties/v1' as const

/** Default login proof lifetime (seconds) when child does not specify. */
export const BOUNTIES_LOGIN_EXP_SECONDS = 15 * 60

/** Minimum iframe height before resize messages. */
export const BOUNTIES_IFRAME_MIN_HEIGHT = 640

/**
 * How long the parent waits for child `ready` before labeling HOST_UNREACHABLE.
 * Soft timeout only — iframe stays mounted so late handshakes still work.
 */
export const BOUNTIES_READY_TIMEOUT_MS = 12_000
