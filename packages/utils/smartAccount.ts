import { CustomTxOptions } from '@cosmjs/cosmwasm-stargate'
import { EncodeObject } from '@cosmjs/proto-signing'

import { ChainId } from '@dao-dao/types'
import { TxExtension } from '@dao-dao/types/protobuf/codegen/osmosis/smartaccount/v1beta1/tx'

import { osmosisProtoRpcClientRouter } from './client'

/**
 * Chains that use Osmosis-compatible x/smartaccount authenticators.
 * Extend when other deployments share the same module.
 */
export const SMART_ACCOUNT_CHAIN_IDS: ReadonlySet<string> = new Set([
  ChainId.TerpMainnet,
  ChainId.TerpTestnet, // 120u-1 lab pilot
  ChainId.OsmosisMainnet,
  ChainId.OsmosisTestnet,
])

export const isSmartAccountChain = (chainId: string): boolean =>
  SMART_ACCOUNT_CHAIN_IDS.has(chainId)

/**
 * selected_authenticators is one authenticator id per message (index-aligned).
 * For MVP we apply the same chosen authenticator to every message.
 */
export const buildSelectedAuthenticatorsForMessages = (
  messageCount: number,
  authenticatorId: bigint | number | string
): bigint[] => {
  if (messageCount < 0) {
    throw new Error('messageCount must be non-negative')
  }
  const id = BigInt(authenticatorId)
  return Array.from({ length: messageCount }, () => id)
}

/**
 * Build the TxBody non-critical extension for smartaccount authenticator selection.
 */
export const buildSmartAccountTxExtension = (
  selectedAuthenticators: readonly (bigint | number | string)[]
): EncodeObject => ({
  typeUrl: TxExtension.typeUrl,
  value: TxExtension.fromPartial({
    selectedAuthenticators: selectedAuthenticators.map((id) => BigInt(id)),
  }),
})

/**
 * Build CustomTxOptions that attach a smartaccount TxExtension.
 * Merges with any existing options (e.g. Gaia metaprotocols, fee granter).
 */
export const buildSmartAccountTxOptions = ({
  messageCount,
  authenticatorId,
  existing,
}: {
  messageCount: number
  authenticatorId: bigint | number | string
  existing?: CustomTxOptions
}): CustomTxOptions => {
  const extension = buildSmartAccountTxExtension(
    buildSelectedAuthenticatorsForMessages(messageCount, authenticatorId)
  )

  return {
    ...existing,
    nonCriticalExtensionOptions: [
      ...(existing?.nonCriticalExtensionOptions ?? []),
      extension,
    ],
  }
}

/**
 * True when options carry non-critical extensions that require direct signing.
 * Amino does not cover extension options in the signed sign-doc.
 */
export const txOptionsRequireDirectSigner = (
  options?: CustomTxOptions
): boolean => !!options?.nonCriticalExtensionOptions?.length

/**
 * Build options from a messages array (count = messages.length).
 */
export const buildSmartAccountTxOptionsForMessages = ({
  messages,
  authenticatorId,
  existing,
}: {
  messages: readonly unknown[]
  authenticatorId: bigint | number | string
  existing?: CustomTxOptions
}): CustomTxOptions =>
  buildSmartAccountTxOptions({
    messageCount: messages.length,
    authenticatorId,
    existing,
  })

const lastUsedKey = (chainId: string, address: string) =>
  `dao-dao:smartAccount:lastAuthenticator:${chainId}:${address}`

/**
 * Persist last-used authenticator id for an account (browser only).
 */
export const setLastUsedAuthenticatorId = (
  chainId: string,
  address: string,
  authenticatorId: bigint | number | string
): void => {
  if (typeof localStorage === 'undefined') {
    return
  }
  localStorage.setItem(
    lastUsedKey(chainId, address),
    authenticatorId.toString()
  )
}

/**
 * Read last-used authenticator id, if any.
 */
export const getLastUsedAuthenticatorId = (
  chainId: string,
  address: string
): bigint | undefined => {
  if (typeof localStorage === 'undefined') {
    return undefined
  }
  const raw = localStorage.getItem(lastUsedKey(chainId, address))
  if (raw == null || raw === '') {
    return undefined
  }
  try {
    return BigInt(raw)
  } catch {
    return undefined
  }
}

export type SelectAuthenticatorOptions = {
  authenticatorIds: readonly (bigint | number | string)[]
  /**
   * Explicit override (e.g. UI picker). Wins over last-used / first.
   */
  preferredId?: bigint | number | string
  chainId: string
  address: string
}

/**
 * Choose which authenticator id to use for signing.
 * Policy: preferred → last-used (if still present) → first in list → undefined if empty.
 */
export const selectAuthenticatorId = ({
  authenticatorIds,
  preferredId,
  chainId,
  address,
}: SelectAuthenticatorOptions): bigint | undefined => {
  if (!authenticatorIds.length) {
    return undefined
  }

  const asBig = authenticatorIds.map((id) => BigInt(id))

  if (preferredId !== undefined) {
    const pref = BigInt(preferredId)
    if (asBig.some((id) => id === pref)) {
      return pref
    }
  }

  const last = getLastUsedAuthenticatorId(chainId, address)
  if (last !== undefined && asBig.some((id) => id === last)) {
    return last
  }

  return asBig[0]
}

const isMissingSmartAccountModuleError = (err: unknown): boolean => {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : JSON.stringify(err)
  const lower = msg.toLowerCase()
  return (
    lower.includes('unknown query path') ||
    lower.includes('unknown query') ||
    lower.includes('not implemented') ||
    lower.includes('no handler exists') ||
    lower.includes('cannot find module') ||
    lower.includes('module not found')
  )
}

/**
 * Live-query authenticators and build CustomTxOptions for a tx.
 * This is the signing chokepoint for non-React callers (executeSmartContracts, etc.).
 *
 * - Non-smartaccount chains → returns `existing` unchanged.
 * - Empty authenticators → returns `existing` (legacy secp path).
 * - Query failure for missing module → returns `existing` (chain without smartaccount).
 * - Other query failures → throws (do not silently sign without extension).
 */
export const resolveSmartAccountTxOptions = async ({
  chainId,
  account,
  messageCount,
  existing,
  preferredId,
}: {
  chainId: string
  account: string
  messageCount: number
  existing?: CustomTxOptions
  preferredId?: bigint | number | string
}): Promise<CustomTxOptions | undefined> => {
  if (!isSmartAccountChain(chainId) || !account) {
    return existing
  }

  let authenticatorIds: bigint[]
  try {
    const client = await osmosisProtoRpcClientRouter.connect(chainId)
    const { accountAuthenticators } =
      await client.smartaccount.v1beta1.getAuthenticators({
        account,
      })
    authenticatorIds = (accountAuthenticators ?? []).map((a) => a.id)
  } catch (err) {
    if (isMissingSmartAccountModuleError(err)) {
      return existing
    }
    console.error(
      `[smartAccount] getAuthenticators failed for ${account} on ${chainId}:`,
      err
    )
    throw new Error(
      `Failed to load smart account authenticators for ${account}. Cannot sign safely without knowing whether a TxExtension is required.`,
      { cause: err }
    )
  }

  const selected = selectAuthenticatorId({
    authenticatorIds,
    preferredId,
    chainId,
    address: account,
  })

  if (selected === undefined) {
    return existing
  }

  return buildSmartAccountTxOptions({
    messageCount,
    authenticatorId: selected,
    existing,
  })
}
