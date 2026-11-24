/**
 * Lab-safe Zcash Login *support* adapters (patterns from ZecHub Hackathon curation).
 *
 * Sources (not product endorsements):
 * - ZecAuth: challenge–response with auth-isolated keys
 * - zns-login / ZecPass: control-proof / capability style after proof
 *
 * Threat bar (t_d0cc7196 / SEC gate):
 * - Never handle seeds, spending keys, or UFVKs
 * - No production "Sign-in with Zcash" claim
 * - Fund/bounty authorize remains a second explicit step
 * - Server must verify; client only builds messages + displays capability envelopes
 *
 * Until a real Orchard/browser curve path exists, proofs are **lab envelopes**:
 * cosmos ADR-36 / signArbitrary stands in as auth-isolated key material for
 * challenge–response demos (ZecAuth-shaped), not Zcash consensus signatures.
 */

import { AUTH_FEATURE_FLAGS } from './authMethods'

export type ZcashAdapterId =
  | 'zcash_zecauth'
  | 'zcash_zns_login'
  | 'zcash_zecpass'

export type ChallengeEnvelope = {
  protocol: 'terp-zcash-login-lab/v0'
  adapter: ZcashAdapterId
  /** Human-readable purpose */
  purpose: 'session' | 'membership_hint' | 'capability'
  chainId: string
  daoAddress?: string
  /** Opaque challenge from app / server */
  nonce: string
  issuedAt: number
  expiresAt: number
  /**
   * UTF-8 message the auth-isolated key should sign (SIWE-like).
   * Never include spending authority instructions.
   */
  message: string
}

export type CapabilityGrant = {
  protocol: 'terp-zcash-login-lab/v0'
  adapter: ZcashAdapterId
  /** Least-privilege scopes — never "spend" or "transfer" */
  scopes: Array<'identify' | 'read_profile' | 'bounties_view' | 'bounties_register_intent'>
  subjectHint: string
  daoAddress?: string
  chainId?: string
  issuedAt: number
  expiresAt: number
  /**
   * Transcript of the challenge response (hex or base64) — for server verify.
   * Not a viewing key.
   */
  proofTranscript: string
  /** Second step still required for funds */
  requiresSecondStepForFunds: true
}

export type AdapterInfo = {
  id: ZcashAdapterId
  label: string
  pattern: 'challenge_response' | 'control_proof' | 'capability'
  referenceUrl: string
  summary: string
}

export const ZCASH_ADAPTER_CATALOG: readonly AdapterInfo[] = [
  {
    id: 'zcash_zecauth',
    label: 'ZecAuth (challenge–response)',
    pattern: 'challenge_response',
    referenceUrl:
      'https://github.com/ZecHub/zechub/tree/main/Hackathon/2026/ZecAuth',
    summary:
      'Auth-isolated key signs a domain-bound challenge (SIWE-like). Lab: cosmos signArbitrary stands in.',
  },
  {
    id: 'zcash_zns_login',
    label: 'zns-login (control proof)',
    pattern: 'control_proof',
    referenceUrl: 'https://github.com/zcashme/zns-login',
    summary:
      'Control / memo-style proof patterns for app login. Lab: capability envelope after challenge.',
  },
  {
    id: 'zcash_zecpass',
    label: 'ZecPass (capability)',
    pattern: 'capability',
    referenceUrl:
      'https://github.com/devacunetixtech/zechub/tree/zecpass-hack26/zecpass-hack26',
    summary:
      'Pass-style capability after proof. Lab: least-privilege grant JSON only — no UFVK.',
  },
] as const

const envTrue = (name: string): boolean =>
  typeof process !== 'undefined' && process.env[name] === 'true'

/** Master + per-adapter flags (lab). */
export const isZcashAdapterFlagOn = (id: ZcashAdapterId): boolean => {
  const per =
    id === 'zcash_zecauth'
      ? AUTH_FEATURE_FLAGS.zcashZecAuth
      : id === 'zcash_zns_login'
        ? AUTH_FEATURE_FLAGS.zcashZnsLogin
        : AUTH_FEATURE_FLAGS.zcashZecPass
  return envTrue(per) || envTrue(AUTH_FEATURE_FLAGS.zcashLogin)
}

/**
 * When true, UI may offer adapter flows as selectable lab demos.
 * Still never production membership for on-chain vote without chain wallet.
 */
export const isZcashLoginLabMode = (): boolean =>
  envTrue('NEXT_PUBLIC_ENABLE_ZCASH_LOGIN_LAB') ||
  (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')

export const buildLoginChallenge = (params: {
  adapter: ZcashAdapterId
  chainId: string
  daoAddress?: string
  nonce?: string
  addressHint?: string
  ttlMs?: number
}): ChallengeEnvelope => {
  const issuedAt = Date.now()
  const ttl = params.ttlMs ?? 5 * 60 * 1000
  const nonce =
    params.nonce ||
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `n-${issuedAt}`)
  const daoLine = params.daoAddress ? `\ndao=${params.daoAddress}` : ''
  const addrLine = params.addressHint ? `\naddr=${params.addressHint}` : ''
  const message = [
    'terp-zcash-login-lab/v0',
    `adapter=${params.adapter}`,
    'purpose=session',
    'NOTE=auth-isolated-only-no-spend',
    `chain_id=${params.chainId}`,
    daoLine.trim(),
    addrLine.trim(),
    `nonce=${nonce}`,
    `exp=${issuedAt + ttl}`,
  ]
    .filter(Boolean)
    .join('\n')

  return {
    protocol: 'terp-zcash-login-lab/v0',
    adapter: params.adapter,
    purpose: 'session',
    chainId: params.chainId,
    daoAddress: params.daoAddress,
    nonce,
    issuedAt,
    expiresAt: issuedAt + ttl,
    message,
  }
}

export const buildCapabilityGrant = (params: {
  adapter: ZcashAdapterId
  proofTranscript: string
  subjectHint: string
  chainId?: string
  daoAddress?: string
  scopes?: CapabilityGrant['scopes']
  ttlMs?: number
}): CapabilityGrant => {
  const issuedAt = Date.now()
  const ttl = params.ttlMs ?? 15 * 60 * 1000
  return {
    protocol: 'terp-zcash-login-lab/v0',
    adapter: params.adapter,
    scopes: params.scopes || [
      'identify',
      'read_profile',
      'bounties_view',
      'bounties_register_intent',
    ],
    subjectHint: params.subjectHint.slice(0, 64),
    daoAddress: params.daoAddress,
    chainId: params.chainId,
    issuedAt,
    expiresAt: issuedAt + ttl,
    proofTranscript: params.proofTranscript.slice(0, 512),
    requiresSecondStepForFunds: true,
  }
}

/** Redact anything that looks like key material from logs. */
export const safeLogAdapterError = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err)
  return raw
    .replace(/secret[^\s]*/gi, '[redacted]')
    .replace(/ufvk[^\s]*/gi, '[redacted]')
    .replace(/spend[^\s]*/gi, '[redacted]')
    .slice(0, 200)
}
