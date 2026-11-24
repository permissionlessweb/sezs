import { nanoid } from 'nanoid'

import { SITE_URL } from './constants'
import {
  DEFAULT_GIFT_PREAUTH_ACTIONS,
  GiftPreauthActionId,
  isGiftPreauthActionId,
} from './giftFeegrant'

/** PFPK token audience for DAO onboarding invites. */
export const ONBOARDING_PFPK_AUDIENCE = 'dao-dao-onboarding'
/** Role marking a one-time invite token (vs long-lived admin tokens). */
export const ONBOARDING_INVITE_ROLE = 'onboarding_invite'
/** Role after passkey bind / migration complete. */
export const ONBOARDING_BOUND_ROLE = 'onboarding_bound'

export type OnboardingInvitePayload = {
  /** Invite id (local + token name). */
  id: string
  /** DAO core address that issued the invite (optional context). */
  dao?: string
  /** Chain for the ephemeral + target account. */
  chainId: string
  /** Human label for the invite. */
  label?: string
  /** Unix ms when created. */
  createdAt: number
  /** Optional expiry (unix ms). */
  expiresAt?: number
  /**
   * Auth plane for step 1 of two-step auth.
   * - pfpk: redeem JWT via PFPK
   * - oidc: Web3Auth / OIDC provider (same UI path, different wallet bootstrap)
   */
  authPlane: 'pfpk' | 'oidc'
  /**
   * After claim, automation should migrate ephemeral key material to a durable
   * account (registerPublicKeys / allowance). Interactive UX stays minimal.
   */
  autoMigrate: boolean
  /**
   * Feegrant preauth actions selected at gift generation (catalog ids).
   * Used to build AllowedMsgAllowance for the fresh wallet — selected only.
   */
  preauthActions?: GiftPreauthActionId[]
  /**
   * Optional native spend limit for feegrant gas (amount as base units string).
   * Does not fund the wallet — only caps granter-paid fees.
   */
  feegrantSpendLimit?: { denom: string; amount: string }
  /**
   * Optional grantee (fresh wallet) known at generation time for feegrant draft.
   */
  preauthGrantee?: string
}

export type OnboardingClaimState = {
  invite: OnboardingInvitePayload
  /** Opaque PFPK/OIDC token from the link (one-time). */
  token: string
  /** Ephemeral bech32 address generated for this claim (if any). */
  ephemeralAddress?: string
  /** Hex pubkey for ephemeral wallet. */
  ephemeralPublicKeyHex?: string
  /** Passkey credential id (WebAuthn) once bound. */
  passkeyCredentialId?: string
  /** Durable address after automated migration. */
  migratedAddress?: string
  status:
    | 'pending'
    | 'ephemeral_created'
    | 'passkey_bound'
    | 'migrating'
    | 'complete'
    | 'error'
  error?: string
}

const CLAIM_STORAGE_PREFIX = 'dao-dao:onboarding:claim:'

/**
 * Build a shareable onboarding URL for the dapp.
 * Path is `/onboard` — apps can route or deep-link to the Onboarding module.
 */
export const buildOnboardingInviteUrl = ({
  token,
  invite,
  baseUrl = typeof SITE_URL === 'string' ? SITE_URL : '',
}: {
  token: string
  invite: OnboardingInvitePayload
  baseUrl?: string
}): string => {
  const origin = baseUrl?.replace(/\/$/, '') || ''
  const params = new URLSearchParams({
    t: token,
    invite: invite.id,
    chain: invite.chainId,
    auth: invite.authPlane,
  })
  if (invite.dao) {
    params.set('dao', invite.dao)
  }
  if (invite.autoMigrate) {
    params.set('migrate', '1')
  }
  // Compact payload for claim page (base64url JSON).
  const payload = encodeInvitePayload(invite)
  params.set('p', payload)
  return `${origin}/onboard?${params.toString()}`
}

export const encodeInvitePayload = (invite: OnboardingInvitePayload): string => {
  const json = JSON.stringify(invite)
  if (typeof btoa === 'function') {
    return btoa(json)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }
  return Buffer.from(json, 'utf8').toString('base64url')
}

export const decodeInvitePayload = (
  encoded: string
): OnboardingInvitePayload | null => {
  try {
    let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4) {
      b64 += '='
    }
    const json =
      typeof atob === 'function'
        ? atob(b64)
        : Buffer.from(b64, 'base64').toString('utf8')
    return JSON.parse(json) as OnboardingInvitePayload
  } catch {
    return null
  }
}

export const parseOnboardingQuery = (
  search: string | URLSearchParams
): {
  token?: string
  invite?: OnboardingInvitePayload
  chainId?: string
  dao?: string
  autoMigrate: boolean
} => {
  const params =
    typeof search === 'string'
      ? new URLSearchParams(
          search.startsWith('?') ? search.slice(1) : search
        )
      : search

  const token = params.get('t') || undefined
  const payload = params.get('p')
  const invite = payload ? decodeInvitePayload(payload) : null
  const chainId = params.get('chain') || invite?.chainId || undefined
  const dao = params.get('dao') || invite?.dao || undefined
  const autoMigrate =
    params.get('migrate') === '1' || invite?.autoMigrate === true

  return {
    token,
    invite: invite || undefined,
    chainId,
    dao,
    autoMigrate,
  }
}

export const createInviteDraft = (partial: {
  chainId: string
  dao?: string
  label?: string
  authPlane?: 'pfpk' | 'oidc'
  autoMigrate?: boolean
  ttlMs?: number
  preauthActions?: GiftPreauthActionId[]
  feegrantSpendLimit?: { denom: string; amount: string }
  preauthGrantee?: string
}): OnboardingInvitePayload => {
  const createdAt = Date.now()
  const ttlMs = partial.ttlMs ?? 7 * 24 * 60 * 60 * 1000
  const preauthActions = (
    partial.preauthActions ?? DEFAULT_GIFT_PREAUTH_ACTIONS
  ).filter(isGiftPreauthActionId)
  return {
    id: nanoid(12),
    chainId: partial.chainId,
    dao: partial.dao,
    label: partial.label || `Invite ${new Date(createdAt).toLocaleDateString()}`,
    createdAt,
    expiresAt: createdAt + ttlMs,
    authPlane: partial.authPlane || 'pfpk',
    autoMigrate: partial.autoMigrate ?? true,
    preauthActions,
    feegrantSpendLimit: partial.feegrantSpendLimit,
    preauthGrantee: partial.preauthGrantee?.trim() || undefined,
  }
}

export const saveClaimState = (state: OnboardingClaimState): void => {
  if (typeof localStorage === 'undefined') {
    return
  }
  localStorage.setItem(
    CLAIM_STORAGE_PREFIX + state.invite.id,
    JSON.stringify(state)
  )
}

export const loadClaimState = (
  inviteId: string
): OnboardingClaimState | null => {
  if (typeof localStorage === 'undefined') {
    return null
  }
  const raw = localStorage.getItem(CLAIM_STORAGE_PREFIX + inviteId)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as OnboardingClaimState
  } catch {
    return null
  }
}

/**
 * Token name encoding so sponsors can list invites from PFPK fetchTokens.
 * Format: onboard:<inviteId>:<label>
 */
export const formatInviteTokenName = (
  invite: OnboardingInvitePayload
): string =>
  `onboard:${invite.id}:${(invite.label || 'invite').slice(0, 48)}`

export const parseInviteTokenName = (
  name: string | null | undefined
): { inviteId: string; label: string } | null => {
  if (!name || !name.startsWith('onboard:')) {
    return null
  }
  const parts = name.split(':')
  if (parts.length < 3) {
    return null
  }
  return {
    inviteId: parts[1],
    label: parts.slice(2).join(':'),
  }
}
