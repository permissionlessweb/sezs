import {
  CustomTxOptions,
  SigningCosmWasmClient,
} from '@cosmjs/cosmwasm-stargate'
import { EncodeObject } from '@cosmjs/proto-signing'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { smartAccountQueries } from '@dao-dao/state/query'
import { AccountAuthenticator } from '@dao-dao/types/protobuf/codegen/osmosis/smartaccount/v1beta1/models'
import {
  MsgAddAuthenticator,
  MsgRemoveAuthenticator,
} from '@dao-dao/types/protobuf/codegen/osmosis/smartaccount/v1beta1/tx'
import {
  CHAIN_GAS_MULTIPLIER,
  buildSmartAccountTxOptions,
  isSmartAccountChain,
  resolveSmartAccountTxOptions,
  selectAuthenticatorId,
  setLastUsedAuthenticatorId,
  txOptionsRequireDirectSigner,
} from '@dao-dao/utils'

import { useWallet } from './useWallet'

export type UseSmartAccountOptions = {
  /**
   * Override chain (defaults to connected wallet chain).
   */
  chainId?: string
  /**
   * Override account (defaults to connected wallet address).
   */
  address?: string
  /**
   * Force a specific authenticator id when building tx options.
   */
  preferredAuthenticatorId?: bigint | number | string
}

export type UseSmartAccountReturn = {
  /**
   * Whether this chain supports smartaccount authenticators.
   */
  supported: boolean
  /**
   * Authenticators on the account (empty if none / unsupported).
   * Empty when loading or errored — check isLoading / isError first.
   */
  authenticators: AccountAuthenticator[]
  /**
   * Loading query state.
   */
  isLoading: boolean
  /**
   * Query failed (do not treat as zero authenticators).
   */
  isError: boolean
  /**
   * Query error if any.
   */
  error: Error | null
  /**
   * Currently selected authenticator id for signing (if any).
   * Undefined while loading/error or when list is empty.
   */
  selectedAuthenticatorId: bigint | undefined
  /**
   * Override selection for subsequent getTxOptions / rememberLastUsed.
   */
  setPreferredAuthenticatorId: (
    id: bigint | number | string | undefined
  ) => void
  /**
   * Sync build of CustomTxOptions from cached query data.
   * Returns existing-only when no selection. Prefer `resolveTxOptions` before
   * signing so loading/error states are handled.
   */
  getTxOptions: (
    messageCount: number,
    existing?: CustomTxOptions
  ) => CustomTxOptions | undefined
  /**
   * Live-resolve options (refetches if needed). Throws if authenticators
   * cannot be loaded on a smartaccount chain.
   */
  resolveTxOptions: (
    messageCount: number,
    existing?: CustomTxOptions
  ) => Promise<CustomTxOptions | undefined>
  /**
   * Get a signing client appropriate for the given tx options.
   * Forces direct + no amino fallback when extensions are present.
   */
  getSigningClientForTx: (
    txOptions?: CustomTxOptions
  ) => Promise<SigningCosmWasmClient>
  /**
   * Persist selected authenticator as last-used after a successful sign.
   */
  rememberSelected: () => void
  /**
   * Invalidate authenticator query.
   */
  refresh: () => Promise<void>
  /**
   * Broadcast MsgAddAuthenticator.
   */
  addAuthenticator: (params: {
    authenticatorType: string
    data: Uint8Array
  }) => Promise<void>
  /**
   * Broadcast MsgRemoveAuthenticator.
   */
  removeAuthenticator: (id: bigint | number | string) => Promise<void>
}

/**
 * Smartaccount authenticators for the connected wallet (or overrides).
 * Use resolveTxOptions(messageCount) before every Terp wallet sign.
 */
export const useSmartAccount = (
  options: UseSmartAccountOptions = {}
): UseSmartAccountReturn => {
  const wallet = useWallet()
  const queryClient = useQueryClient()

  const chainId = options.chainId ?? wallet.chain.chainId
  const address = options.address ?? wallet.address ?? ''

  const [preferredOverride, setPreferredOverride] = useState<
    bigint | number | string | undefined
  >(options.preferredAuthenticatorId)

  const supported = isSmartAccountChain(chainId)

  const authenticatorsQuery = useQuery({
    ...smartAccountQueries.authenticators({ chainId, account: address }),
    enabled: supported && !!address,
  })

  const authenticators = authenticatorsQuery.isError
    ? []
    : (authenticatorsQuery.data ?? [])

  const selectedAuthenticatorId = useMemo(() => {
    if (authenticatorsQuery.isLoading || authenticatorsQuery.isError) {
      return undefined
    }
    return selectAuthenticatorId({
      authenticatorIds: authenticators.map((a) => a.id),
      preferredId: preferredOverride,
      chainId,
      address,
    })
  }, [
    authenticators,
    preferredOverride,
    chainId,
    address,
    authenticatorsQuery.isLoading,
    authenticatorsQuery.isError,
  ])

  const getTxOptions = useCallback(
    (
      messageCount: number,
      existing?: CustomTxOptions
    ): CustomTxOptions | undefined => {
      if (!supported || selectedAuthenticatorId === undefined) {
        return existing
      }

      return buildSmartAccountTxOptions({
        messageCount,
        authenticatorId: selectedAuthenticatorId,
        existing,
      })
    },
    [supported, selectedAuthenticatorId]
  )

  const resolveTxOptions = useCallback(
    async (
      messageCount: number,
      existing?: CustomTxOptions
    ): Promise<CustomTxOptions | undefined> => {
      if (!supported || !address) {
        return existing
      }

      // Prefer live resolve so we never sign on a stale empty list after RPC blip.
      return resolveSmartAccountTxOptions({
        chainId,
        account: address,
        messageCount,
        existing,
        preferredId: preferredOverride,
      })
    },
    [supported, address, chainId, preferredOverride]
  )

  const rememberSelected = useCallback(() => {
    if (selectedAuthenticatorId === undefined || !address) {
      return
    }
    setLastUsedAuthenticatorId(chainId, address, selectedAuthenticatorId)
  }, [selectedAuthenticatorId, chainId, address])

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: [
        'smartAccount',
        'authenticators',
        { chainId, account: address },
      ],
    })
  }, [queryClient, chainId, address])

  const getSigningClientForTx = useCallback(
    async (txOptions?: CustomTxOptions): Promise<SigningCosmWasmClient> => {
      const requireDirect = txOptionsRequireDirectSigner(txOptions)
      const client = await wallet.getSigningClient(
        requireDirect ? 'direct' : 'amino',
        // Never fall back to amino when extensions must be covered by the signature.
        !requireDirect
      )
      if (!(client instanceof SigningCosmWasmClient)) {
        throw new Error(
          'Smart account signing requires a CosmWasm signing client with direct support'
        )
      }
      return client
    },
    [wallet]
  )

  const addAuthenticator = useCallback(
    async ({
      authenticatorType,
      data,
    }: {
      authenticatorType: string
      data: Uint8Array
    }) => {
      if (!address) {
        throw new Error('Wallet not connected')
      }
      const msg: EncodeObject = {
        typeUrl: MsgAddAuthenticator.typeUrl,
        value: MsgAddAuthenticator.fromPartial({
          sender: address,
          authenticatorType,
          data,
        }),
      }
      // First authenticator: no extension. Subsequent adds need selection.
      const txOptions = await resolveTxOptions(1)
      const client = await getSigningClientForTx(txOptions)
      const result = await client.signAndBroadcast(
        address,
        [msg],
        CHAIN_GAS_MULTIPLIER,
        undefined,
        undefined,
        txOptions
      )
      if (result.code !== 0) {
        throw new Error(result.rawLog || 'Failed to add authenticator')
      }
      if (txOptionsRequireDirectSigner(txOptions)) {
        rememberSelected()
      }
      await refresh()
    },
    [address, resolveTxOptions, getSigningClientForTx, rememberSelected, refresh]
  )

  const removeAuthenticator = useCallback(
    async (id: bigint | number | string) => {
      if (!address) {
        throw new Error('Wallet not connected')
      }
      const msg: EncodeObject = {
        typeUrl: MsgRemoveAuthenticator.typeUrl,
        value: MsgRemoveAuthenticator.fromPartial({
          sender: address,
          id: BigInt(id),
        }),
      }
      const txOptions = await resolveTxOptions(1)
      const client = await getSigningClientForTx(txOptions)
      const result = await client.signAndBroadcast(
        address,
        [msg],
        CHAIN_GAS_MULTIPLIER,
        undefined,
        undefined,
        txOptions
      )
      if (result.code !== 0) {
        throw new Error(result.rawLog || 'Failed to remove authenticator')
      }
      rememberSelected()
      await refresh()
    },
    [address, resolveTxOptions, getSigningClientForTx, rememberSelected, refresh]
  )

  return {
    supported,
    authenticators,
    isLoading: authenticatorsQuery.isLoading,
    isError: authenticatorsQuery.isError,
    error: authenticatorsQuery.error ?? null,
    selectedAuthenticatorId,
    setPreferredAuthenticatorId: setPreferredOverride,
    getTxOptions,
    resolveTxOptions,
    getSigningClientForTx,
    rememberSelected,
    refresh,
    addAuthenticator,
    removeAuthenticator,
  }
}

// Re-export resolve helper for non-hook call sites.
export { resolveSmartAccountTxOptions }
