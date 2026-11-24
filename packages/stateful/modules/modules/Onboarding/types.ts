import { GiftPreauthActionId } from '@dao-dao/utils'

/**
 * DAO module variables for sharable gift / onboarding links.
 * Sponsors mint one-time PFPK (or OIDC) invite tokens; claimants generate an
 * ephemeral wallet, bind a passkey, and optionally auto-migrate to a durable
 * account via automated interactivity behind a calm UX.
 *
 * Feegrant preauth (optional): at generation, select which action type URLs
 * the granter will cover gas for via AllowedMsgAllowance — selected actions
 * only. This is not airdrop funding, marketplace, or unlimited fee grant.
 */
export type OnboardingModuleData = {
  /**
   * Intro markdown shown on the module tab.
   */
  description: string
  /**
   * Default auth plane for new invites.
   */
  defaultAuthPlane: 'pfpk' | 'oidc'
  /**
   * When true, claim flow schedules automated migration after passkey bind.
   */
  autoMigrate: boolean
  /**
   * Invite TTL in days (default 7).
   */
  inviteTtlDays: number
  /**
   * Optional custom claim path base (defaults to SITE_URL + /onboard).
   */
  claimPath?: string
  /**
   * Default feegrant preauth actions for new gift links (catalog ids).
   */
  defaultPreauthActions: GiftPreauthActionId[]
  /**
   * Optional default feegrant gas spend limit (base units) + denom.
   * Empty amount = no spend_limit field (msgs still restricted by type URL).
   */
  defaultFeegrantSpendAmount?: string
  defaultFeegrantSpendDenom?: string
  /**
   * Feegrant allowance lifetime in days from generation (optional).
   */
  feegrantTtlDays?: number
}
