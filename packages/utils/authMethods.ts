/**
 * Multi-auth method registry for DAO member participation.
 *
 * Surfaces: dao-dao-ui wallet modal (stable auth), bounties iframe HOST contract.
 * Zcash Login adapters stay behind feature flags until security sign-off.
 *
 * Threat bar: iframe must not auto-authorize fund movement / bounty claims
 * without an explicit second step (ADR-36 membership then Mode A derive).
 */

export type AuthMethodId =
  | 'extension_wallet'
  | 'walletconnect'
  | 'passkey'
  | 'smart_account'
  | 'adr36_bounties'
  | 'ocid_jwt'
  | 'zcash_zecauth'
  | 'zcash_zns_login'
  | 'zcash_zecpass'
  | 'bounties_email_password'

export type AuthMethodRiskTier = 'production' | 'lab' | 'experimental' | 'legacy'

export type AuthMethodAvailability =
  | 'ready'
  | 'partial'
  | 'flagged'
  | 'disabled'
  | 'stub'

export type AuthMethodSurface =
  | 'wallet_connect_modal'
  | 'wallet_connected_card'
  | 'bounties_iframe'
  | 'bounties_standalone'
  | 'onboarding_invite'
  | 'membership_gate'

export type AuthMethodDef = {
  id: AuthMethodId
  /** Stable i18n-friendly label (English default). */
  label: string
  /** One-line description for chooser / docs. */
  description: string
  riskTier: AuthMethodRiskTier
  /** Surfaces where this method is relevant. */
  surfaces: AuthMethodSurface[]
  /**
   * Env flag name that must equal "true" for experimental methods.
   * Undefined = not gated by a NEXT_PUBLIC_* experimental flag.
   */
  featureFlag?: string
  /**
   * When true, membership / bounty authorize still requires a distinct second
   * user action after session establishment (threat AC for iframe).
   */
  requiresSecondStepForFunds: boolean
  /** Can establish a DAO-member-usable session (prove control / bind identity). */
  membershipCapable: boolean
  /** Pointers only — not product endorsements. */
  references?: string[]
}

/** Env keys (documented). Defaults: experimental Zcash off. */
export const AUTH_FEATURE_FLAGS = {
  walletConnect: 'NEXT_PUBLIC_ENABLE_WALLETCONNECT',
  zcashZecAuth: 'NEXT_PUBLIC_ENABLE_ZCASH_ZECAUTH',
  zcashZnsLogin: 'NEXT_PUBLIC_ENABLE_ZCASH_ZNS_LOGIN',
  zcashZecPass: 'NEXT_PUBLIC_ENABLE_ZCASH_ZECPASS',
  /** Master switch for any Zcash Login adapter UI. */
  zcashLogin: 'NEXT_PUBLIC_ENABLE_ZCASH_LOGIN',
  passkeyDevFallback: 'NEXT_PUBLIC_ENABLE_PASSKEY_DEV_FALLBACK',
  /** Lab: allow selecting Zcash adapter demos (still not prod membership). */
  zcashLoginLab: 'NEXT_PUBLIC_ENABLE_ZCASH_LOGIN_LAB',
} as const

const envTrue = (name: string | undefined): boolean => {
  if (!name || typeof process === 'undefined') {
    return false
  }
  return process.env[name] === 'true'
}

/**
 * Canonical registry — order is chooser display priority on wallet modal
 * (extension first; experimental last).
 */
export const AUTH_METHOD_REGISTRY: readonly AuthMethodDef[] = [
  {
    id: 'extension_wallet',
    label: 'Extension wallet',
    description:
      'Keplr, Leap, MetaMask snaps, and other cosmos-kit browser extensions. Primary path for chain txs.',
    riskTier: 'production',
    surfaces: [
      'wallet_connect_modal',
      'wallet_connected_card',
      'bounties_iframe',
      'membership_gate',
    ],
    requiresSecondStepForFunds: true,
    membershipCapable: true,
  },
  {
    id: 'walletconnect',
    label: 'WalletConnect (mobile)',
    description:
      'Mobile QR via WalletConnect relay. Soft-deprecated; enable only when needed.',
    riskTier: 'lab',
    surfaces: ['wallet_connect_modal'],
    featureFlag: AUTH_FEATURE_FLAGS.walletConnect,
    requiresSecondStepForFunds: true,
    membershipCapable: true,
  },
  {
    id: 'passkey',
    label: 'Passkey / WebAuthn',
    description:
      'Local device credential for continuity; pair to a cosmos address for on-chain membership. Not a full DAO membership proof alone.',
    riskTier: 'production',
    surfaces: [
      'wallet_connect_modal',
      'wallet_connected_card',
      'bounties_iframe',
    ],
    requiresSecondStepForFunds: true,
    membershipCapable: false,
  },
  {
    id: 'smart_account',
    label: 'Smart-account authenticators',
    description:
      'On-chain x/smartaccount authenticators (status + manage when connected on supported chains).',
    riskTier: 'lab',
    surfaces: ['wallet_connected_card', 'membership_gate'],
    requiresSecondStepForFunds: true,
    membershipCapable: true,
  },
  {
    id: 'adr36_bounties',
    label: 'ADR-36 bounties session',
    description:
      'signArbitrary membership proof for zec-bounties embed / standalone. Mode A derive is a separate step.',
    riskTier: 'production',
    surfaces: [
      'bounties_iframe',
      'bounties_standalone',
      'membership_gate',
      'wallet_connected_card',
    ],
    requiresSecondStepForFunds: true,
    membershipCapable: true,
  },
  {
    id: 'ocid_jwt',
    label: 'OCID / JWT bridge',
    description:
      'Optional PFPK / OIDC invite deep-link (/onboard). Profile session only until bound to a chain identity; never sole connect path.',
    riskTier: 'lab',
    surfaces: [
      'wallet_connect_modal',
      'wallet_connected_card',
      'onboarding_invite',
    ],
    requiresSecondStepForFunds: true,
    membershipCapable: false,
  },
  {
    id: 'bounties_email_password',
    label: 'Bounties email / password',
    description:
      'Legacy host auth on zec-bounties standalone (back-compat). Not routed through dao-dao wallet modal.',
    riskTier: 'legacy',
    surfaces: ['bounties_standalone'],
    requiresSecondStepForFunds: true,
    membershipCapable: true,
  },
  {
    id: 'zcash_zecauth',
    label: 'Zcash Login — ZecAuth',
    description:
      'Hackathon adapter spike (auth-isolated keys). Disabled until flag + security review.',
    riskTier: 'experimental',
    surfaces: ['wallet_connect_modal', 'bounties_iframe', 'bounties_standalone'],
    featureFlag: AUTH_FEATURE_FLAGS.zcashZecAuth,
    requiresSecondStepForFunds: true,
    membershipCapable: false,
    references: [
      'https://github.com/ZecHub/zechub/tree/main/Hackathon/2026/ZecAuth',
    ],
  },
  {
    id: 'zcash_zns_login',
    label: 'Zcash Login — zns-login',
    description:
      'Hackathon adapter spike (memo / control proof patterns). Flag-gated stub.',
    riskTier: 'experimental',
    surfaces: ['wallet_connect_modal', 'bounties_iframe'],
    featureFlag: AUTH_FEATURE_FLAGS.zcashZnsLogin,
    requiresSecondStepForFunds: true,
    membershipCapable: false,
    references: ['https://github.com/zcashme/zns-login'],
  },
  {
    id: 'zcash_zecpass',
    label: 'Zcash Login — ZecPass',
    description:
      'Hackathon adapter spike. Flag-gated stub; no seeds/UFVKs in FE logs.',
    riskTier: 'experimental',
    surfaces: ['wallet_connect_modal', 'bounties_iframe'],
    featureFlag: AUTH_FEATURE_FLAGS.zcashZecPass,
    requiresSecondStepForFunds: true,
    membershipCapable: false,
    references: [
      'https://github.com/devacunetixtech/zechub/tree/zecpass-hack26/zecpass-hack26',
    ],
  },
] as const

export type ResolveAuthMethodOptions = {
  /**
   * Override env lookup (tests). Keys are env var names.
   */
  env?: Record<string, string | undefined>
  /**
   * When false, WebAuthn is treated as unavailable for passkey readiness.
   * Default: probe `window` when present.
   */
  webAuthnAvailable?: boolean
  /** Wallet currently connected (affects smart_account / adr36 readiness). */
  walletConnected?: boolean
}

const readEnv = (
  name: string | undefined,
  env?: Record<string, string | undefined>
): boolean => {
  if (!name) {
    return false
  }
  if (env) {
    return env[name] === 'true'
  }
  return envTrue(name)
}

const probeWebAuthn = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }
  return !!(window.PublicKeyCredential && navigator.credentials?.create)
}

/**
 * Master Zcash Login gate: either the master flag or any per-adapter flag.
 * Individual adapters still require their own flag when master is only partial.
 */
export const isZcashLoginMasterEnabled = (
  env?: Record<string, string | undefined>
): boolean =>
  readEnv(AUTH_FEATURE_FLAGS.zcashLogin, env) ||
  readEnv(AUTH_FEATURE_FLAGS.zcashZecAuth, env) ||
  readEnv(AUTH_FEATURE_FLAGS.zcashZnsLogin, env) ||
  readEnv(AUTH_FEATURE_FLAGS.zcashZecPass, env)

/** Lab-only fake passkey ids when WebAuthn missing. Always false in production. */
export const allowPasskeyDevFallback = (
  env?: Record<string, string | undefined>
): boolean => {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    return false
  }
  if (readEnv(AUTH_FEATURE_FLAGS.passkeyDevFallback, env)) {
    return true
  }
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'development'
}

export type ResolvedAuthMethod = AuthMethodDef & {
  availability: AuthMethodAvailability
  /** True when UI should show the method (including disabled/stub with copy). */
  visible: boolean
  /** True when user can complete the flow without further product work. */
  selectable: boolean
  disabledReason?: string
}

export const resolveAuthMethod = (
  method: AuthMethodDef,
  options: ResolveAuthMethodOptions = {}
): ResolvedAuthMethod => {
  const webAuthn =
    options.webAuthnAvailable ??
    (method.id === 'passkey' ? probeWebAuthn() : true)

  // Experimental Zcash: per-adapter flag required; lab mode may make selectable demos.
  if (method.id.startsWith('zcash_')) {
    const adapterOn = readEnv(method.featureFlag, options.env)
    const masterOn = readEnv(AUTH_FEATURE_FLAGS.zcashLogin, options.env)
    const labOn =
      readEnv(AUTH_FEATURE_FLAGS.zcashLoginLab, options.env) ||
      (typeof process !== 'undefined' &&
        process.env.NODE_ENV === 'development' &&
        adapterOn)
    if (!adapterOn) {
      return {
        ...method,
        availability: 'disabled',
        visible: true,
        selectable: false,
        disabledReason: masterOn
          ? `Set ${method.featureFlag}=true for this adapter (SEC review before production default-on).`
          : `Experimental — set ${method.featureFlag}=true (and optionally ${AUTH_FEATURE_FLAGS.zcashLoginLab}=true for lab demos).`,
      }
    }
    if (labOn) {
      return {
        ...method,
        availability: 'partial',
        visible: true,
        selectable: true,
        disabledReason:
          'Lab adapter demo — challenge/capability only. No seeds/UFVKs; not production membership; funds need second step + chain wallet.',
      }
    }
    return {
      ...method,
      availability: 'stub',
      visible: true,
      selectable: false,
      disabledReason:
        'Adapter flagged but lab mode off — set NEXT_PUBLIC_ENABLE_ZCASH_LOGIN_LAB=true for selectable demos (still non-prod).',
    }
  }

  if (method.id === 'walletconnect') {
    const on = readEnv(method.featureFlag, options.env)
    if (!on) {
      return {
        ...method,
        availability: 'disabled',
        visible: false,
        selectable: false,
        disabledReason: `Hidden unless ${method.featureFlag}=true`,
      }
    }
    return {
      ...method,
      availability: 'ready',
      visible: true,
      selectable: true,
    }
  }

  if (method.id === 'passkey') {
    return {
      ...method,
      availability: webAuthn ? 'ready' : 'partial',
      visible: true,
      selectable: true,
      disabledReason: webAuthn
        ? undefined
        : 'WebAuthn unavailable — lab dev fallback credential id may be used.',
    }
  }

  if (method.id === 'smart_account') {
    return {
      ...method,
      availability: options.walletConnected ? 'partial' : 'partial',
      visible: true,
      selectable: !!options.walletConnected,
      disabledReason: options.walletConnected
        ? undefined
        : 'Connect a wallet on a smartaccount-enabled chain first.',
    }
  }

  if (method.id === 'adr36_bounties') {
    return {
      ...method,
      availability: options.walletConnected ? 'ready' : 'partial',
      visible: true,
      selectable: !!options.walletConnected,
      disabledReason: options.walletConnected
        ? undefined
        : 'Connect an extension wallet that supports signArbitrary (ADR-36).',
    }
  }

  if (method.id === 'bounties_email_password') {
    return {
      ...method,
      availability: 'disabled',
      visible: true,
      selectable: false,
      disabledReason:
        'Use zec-bounties standalone host login when intentional; not in dao-dao wallet modal.',
    }
  }

  // extension_wallet, ocid_jwt
  return {
    ...method,
    availability: 'ready',
    visible: true,
    selectable: true,
  }
}

export const listAuthMethods = (
  options: ResolveAuthMethodOptions = {}
): ResolvedAuthMethod[] =>
  AUTH_METHOD_REGISTRY.map((m) => resolveAuthMethod(m, options))

export const listVisibleAuthMethods = (
  options: ResolveAuthMethodOptions = {}
): ResolvedAuthMethod[] => listAuthMethods(options).filter((m) => m.visible)

export const listChooserAuthMethods = (
  surface: AuthMethodSurface,
  options: ResolveAuthMethodOptions = {}
): ResolvedAuthMethod[] =>
  listVisibleAuthMethods(options).filter((m) => m.surfaces.includes(surface))

/**
 * Compact capability list for bounties iframe `init` / `authCapabilities` payload.
 * Child may render method hints; parent still enforces second-step fund path.
 */
export type BountiesAuthCapability = {
  id: AuthMethodId
  label: string
  availability: AuthMethodAvailability
  selectable: boolean
  requiresSecondStepForFunds: boolean
  membershipCapable: boolean
  disabledReason?: string
}

export const buildBountiesAuthCapabilities = (
  options: ResolveAuthMethodOptions = {}
): BountiesAuthCapability[] =>
  listChooserAuthMethods('bounties_iframe', options).map((m) => ({
    id: m.id,
    label: m.label,
    availability: m.availability,
    selectable: m.selectable,
    requiresSecondStepForFunds: m.requiresSecondStepForFunds,
    membershipCapable: m.membershipCapable,
    disabledReason: m.disabledReason,
  }))

/**
 * Full `authCapabilities` postMessage payload for Bounties iframe HOST.
 * Threat AC: never auto-authorize fund movement; always require second step.
 */
export type BountiesAuthCapabilitiesPayload = {
  methods: BountiesAuthCapability[]
  autoAuthorizeFunds: false
  requiresSecondStepForFunds: true
  activeWallet: string | null
  chosenMethodHint: string | null
}

export type BuildBountiesAuthCapabilitiesPayloadOptions = {
  resolveOptions?: ResolveAuthMethodOptions
  activeWallet?: string | null
  /** Explicit hint; when omitted, falls back to getChosenAuthMethod() / wallet. */
  chosenMethodHint?: string | null
}

/** Threat AC helper: every fund-capable path must require second step. */
export const allFundPathsRequireSecondStep = (
  methods: readonly AuthMethodDef[] = AUTH_METHOD_REGISTRY
): boolean =>
  methods
    .filter((m) => m.membershipCapable || m.id === 'adr36_bounties')
    .every((m) => m.requiresSecondStepForFunds)

export const getAuthMethod = (id: AuthMethodId): AuthMethodDef | undefined =>
  AUTH_METHOD_REGISTRY.find((m) => m.id === id)


/** sessionStorage key for last focused/chosen auth method (parent HOST). */
export const CHOSEN_AUTH_METHOD_KEY = 'dao-dao:chosen-auth-method'

export const setChosenAuthMethod = (id: AuthMethodId | string | null): void => {
  if (typeof sessionStorage === 'undefined') return
  if (!id) {
    sessionStorage.removeItem(CHOSEN_AUTH_METHOD_KEY)
    return
  }
  sessionStorage.setItem(CHOSEN_AUTH_METHOD_KEY, id)
}

export const getChosenAuthMethod = (): string | null => {
  if (typeof sessionStorage === 'undefined') return null
  return sessionStorage.getItem(CHOSEN_AUTH_METHOD_KEY)
}

export const buildBountiesAuthCapabilitiesPayload = (
  options: BuildBountiesAuthCapabilitiesPayloadOptions = {}
): BountiesAuthCapabilitiesPayload => {
  const resolveOptions = options.resolveOptions ?? {}
  const methods = buildBountiesAuthCapabilities(resolveOptions)
  const walletConnected = !!resolveOptions.walletConnected
  const activeWallet = options.activeWallet ?? null

  let chosenMethodHint: string | null
  if (options.chosenMethodHint !== undefined) {
    chosenMethodHint = options.chosenMethodHint
  } else {
    chosenMethodHint =
      getChosenAuthMethod() || (walletConnected ? 'extension_wallet' : null)
  }

  return {
    methods,
    autoAuthorizeFunds: false,
    requiresSecondStepForFunds: true,
    activeWallet,
    chosenMethodHint,
  }
}
