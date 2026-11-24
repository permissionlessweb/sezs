/**
 * DAO-stored variables for the IBC module.
 * Dashboard data is chain-wide (terp-state / LCD); module config is light.
 */
export type IbcModuleData = {
  /**
   * Optional markdown intro above the IBC tab.
   */
  description: string
  /**
   * Show foundation relayer fund cards.
   */
  showRelayerFund: boolean
  /**
   * Show IBC swap stub (Skip / Spend path).
   */
  showSwapTab: boolean
}

export type IbcTab = 'channels' | 'relayers' | 'swap'

export type TerpIbcChannelRow = {
  /** Counterparty chain registry name (e.g. osmosis, akash). */
  counterpartyName: string
  /** Counterparty chain id when known. */
  counterpartyChainId?: string
  /** Terp-side channel id. */
  sourceChannel: string
  /** Counterparty channel id. */
  destinationChannel: string
  /** Terp client id. */
  sourceClientId: string
  /** Counterparty client id. */
  destinationClientId: string
  /** Terp connection id. */
  sourceConnectionId: string
  /** Channel version (ics20-1, …). */
  version: string
  /** Preferred transfer path from registry tags. */
  preferred: boolean
  /** Static status tag when present (ACTIVE / …). */
  status?: string
  /** Live client status from LCD when fetched. */
  clientStatus?: string
  port: string
}

export type FoundationRelayerAccount = {
  chainId: string
  chainKey: string
  address: string
  denom: string
  decimals: number
  symbol: string
  minSuggested: string
  recommendedDisplay: string
  note?: string
}

export type FoundationRelayerGroup = {
  id: string
  label: string
  note: string
  accounts: FoundationRelayerAccount[]
}
