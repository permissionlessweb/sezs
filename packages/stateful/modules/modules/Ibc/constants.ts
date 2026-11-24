import { ChainId } from '@dao-dao/types'

import { FoundationRelayerGroup } from './types'

/**
 * Public foundation Hermes gas wallets (from terp.network config.json).
 * Funding these keeps community IBC paths alive.
 */
export const FOUNDATION_RELAYER_GROUPS: FoundationRelayerGroup[] = [
  {
    id: 'foundation-hermes',
    label: 'Foundation Hermes',
    note: 'Public path gas wallets for Hermes relayers. Fund these so community IBC stays live.',
    accounts: [
      {
        chainId: ChainId.TerpMainnet,
        chainKey: 'terp',
        address: 'terp1uhf467vxvqywdmqhagq9rq9wygvwsuzkeaev7c',
        denom: 'uthiol',
        decimals: 6,
        symbol: 'THIOL',
        minSuggested: '100',
        recommendedDisplay: '100 uthiol',
      },
      {
        chainId: 'juno-1',
        chainKey: 'juno',
        address: 'juno1uhf467vxvqywdmqhagq9rq9wygvwsuzkg9nmnh',
        denom: 'ujuno',
        decimals: 6,
        symbol: 'JUNO',
        minSuggested: '1000000',
        recommendedDisplay: '1 JUNO',
      },
      {
        chainId: 'osmosis-1',
        chainKey: 'osmosis',
        address: 'osmo1uhf467vxvqywdmqhagq9rq9wygvwsuzkkvrsze',
        denom: 'uosmo',
        decimals: 6,
        symbol: 'OSMO',
        minSuggested: '5000000',
        recommendedDisplay: '5 OSMO',
      },
      {
        chainId: 'cosmoshub-4',
        chainKey: 'cosmoshub',
        address: 'cosmos1uhf467vxvqywdmqhagq9rq9wygvwsuzk7hsq5t',
        denom: 'uatom',
        decimals: 6,
        symbol: 'ATOM',
        minSuggested: '1000000',
        recommendedDisplay: '1 ATOM',
      },
      {
        chainId: 'akashnet-2',
        chainKey: 'akash',
        address: 'akash1uhf467vxvqywdmqhagq9rq9wygvwsuzknva8d3',
        denom: 'uakt',
        decimals: 6,
        symbol: 'AKT',
        minSuggested: '5000000',
        recommendedDisplay: '5 AKT',
      },
      {
        chainId: 'atomone-1',
        chainKey: 'atomone',
        address: 'atone1uhf467vxvqywdmqhagq9rq9wygvwsuzkshv8zn',
        denom: 'uatone',
        decimals: 6,
        symbol: 'ATONE',
        minSuggested: '1000000',
        recommendedDisplay: '1 ATONE',
      },
      {
        chainId: 'bitsong-2b',
        chainKey: 'bitsong',
        address: 'bitsong17lx4tzn9y5rvt9slgehcvu48ycchr2gxmz24fr',
        denom: 'ubtsg',
        decimals: 6,
        symbol: 'BTSG',
        minSuggested: '1000000000',
        recommendedDisplay: '1000 BTSG',
      },
      {
        chainId: 'jackal-1',
        chainKey: 'jackal',
        address: 'jkl1uhf467vxvqywdmqhagq9rq9wygvwsuzk8f73d5',
        denom: 'ujkl',
        decimals: 6,
        symbol: 'JKL',
        minSuggested: '10000000',
        recommendedDisplay: '10 JKL',
      },
    ],
  },
]

/** Terp chain names used in chain-registry / terp-state ibc_data. */
export const TERP_IBC_CHAIN_NAMES = new Set([
  'terp',
  'terpnetwork',
  'terp-network',
])

export const IBC_PROXY_URL = 'https://ibc-proxy.terp.network'
