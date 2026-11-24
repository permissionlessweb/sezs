/**
 * Lab ENDPOINTS-SSOT + LAB-IMAGE-DIGESTS seeds for CommunityInfra (no secrets).
 * Sources:
 * - orch/stack-stable-2026-07-31/ENDPOINTS-SSOT.md
 * - docs/grant/zcash/LAB-IMAGE-DIGESTS.md
 */

import type {
  CommunityInfraComponentRow,
  CommunityInfraDigestPin,
  CommunityInfraInstanceConfig,
  CommunityInfraModuleData,
  CommunityInfraRole,
} from './types'

/** Soft timeout for browser probes. */
export const COMMUNITY_INFRA_PROBE_TIMEOUT_MS = 5_000

/** Default Hermes board label (community collab plane). */
export const DEFAULT_HERMES_BOARD_LABEL = 'community-gateway'

/** Default registry digest pointer (label + host; no auth). */
export const DEFAULT_REGISTRY_POINTER =
  'LAB-IMAGE-DIGESTS · registry.terp.network'

/** Public-safe Event Hub residual docs path (repo-relative; open in monorepo). */
export const DEFAULT_EVENT_HUB_RESIDUAL_DOCS =
  'orch/stack-stable-2026-07-31/STATUS-W1-EVENT-HUB-RESIDUAL.md'

/** Default Hermes members deep-link (no secrets). */
export const DEFAULT_HERMES_DEEP_LINK = 'https://ops.terp.network'

/**
 * Curated digest catalog from docs/grant/zcash/LAB-IMAGE-DIGESTS.md (2026-07-31).
 * Public pins only — no registry credentials.
 */
export const LAB_IMAGE_DIGEST_CATALOG: Record<
  string,
  CommunityInfraDigestPin
> = {
  localterp: {
    path: 'lab/localterp',
    digest:
      'sha256:9fa13c04972af19995415de34a88c2cc4bde7d81bf9611a1650fd7e93dbb6a94',
    registry: 'registry.terp.network',
    arch: 'linux/amd64',
    source: 'LAB-IMAGE-DIGESTS',
  },
  'buzz-lab': {
    path: 'lab/buzz-lab',
    digest:
      'sha256:48ef358589eb6162e56cac0697bb8d3897ad655ec30617c95ee7663b00d55cfd',
    registry: 'registry.terp.network',
    arch: 'linux/arm64',
    source: 'LAB-IMAGE-DIGESTS',
  },
}

/** Map roles → digest catalog key (optional). */
export const ROLE_DIGEST_KEY: Partial<
  Record<CommunityInfraRole, keyof typeof LAB_IMAGE_DIGEST_CATALOG>
> = {
  chain_rpc: 'localterp',
  buzz: 'buzz-lab',
  buzz_dual: 'buzz-lab',
  registry: 'localterp', // pointer surface; catalog also documents registry host
}

/**
 * Lab seed rows for local community instance (banana / 120u-1 on build-host).
 * URLs only — health filled by probe or left unknown until reprobe.
 */
export const LAB_LOCAL_ENDPOINTS_SEED: Omit<
  CommunityInfraComponentRow,
  'health' | 'lastProbeAt' | 'reason' | 'digest' | 'instanceId' | 'instanceLabel'
>[] = [
  {
    role: 'chain_rpc',
    label: 'Chain RPC (truth)',
    url: 'http://127.0.0.1:26657',
    location: 'local',
    probePath: '/status',
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'chain_lcd',
    label: 'Chain LCD',
    url: 'http://127.0.0.1:1317',
    location: 'local',
    probePath: '/cosmos/base/tendermint/v1beta1/node_info',
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'faucet',
    label: 'Faucet (truth)',
    url: 'http://127.0.0.1:5000',
    location: 'local',
    probePath: '/',
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'buzz_dual',
    label: 'Buzz (dual fallback)',
    url: 'http://127.0.0.1:3001',
    location: 'local',
    probePath: '/_liveness',
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'hermes_board',
    label: 'Hermes board',
    url: '',
    location: 'unknown',
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'registry',
    label: 'Registry / digests',
    url: 'https://registry.terp.network',
    location: 'unknown',
    optional: true,
    source: 'LAB-IMAGE-DIGESTS',
  },
]

/**
 * Collab-plane mesh instance (deploy-host / localhost) — SSOT canonical Buzz + HM.
 * May be red when mesh flap; UI stays honest.
 */
export const COLLAB_MESH_ENDPOINTS_SEED: Omit<
  CommunityInfraComponentRow,
  'health' | 'lastProbeAt' | 'reason' | 'digest' | 'instanceId' | 'instanceLabel'
>[] = [
  {
    role: 'buzz',
    label: 'Buzz (canonical)',
    url: 'http://localhost:3000',
    location: 'mesh',
    probePath: '/_liveness',
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'hashmerchant',
    label: 'HashMerchant (optional)',
    url: 'http://localhost:19090',
    location: 'mesh',
    probePath: '/health',
    optional: true,
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'hermes_board',
    label: 'Hermes board',
    url: '',
    location: 'mesh',
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'registry',
    label: 'Registry / digests',
    url: 'https://registry.terp.network',
    location: 'unknown',
    optional: true,
    source: 'LAB-IMAGE-DIGESTS',
  },
]

/** M1 compatibility alias — full single-instance lab seed (local + mesh roles). */
export const LAB_ENDPOINTS_SSOT_SEED: Omit<
  CommunityInfraComponentRow,
  'health' | 'lastProbeAt' | 'reason' | 'digest' | 'instanceId' | 'instanceLabel'
>[] = [
  {
    role: 'chain_rpc',
    label: 'Chain RPC (truth)',
    url: 'http://127.0.0.1:26657',
    location: 'local',
    probePath: '/status',
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'chain_lcd',
    label: 'Chain LCD',
    url: 'http://127.0.0.1:1317',
    location: 'local',
    probePath: '/cosmos/base/tendermint/v1beta1/node_info',
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'faucet',
    label: 'Faucet (truth)',
    url: 'http://127.0.0.1:5000',
    location: 'local',
    probePath: '/',
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'buzz',
    label: 'Buzz (canonical)',
    url: 'http://localhost:3000',
    location: 'mesh',
    probePath: '/_liveness',
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'buzz_dual',
    label: 'Buzz (dual fallback)',
    url: 'http://127.0.0.1:3001',
    location: 'local',
    probePath: '/_liveness',
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'hashmerchant',
    label: 'HashMerchant (optional)',
    url: 'http://localhost:19090',
    location: 'mesh',
    probePath: '/health',
    optional: true,
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'hermes_board',
    label: 'Hermes board',
    url: '',
    location: 'unknown',
    source: 'ENDPOINTS-SSOT',
  },
  {
    role: 'registry',
    label: 'Registry / digests',
    url: 'https://registry.terp.network',
    location: 'unknown',
    optional: true,
    source: 'LAB-IMAGE-DIGESTS',
  },
]

/**
 * M2 default multi-instance inventory when module `instances` is empty and
 * `useEndpointsSsotDefaults` is true: primary lab local + collab mesh plane.
 */
export const DEFAULT_MULTI_INSTANCES: CommunityInfraInstanceConfig[] = [
  {
    id: 'lab-local',
    label: 'lab banana · 120u-1',
    location: 'local',
    seedProfile: 'lab_local',
    useEndpointsSsotDefaults: true,
  },
  {
    id: 'collab-mesh',
    label: 'collab plane · deploy-host',
    location: 'mesh',
    seedProfile: 'collab_mesh',
    useEndpointsSsotDefaults: true,
  },
]

export const DEFAULT_COMMUNITY_INFRA_VALUES: CommunityInfraModuleData = {
  description: '',
  instanceLabel: 'lab banana · 120u-1',
  location: 'local',
  useEndpointsSsotDefaults: true,
  chainRpcUrl: '',
  chainLcdUrl: '',
  faucetUrl: '',
  buzzCanonicalUrl: '',
  buzzDualUrl: '',
  hashMerchantUrl: '',
  hermesBoardLabel: DEFAULT_HERMES_BOARD_LABEL,
  hermesDeepLinkUrl: DEFAULT_HERMES_DEEP_LINK,
  enableResidualSpawn: true,
  registryPointer: DEFAULT_REGISTRY_POINTER,
  eventHubResidualDocsUrl: DEFAULT_EVENT_HUB_RESIDUAL_DOCS,
  requireAdmin: true,
  publicSafeHideInternal: false,
  // Empty → probe layer expands DEFAULT_MULTI_INSTANCES when SSOT defaults on
  instances: [],
  useLabImageDigests: true,
}

/** Format a digest pin for table display. */
export const formatDigestPin = (
  pin: CommunityInfraDigestPin | undefined
): string => {
  if (!pin) return '—'
  const short = pin.digest.startsWith('sha256:')
    ? `sha256:${pin.digest.slice(7, 19)}…`
    : `${pin.digest.slice(0, 16)}…`
  return `${pin.path}@${short}`
}

/** Full OCI ref (copy-friendly). */
export const fullDigestRef = (
  pin: CommunityInfraDigestPin | undefined
): string => {
  if (!pin) return ''
  const host = pin.registry || 'registry.terp.network'
  return `${host}/${pin.path}@${pin.digest}`
}
