import { CreatingDaoPlaceholder } from '@dao-dao/state/clients/dao'
import {
  DaoModule,
  IDaoBase,
  Module,
  ModuleFilterOptions,
} from '@dao-dao/types'
import { labModuleDefaultValues, versionGte } from '@dao-dao/utils'

import {
  BountiesModule,
  BuzzModule,
  CalendarModule,
  CollabOpsModule,
  CommunityInfraModule,
  EventHubModule,
  HeadstashModule,
  HermesOpsModule,
  IbcModule,
  InfusionsModule,
  MarketplaceModule,
  OnboardingModule,
  PressModule,
  PrivateCorridorModule,
  RetroactiveCompensationModule,
  ShieldedVoteModule,
  ShitstrapModule,
  SvgNftModule,
  TrustlessPledgeModule,
  VestingPaymentsModule,
  VoteDelegationModule,
} from './modules'

/**
 * Get active modules for the context.
 * Terp custom apps reuse dao-dao Module + Action heuristics.
 * V300 Terp lab defaults inject community feature pack (see getDaoModules).
 */
export const getModules = (options?: ModuleFilterOptions): readonly Module[] =>
  [
    // Generic CW721 mint (upstream).
    // MintNftModule,
    VestingPaymentsModule,
    RetroactiveCompensationModule,
    VoteDelegationModule,
    PressModule,
    // Terp / permissionless app modules.
    InfusionsModule,
    HeadstashModule,
    ShitstrapModule,
    SvgNftModule,
    TrustlessPledgeModule,
    CalendarModule,
    // Event Hub composes calendar + bounties/buzz/hermes slots for curation workflows.
    EventHubModule,
    OnboardingModule,
    IbcModule,
    BountiesModule,
    // Multi-surface iframe interop (terp-buzz/v1, terp-hermes/v1).
    BuzzModule,
    HermesOpsModule,
    // Unified public/private planes (Buzz + Hermes info; F6 / t_57f42af3).
    CollabOpsModule,
    CommunityInfraModule,
    MarketplaceModule,
    // Cash App → ZEC private corridor demo (not Headstash claim).
    PrivateCorridorModule,
    // vote-sdk privacy cast (ElGamal client encrypt) — not VoteDelegation.
    ShieldedVoteModule,
    // AvEvents: enable when cw_ave is deployed on the chain.
    // AvEventsModule,
  ].filter(
    (module) =>
      !options ||
      ((!module.isChainSupported || module.isChainSupported(options.chainId)) &&
        (!module.minVersion ||
          versionGte(options.version, module.minVersion)) &&
        (!options.isDaoCreation || module.supportsDaoCreation))
  )

/**
 * Get module by ID.
 */
export const getModuleById = <Variables extends Record<string, unknown> = any>(
  id: string,
  options?: ModuleFilterOptions
): Module<Variables> | undefined =>
  getModules(options).find((module) => module.id === id)

/**
 * Get module in a DAO. Returns null if the module is not found.
 */
export const getDaoModule = <Variables extends Record<string, unknown> = any>(
  dao: IDaoBase,
  id: string
): {
  module: Module<Variables>
  daoModule: DaoModule<Variables>
} | null => {
  // Prefer on-chain config; fall back to lab default pack injection.
  const all = getDaoModules(dao)
  const hit = all.find((m) => m.daoModule.id === id)
  if (!hit) {
    return null
  }
  return {
    module: hit.module as Module<Variables>,
    daoModule: hit.daoModule as DaoModule<Variables>,
  }
}

/** Lab default module pack — V300 Terp / local community stack (120u-1). */
/**
 * Lab default module pack. EN-F2: prefer unified `collab_ops` for visitors —
 * do not inject standalone `buzz` / `hermes_ops` tabs (shells remain for Event Hub).
 */
export const LAB_DEFAULT_MODULE_IDS: readonly string[] = [
  'trustless_pledge',
  'calendar',
  'event_hub',
  'onboarding',
  'bounties',
  'collab_ops',
  'community_infra',
  'marketplace',
]

/**
 * Lab-tuned default variables so tabs work without per-DAO registration.
 * Topology SSOT: packages/utils/labTopology.ts (P2.1).
 * Collab iframe base is the **embed shell** (terp-buzz/v1 dual on build-host),
 * not the Nostr relay root on deploy-host (localhost:3000).
 */
const labDefaultValues = (id: string): Record<string, unknown> =>
  labModuleDefaultValues(id)

/**
 * Get all modules in DAO.
 * On Terp lab (120u-1 / V300 local), inject the community feature pack when
 * not already stored on-chain so DAOs show tabs immediately (no register step).
 */
export const getDaoModules = (
  dao: IDaoBase
): {
  module: Module
  daoModule: DaoModule
}[] => {
  const modules = getModules({
    chainId: dao.chainId,
    version: dao.coreVersion,
    isDaoCreation: dao instanceof CreatingDaoPlaceholder,
  })

  const byId = new Map<
    string,
    {
      module: Module
      daoModule: DaoModule
    }
  >()

  for (const daoModule of dao.modules) {
    const existingModule = modules.find((module) => module.id === daoModule.id)
    if (!existingModule) {
      continue
    }
    byId.set(daoModule.id, {
      module: existingModule,
      daoModule,
    })
  }

  // Default pack for local V300 Terp lab chain.
  const injectDefaults = dao.chainId === '120u-1'

  if (injectDefaults) {
    for (const id of LAB_DEFAULT_MODULE_IDS) {
      if (byId.has(id)) {
        continue
      }
      const existingModule = modules.find((module) => module.id === id)
      if (!existingModule) {
        continue
      }
      const defaults =
        (existingModule.defaultValues as Record<string, unknown> | undefined) ||
        {}
      byId.set(id, {
        module: existingModule,
        daoModule: {
          id,
          values: {
            ...defaults,
            ...labDefaultValues(id),
          },
        },
      })
    }
  }

  // Preserve preferred pack order, then any extra on-chain modules.
  const ordered: {
    module: Module
    daoModule: DaoModule
  }[] = []
  for (const id of LAB_DEFAULT_MODULE_IDS) {
    const entry = byId.get(id)
    if (entry) {
      ordered.push(entry)
      byId.delete(id)
    }
  }
  for (const entry of byId.values()) {
    ordered.push(entry)
  }
  return ordered
}
