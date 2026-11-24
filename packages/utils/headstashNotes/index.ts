/**
 * Headstash private notes client (Phase A pure TS).
 *
 * HTTP: list / put / get / pir against hash-market HeadstashStore.
 * Crypto: XChaCha20-Poly1305 envelope (client-only decrypt).
 * Recover: prefer PIR when multi-note; safe dest-binding summary.
 */

export * from './types'
export * from './hex'
export * from './selector'
export * from './crypto'
export * from './client'
export * from './auth'
export * from './recover'
