/**
 * DAO-stored variables for CommunityInfra (read-only lab / community instance matrix).
 * Design: orch/stack-stable-…/gateway/DESIGN-community-infra-monitor-dashboard.md
 * M1: single instance ENDPOINTS-SSOT matrix
 * M2: multi-instance list + location tags + LAB-IMAGE-DIGESTS pins
 */

export type CommunityInfraLocation = 'local' | 'mesh' | 'akash' | 'unknown'

export type CommunityInfraHealth = 'green' | 'canary' | 'red' | 'unknown'

export type CommunityInfraRole =
  | 'chain_rpc'
  | 'chain_lcd'
  | 'faucet'
  | 'buzz'
  | 'buzz_dual'
  | 'hashmerchant'
  | 'hermes_board'
  | 'registry'

/** Optional image/registry digest pin for a component (public-safe; no secrets). */
export type CommunityInfraDigestPin = {
  /** OCI path or logical name, e.g. lab/localterp */
  path: string
  /** Full digest, e.g. sha256:… */
  digest: string
  /** Registry host, e.g. registry.terp.network */
  registry?: string
  /** Arch hint when known */
  arch?: string
  /** Source label, e.g. LAB-IMAGE-DIGESTS */
  source?: string
}

/**
 * One community instance (local banana, mesh collab plane, scheduled Akash, …).
 * Stored on-chain as module variables when operators configure multi-instance.
 */
export type CommunityInfraInstanceConfig = {
  id: string
  label: string
  location: CommunityInfraLocation
  /**
   * When true (default), seed component URLs from this instance's built-in
   * ENDPOINTS-SSOT profile when overrides are empty.
   */
  useEndpointsSsotDefaults?: boolean
  /** Profile key for built-in seeds: lab_local | collab_mesh | empty custom */
  seedProfile?: 'lab_local' | 'collab_mesh' | 'custom'
  chainRpcUrl?: string
  chainLcdUrl?: string
  faucetUrl?: string
  buzzCanonicalUrl?: string
  buzzDualUrl?: string
  hashMerchantUrl?: string
  hermesBoardLabel?: string
  hermesDeepLinkUrl?: string
  registryPointer?: string
}

export type CommunityInfraModuleData = {
  /**
   * Optional markdown intro above the matrix.
   */
  description: string
  /**
   * Human label for the primary community instance (lab default: banana / 120u-1).
   * M1 field — still used when `instances` is empty.
   */
  instanceLabel: string
  /**
   * Soft location enum for the primary instance as a whole.
   */
  location: CommunityInfraLocation
  /**
   * When true (default), seed primary rows from lab ENDPOINTS-SSOT defaults when
   * module URL overrides are empty.
   */
  useEndpointsSsotDefaults: boolean
  /**
   * Optional URL overrides for the primary instance (empty → SSOT seed for lab).
   */
  chainRpcUrl?: string
  chainLcdUrl?: string
  faucetUrl?: string
  buzzCanonicalUrl?: string
  buzzDualUrl?: string
  hashMerchantUrl?: string
  /**
   * Hermes board label (not a secret). Default: community-gateway.
   */
  hermesBoardLabel?: string
  /**
   * Deep-link for Hermes members/ops (public-safe URL only).
   */
  hermesDeepLinkUrl?: string
  /**
   * M3: when true (default), show dual-gated residual card spawn on non-green rows.
   * Opens Hermes with prefilled draft only — never Akash LIVE / silent lease.
   */
  enableResidualSpawn?: boolean
  /**
   * Registry / digest pointer (URL or label). Default LAB-IMAGE-DIGESTS / registry.terp.network.
   */
  registryPointer?: string
  /**
   * Path or URL for Event Hub residual docs (deep-link).
   */
  eventHubResidualDocsUrl?: string
  /**
   * When true, non-admin members see operators-only empty state.
   */
  requireAdmin: boolean
  /**
   * When true, hide hosts marked internal in public-safe mode (future policy).
   * M1 keeps false so lab admins see 127.0.0.1 truth plane.
   */
  publicSafeHideInternal?: boolean
  /**
   * M2: optional extra / full multi-instance list.
   * When empty/undefined, UI shows a single primary instance derived from M1 fields.
   * When set, each entry is a full instance (primary M1 fields still appear first
   * unless an entry id is `primary`).
   */
  instances?: CommunityInfraInstanceConfig[]
  /**
   * M2: when true (default), attach digest pins from LAB-IMAGE-DIGESTS catalog
   * onto matching roles (chain_rpc → localterp, buzz* → buzz-lab, registry pointer).
   */
  useLabImageDigests?: boolean
}

export type CommunityInfraComponentRow = {
  role: CommunityInfraRole
  label: string
  url: string
  location: CommunityInfraLocation
  health: CommunityInfraHealth
  reason?: string
  lastProbeAt?: string
  probePath?: string
  optional?: boolean
  /** M2: optional digest pin (public-safe). */
  digest?: CommunityInfraDigestPin
  /** Provenance of the row (ENDPOINTS-SSOT | override | digests). */
  source?: string
  /** Instance this row belongs to (M2 multi-instance). */
  instanceId?: string
  instanceLabel?: string
}

/** Resolved instance ready for probe/render (not necessarily stored). */
export type CommunityInfraResolvedInstance = {
  id: string
  label: string
  location: CommunityInfraLocation
  rows: CommunityInfraComponentRow[]
}
