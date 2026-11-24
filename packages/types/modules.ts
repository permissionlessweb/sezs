import { ComponentType } from 'react'
import { FieldErrors } from 'react-hook-form'

import { Account } from './account'
import {
  ActionCategoryMaker,
  ActionComponentProps,
  ActionMaker,
  ActionMatch,
  ActionOptions,
  ImplementedAction,
  ProcessedMessage,
} from './actions'
import { UnifiedCosmosMsg } from './contracts'
import { ContractVersion } from './features'

export enum ModuleId {
  AvEvents = 'av_events',
  Infusions = 'infusions',
  Headstash = 'headstash',
  MintNft = 'mint_nft',
  /**
   * On-chain SVG collections (cw-svg-minter / cw721_svg) — distinct from generic MintNft.
   */
  SvgNfts = 'svg_nfts',
  /**
   * Trustlessness pledge NFT: ADR-032 digest over manifesto CID + mint + hasPledged.
   * Spec: docs/superpowers/specs/2026-07-22-trustless-pledge-nft-module.md
   */
  TrustlessPledge = 'trustless_pledge',
  /**
   * DAO calendar / Noster-style scheduled events (dao-calendar).
   */
  Calendar = 'calendar',
  /**
   * Gift accounts / sharable onboarding invite links (PFPK / OIDC two-step +
   * passkey bind + optional feegrant preauth for selected actions only).
   */
  Onboarding = 'onboarding',
  /**
   * IBC ops surface: live channels, foundation relayer deposits, swap entry.
   */
  Ibc = 'ibc',
  /**
   * DAO-scoped ZEC bounties iframe (terp fork of zec-bounties + ADR-36 / HKDF).
   */
  Bounties = 'bounties',
  /**
   * Public Buzz coordination surface (iframe shell, terp-buzz/v1).
   * Spec: docs/superpowers/specs/2026-07-21-dao-multi-surface-iframe-interop.md
   */
  Buzz = 'buzz',
  /**
   * Internal Hermes ops surface (iframe or deep-link; OnlyMembers).
   * Spec: docs/superpowers/specs/2026-07-21-dao-multi-surface-iframe-interop.md
   */
  HermesOps = 'hermes_ops',
  /**
   * Unified Buzz + Hermes info surface (mesh.v1 + optional embeds) with public vs
   * private (member-gated) planes. Prefer over standalone Buzz / HermesOps tabs.
   * EN-F2 / t_8365ea2e · F6 / t_57f42af3.
   */
  CollabOps = 'collab_ops',
  /**
   * Event Hub — composes calendar strip, participation chips, and Work/Collab/Ops
   * iframe slots (Bounties / Buzz / Hermes) for community-led events.
   * Config via mesh.v1 embeds + ceremony + eventDefaults (U0–U3 orch).
   * Design: docs/research/dao-event-ui-orch/S-dao-event-ui-orchestration.md
   */
  EventHub = 'event_hub',
  /**
   * DAO marketplace: fixed-price (marketplace-mirror) + auctions (revenue/auction).
   * Discovery via mesh.v1.marketplace; HTTP first, Nostr progressive.
   * Handoff: docs/superpowers/specs/2026-07-20-dao-marketplace-nostr-ui-handoff.md
   */
  Marketplace = 'marketplace',
  /**
   * Cash App → fresh BTC → private bridge → ZEC corridor (preauth dest + rate bounds).
   * Demo film Module — not Headstash airdrop claim. SPEC: DEMO-CASHAPP-ZEC-CORRIDOR.md §7.
   */
  PrivateCorridor = 'private_corridor',
  /**
   * Community instance infra monitor — read-only status matrix from ENDPOINTS-SSOT
   * (chain / Buzz / HM / Hermes board / registry). Admin glass; no secrets.
   * Design: orch/stack-stable-…/gateway/DESIGN-community-infra-monitor-dashboard.md
   */
  CommunityInfra = 'community_infra',
  Press = 'press',
  RetroactiveCompensation = 'retroactive',
  DaoDnas = 'dnas',
  Subscribe = 'subscribe',
  ShitStrap = 'shitstrap',
  VestingPayments = 'vesting',
  VoteDelegation = 'vote_delegation',
  /**
   * ShieldedVote — vote-sdk privacy cast (client-side ElGamal under ea_pk).
   * Not VoteDelegation (standard DAO delegation) and not PrivateCorridor (BTC→ZEC).
   * Handoff: docs/research/HANDOFF-DAO-DAO-UI-VOTE-SDK-PRIVACY-CAST.md (V-UI-3).
   */
  ShieldedVote = 'shielded_vote',
}

/**
 * The location in the UI where the module is displayed.
 */
export enum ModuleDisplayLocation {
  /**
   * Module is displayed on the homepage (the first tab).
   */
  Home = 'home',
  /**
   * Module is displayed in its own tab. `Icon` must be provided as well.
   */
  Tab = 'tab',
  /**
   * Module is manually integrated.
   */
  Manual = 'manual',
}

/**
 * The context in which the module is visible.
 */
export enum ModuleVisibilityContext {
  /**
   * Module is always visible.
   */
  Always = 'always',
  /**
   * Module is visible only for members.
   */
  OnlyMembers = 'onlyMembers',
  /**
   * Module is visible only for non-members. This is also visible when no wallet
   * is connected, as the user is not known to be a member.
   */
  OnlyNonMembers = 'onlyNonMembers',
}

/**
 * Props for the module renderer.
 */
export type ModuleRendererProps<Variables extends Record<string, unknown>> = {
  variables: Variables
}

/**
 * Props for the module editor.
 */
export type ModuleEditorProps<
  Variables extends Record<string, unknown> = any,
  Extra extends Record<string, unknown> = any,
> = (
  | ({
      type: 'action'
      options: ActionOptions
      /**
       * Extra data used only for encoding.
       */
      extra: Extra
    } & ActionComponentProps<undefined, Variables>)
  | {
      type: 'daoCreation'
      // To match action props.
      isCreating: true
      /**
       * The field name path prefix for module variables stored in the DAO.
       */
      fieldNamePrefix: string
      /**
       * The errors for the module variables.
       */
      errors: FieldErrors
    }
) & {
  accounts: readonly Account[]

  /**
   * The field name path prefix for extra data used only for encoding.
   */
  extraFieldNamePrefix: string
  /**
   * The errors for the extra data used only for encoding.
   */
  extraErrors: FieldErrors
}

export type Module<
  Variables extends Record<string, unknown> = any,
  ExtraActionData extends Record<string, unknown> = any,
> = {
  /**
   * A unique identifier for the module.
   */
  id: ModuleId
  /**
   * A title for the module.
   */
  title: string
  /**
   * A description for the module.
   */
  description: string
  /**
   * An icon for the module. Used for display in the editor and when `location`
   * is `ModuleDisplayLocation.Tab`.
   */
  Icon: ComponentType<{ className: string }>
  /**
   * A filled icon for the module. Used for display in the editor and when
   * `location` is `ModuleDisplayLocation.Home`.
   */
  IconFilled: ComponentType<{ className: string }>
  /**
   * The location where the module is displayed.
   */
  location: ModuleDisplayLocation
  /**
   * The context in which the module is visible.
   */
  visibilityContext: ModuleVisibilityContext
  /**
   * If defined, the module is only available if this returns true for a chain.
   */
  isChainSupported?: (chainId: string) => boolean
  /**
   * Minimum version of the DAO contracts that the module is supported on.
   */
  minVersion?: ContractVersion
  /**
   * Whether or not the module can be enabled on DAO creation. Defaults to
   * false.
   */
  supportsDaoCreation?: boolean
  /**
   * The default values for the module's variables.
   */
  defaultValues?: Variables
  /**
   * The default values for the module's extra data used only for encoding.
   */
  defaultExtra?: ExtraActionData
  /**
   * Component that renders the module.
   */
  Renderer?: ComponentType<ModuleRendererProps<Variables>>
  /**
   * Component that allows the user to edit the module's variables in an action.
   */
  Editor?: ComponentType<ModuleEditorProps<Variables>>
  /**
   * Encode and match additional messages when using the ManageModules action to
   * set/update the module.
   */
  editAction?: {
    /**
     * Encode additional messages when using the ManageModules action to
     * set/update the module.
     */
    encode: (options: {
      data: Variables
      options: ActionOptions
      extra: ExtraActionData
    }) =>
      | UnifiedCosmosMsg
      | UnifiedCosmosMsg[]
      | Promise<UnifiedCosmosMsg | UnifiedCosmosMsg[]>
    /**
     * Match additional messages when using the ManageModules action to
     * set/update the module. This should match the number of messages encoded
     * by the above `encode` function (i.e. excluding the initial ManageModules
     * message).
     *
     * The messages passed exclude the initial ManageModules message.
     */
    match: (options: {
      data: Variables
      /**
       * Messages excluding the initial ManageModules message.
       */
      messages: ProcessedMessage[]
      options: ActionOptions
    }) => ActionMatch | Promise<ActionMatch>
    /**
     * Decode extra data from the matched messages, excluding the initial
     * ManageModules message.
     */
    decode?: (options: {
      data: Variables
      /**
       * Messages excluding the initial ManageModules message.
       */
      messages: ProcessedMessage[]
      options: ActionOptions
    }) => ExtraActionData | Promise<ExtraActionData>
  }
  /**
   * Actions that are available in proposals when this module is enabled.
   */
  getActions?: (variables: Variables) => {
    actions?: ImplementedAction<any>[]
    actionMakers?: ActionMaker<any>[]
    categoryMakers: ActionCategoryMaker[]
  }
}

/**
 * DaoModule is the structure of a module as stored in the DAO's core item map
 * as a JSON-encoded object. It stores the unique identifier of the module and
 * the values for the module's variables so that it can be rendered.
 */
export type DaoModule<Data extends Record<string, unknown> = any> = {
  id: string
  values?: Data
}

/**
 * LoadedModule is a module that has been loaded and is ready to be rendered.
 */
export type LoadedModule<Data extends Record<string, unknown> = any> = {
  module: Module
  daoModule: DaoModule<Data>
  ModuleComponent: ComponentType
}

/**
 * Options used to filter modules.
 */
export type ModuleFilterOptions = {
  /**
   * Chain ID.
   */
  chainId: string
  /**
   * Version of the DAO contracts.
   */
  version: ContractVersion
  /**
   * Whether or not we're in the DAO creation context. Defaults to false.
   */
  isDaoCreation?: boolean
}
