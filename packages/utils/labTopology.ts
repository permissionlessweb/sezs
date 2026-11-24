/**
 * Lab topology SSOT for module Editors + 120u-1 lab inject (P2.1).
 *
 * Host roles (event-night / demo-day review §G3):
 * - **build-host** (SDA / dao-dao-ui, Hermes ops tunnel, local buzz dual): loopback or LAN of SDA host
 * - **deploy-host** (canonical Buzz NIP-11 relay + HashMerchant ingress): localhost
 *
 * Embed shell ≠ relay root. Never use LAB_BUZZ_RELAY_* as iframe `src` base.
 * Cross-check: docs/superpowers/orch/event-night-2026-08-07/NOSTR-ENV.md
 *              packages/utils/embedFriction.ts (LAB_BUZZ_RELAY_HTTP_ORIGIN)
 */

/** Canonical Buzz/Nostr **relay** HTTP on deploy-host (NIP-11 / open-in-tab). Not embed shell. */
export const LAB_BUZZ_RELAY_HTTP = 'http://localhost:3000'

/** Canonical Buzz/Nostr **relay** WSS on deploy-host. */
export const LAB_BUZZ_RELAY_WSS = 'ws://localhost:3000'

/**
 * Live dual Buzz surface on SDA host (build-host) when deploy-host is down.
 * Event-night working set: docker buzz-prod :3001.
 */
export const LAB_BUZZ_DUAL_HTTP = 'http://127.0.0.1:3001'

/** Dual Buzz WSS on SDA host. */
export const LAB_BUZZ_DUAL_WSS = 'ws://127.0.0.1:3001'

/**
 * HashMerchant / content / blossom ingress on deploy-host.
 * Probe: GET /health. **Not** calendar listEvents (`/api/v1/calendar/events`).
 * Do not publish as mesh.v1 `query` unless a real listEvents service shares the port
 * (lab reality: it does not). See MESH-QUERY-PLANE-SSOT.md (t_6164da8d).
 */
export const LAB_HASHMERCHANT_HTTP = 'http://localhost:19090'

/**
 * Optional HTTP calendar query plane base (listEvents).
 * Empty string = chain-only (dao-calendar via LCD) — recommended for lab EH demos.
 * Override with NEXT_PUBLIC_MESH_QUERY / NEXT_PUBLIC_CALENDAR_QUERY when ops publish an index.
 */
export const LAB_CALENDAR_QUERY_HTTP = ''

/** Hermes ops dashboard on SDA host (local tunnel / gateway). */
export const LAB_HERMES_OPS_HTTP = 'http://127.0.0.1:9119'

/** Bounties embed FE on SDA host (lab). */
export const LAB_BOUNTIES_EMBED_HTTP = 'http://127.0.0.1:3100'

/** community-core-local open-lab calendar (banana / 120u-1). */
export const LAB_CALENDAR_CONTRACT =
  'terp1lstuws59hjswletwmskefdajhq76pz9tlfq84perndemrzztda0q6qnacs'

/**
 * Lab cw-vote-ceremony (or registration) contract when mapped on banana/open-lab.
 * Empty until EH-REG-1 / network specialist deploys + writes mesh.v1.ceremony.
 * Override with NEXT_PUBLIC_CEREMONY once APPSTATE publishes an address.
 */
export const LAB_CEREMONY_CONTRACT = ''

/** community-core-local marketplace-mirror. */
export const LAB_MARKETPLACE_MIRROR =
  'terp1yhmn2s9d5jya5fm70hqqmxlrdqzddp995ucunaw9ujx9cpd45nzq7mm8dz'

const trimEnv = (key: string): string => {
  if (typeof process === 'undefined') return ''
  return process.env?.[key]?.trim() || ''
}

/** Lab banana chain id (community-core-local). */
export const LAB_CHAIN_ID = '120u-1'

/**
 * Lab shell mode: SDA is pinned to 120u-1 (or NEXT_PUBLIC_LAB_SHELL=true).
 * When active, foreign public RPCs (cosmos.directory / polkachu / stargaze
 * testnet, etc.) must not be used for open-lab DAO walks.
 *
 * Override:
 * - NEXT_PUBLIC_LAB_SHELL=true|false
 * - auto: !MAINNET && NEXT_PUBLIC_CHAIN_ID=120u-1
 */
export const isLabShellMode = (): boolean => {
  const forced = trimEnv('NEXT_PUBLIC_LAB_SHELL').toLowerCase()
  if (forced === 'true' || forced === '1') return true
  if (forced === 'false' || forced === '0') return false
  const mainnet = trimEnv('NEXT_PUBLIC_MAINNET') === 'true'
  const chainId = trimEnv('NEXT_PUBLIC_CHAIN_ID')
  return !mainnet && chainId === LAB_CHAIN_ID
}

/**
 * Allowlisted chain IDs for lab shell RPC/LCD.
 * Default: only 120u-1. Extend with NEXT_PUBLIC_LAB_CHAIN_ALLOWLIST=120u-1,morocco-1
 * Returns null when not in lab shell (no restriction).
 */
export const getLabChainAllowlist = (): string[] | null => {
  if (!isLabShellMode()) return null
  const raw = trimEnv('NEXT_PUBLIC_LAB_CHAIN_ALLOWLIST')
  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return [LAB_CHAIN_ID]
}

/** True if chainId may use RPC/LCD under lab shell (always true outside lab). */
export const isLabAllowlistedChain = (chainId: string): boolean => {
  const list = getLabChainAllowlist()
  if (!list) return true
  return list.includes(chainId)
}

/**
 * Public / foreign RPC hosts that must not be contacted from lab SDA
 * (fe-observe noise: cosmos.directory/stargazetestnet 404, juno polkachu, …).
 */
export const isForeignPublicChainUrl = (url: string): boolean => {
  if (!url) return false
  return /cosmos\.directory|polkachu\.com|publicnode\.com|stargaze-apis|stargaze\.zone|quicksilver\.zone|lavenderfive\.com|goldenratio\.space|nodestake\.top|cosmostation\.io|allthatnode\.com|osmosis\.zone|juno\.tools/i.test(
    url
  )
}

/** Documented lab RPC/LCD allowlist defaults (browser → SDA proxy). */
export const LAB_RPC_LCD_ALLOWLIST_NOTE = {
  chainId: LAB_CHAIN_ID,
  rpc:
    'NEXT_PUBLIC_LAB_RPC || NEXT_PUBLIC_RPC || http://127.0.0.1:3000/lab-rpc (same-origin SDA rewrite → terpd)',
  lcd:
    'NEXT_PUBLIC_LAB_LCD || NEXT_PUBLIC_LCD || http://127.0.0.1:3000/lab-lcd',
  peers: 'Only chains in NEXT_PUBLIC_LAB_CHAIN_ALLOWLIST (default: 120u-1)',
  blocked:
    'rpc.cosmos.directory/*, rest.cosmos.directory/*, polkachu, publicnode, stargaze mainnet/testnet RPC',
} as const

/**
 * Resolve Buzz **embed shell** base for lab inject / editor placeholders.
 * Prefer env → dual live surface on build-host (not deploy-host relay root).
 */
export const resolveLabBuzzEmbedShell = (): string =>
  (
    trimEnv('NEXT_PUBLIC_BUZZ_EMBED') || LAB_BUZZ_DUAL_HTTP
  ).replace(/\/$/, '')

/**
 * Resolve Hermes ops base for lab inject / editor placeholders (SDA host).
 */
export const resolveLabHermesOps = (): string =>
  (
    trimEnv('NEXT_PUBLIC_HERMES_OPS_URL') ||
    trimEnv('NEXT_PUBLIC_HERMES_EMBED') ||
    LAB_HERMES_OPS_HTTP
  ).replace(/\/$/, '')

/** Resolve bounties embed base (SDA host). */
export const resolveLabBountiesEmbed = (): string =>
  (
    trimEnv('NEXT_PUBLIC_BOUNTIES_EMBED') || LAB_BOUNTIES_EMBED_HTTP
  ).replace(/\/$/, '')

/** Resolve calendar contract for lab defaults. */
export const resolveLabCalendarContract = (): string =>
  trimEnv('NEXT_PUBLIC_CALENDAR') || LAB_CALENDAR_CONTRACT

/**
 * Resolve ceremony/registration contract for lab defaults.
 * Never invents an address — empty until env or LAB_CEREMONY_CONTRACT is set.
 */
export const resolveLabCeremonyContract = (): string =>
  trimEnv('NEXT_PUBLIC_CEREMONY') ||
  trimEnv('NEXT_PUBLIC_CEREMONY_CONTRACT') ||
  LAB_CEREMONY_CONTRACT

/**
 * Lab-tuned default module variables for 120u-1 inject and Editor guidance.
 * Keys match module ids (ModuleId / daoModule.id).
 */
export const labModuleDefaultValues = (
  id: string
): Record<string, unknown> => {
  const buzzShell = resolveLabBuzzEmbedShell()
  const hermes = resolveLabHermesOps()
  const bounties = resolveLabBountiesEmbed()
  const calendar = resolveLabCalendarContract()
  const ceremony = resolveLabCeremonyContract()

  switch (id) {
    case 'buzz':
      return {
        description: 'Lab Buzz collab (embed shell — not NIP-11 relay root)',
        embedBaseUrl: buzzShell,
        defaultView: 'public',
        enableDaoAttest: true,
      }
    case 'hermes_ops':
      return {
        description: 'Lab Hermes ops dashboard (deep-link)',
        embedBaseUrl: hermes,
        defaultView: 'kanban',
        requireAdmin: false,
        deepLinkOnly: true,
        deepLinkUrl: hermes,
      }
    case 'event_hub':
      return {
        description: 'Community Event Hub',
        calendarContract: calendar,
        // Only set when env / LAB_CEREMONY_CONTRACT has a real address (no invent).
        ...(ceremony ? { ceremonyContract: ceremony } : {}),
        useChainMeshDefault: true,
        // Never default collab iframe to the dual-relay host (:3000).
        buzzEmbedBaseUrl: buzzShell,
        hermesEmbedBaseUrl: hermes,
        hermesDeepLinkOnly: true,
        hermesDeepLinkUrl: hermes,
        bountiesEmbedBaseUrl: bounties,
        enableDaoAttest: true,
        // Open walkthrough: public collab gate for lab demos.
        // Soft-gate still requires ceremony for OPEN registration bounties.
        buzzGate: 'public',
        registrationPolicy: ceremony ? 'ceremony' : 'open',
        defaultEventSlug: trimEnv('NEXT_PUBLIC_DEFAULT_EVENT_SLUG') || 'lab-demo',
        hermesVisibility: 'only-members',
      }
    case 'collab_ops':
      return {
        description:
          'Public Buzz collab + private Hermes ops (mesh.v1 info; member-gated private)',
        buzzEmbedBaseUrl: buzzShell,
        buzzDefaultView: 'public',
        enableDaoAttest: true,
        hermesEmbedBaseUrl: hermes,
        hermesDeepLinkOnly: true,
        hermesDeepLinkUrl: hermes,
        privateVisibility: 'only-members',
        defaultPlane: 'public',
        useChainMeshDefault: true,
        meshJson: '',
        // Lab demos may enable live embeds; product Phase-1 default is false.
        showLiveEmbeds: true,
      }
    case 'bounties':
      return {
        description: 'DAO bounties surface',
        embedBaseUrl: bounties,
        defaultView: 'members',
      }
    case 'calendar':
      return {
        calendarContract: calendar,
        useChainMeshDefault: true,
      }
    case 'marketplace':
      return {
        fixedPriceContract: LAB_MARKETPLACE_MIRROR,
        description: 'Lab marketplace (mesh.v1 + HM content plane when up)',
        contentBase: LAB_HASHMERCHANT_HTTP,
        acceptedDenom: 'uterp',
        minBufferBlocks: 7,
        useChainMeshDefault: true,
        meshJson: '',
      }
    default:
      return {}
  }
}
