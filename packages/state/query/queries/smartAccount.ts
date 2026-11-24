import { queryOptions } from '@tanstack/react-query'

import { AccountAuthenticator } from '@dao-dao/types/protobuf/codegen/osmosis/smartaccount/v1beta1/models'
import {
  isSmartAccountChain,
  osmosisProtoRpcClientRouter,
} from '@dao-dao/utils'

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
 * Fetch authenticators registered on an account (x/smartaccount).
 *
 * - Non-smartaccount chain / empty account → [].
 * - Module missing on chain → [] (not an error for mixed multi-chain UI).
 * - Other RPC failures → throw so callers do not silently omit TxExtension.
 */
export const fetchAccountAuthenticators = async ({
  chainId,
  account,
}: {
  chainId: string
  account: string
}): Promise<AccountAuthenticator[]> => {
  if (!isSmartAccountChain(chainId) || !account) {
    return []
  }

  try {
    const client = await osmosisProtoRpcClientRouter.connect(chainId)
    const { accountAuthenticators } =
      await client.smartaccount.v1beta1.getAuthenticators({
        account,
      })
    return accountAuthenticators ?? []
  } catch (err) {
    if (isMissingSmartAccountModuleError(err)) {
      return []
    }
    console.error(
      `[smartAccount] getAuthenticators failed for ${account} on ${chainId}:`,
      err
    )
    throw err
  }
}

/**
 * Fetch a single authenticator by id.
 * Throws on unexpected RPC errors (does not swallow into null).
 */
export const fetchAccountAuthenticator = async ({
  chainId,
  account,
  authenticatorId,
}: {
  chainId: string
  account: string
  authenticatorId: bigint | number | string
}): Promise<AccountAuthenticator | null> => {
  if (!isSmartAccountChain(chainId) || !account) {
    return null
  }

  try {
    const client = await osmosisProtoRpcClientRouter.connect(chainId)
    const { accountAuthenticator } =
      await client.smartaccount.v1beta1.getAuthenticator({
        account,
        authenticatorId: BigInt(authenticatorId),
      })
    return accountAuthenticator ?? null
  } catch (err) {
    if (isMissingSmartAccountModuleError(err)) {
      return null
    }
    console.error(
      `[smartAccount] getAuthenticator failed for ${account} id=${authenticatorId} on ${chainId}:`,
      err
    )
    throw err
  }
}

export const smartAccountQueries = {
  authenticators: (options: Parameters<typeof fetchAccountAuthenticators>[0]) =>
    queryOptions({
      queryKey: ['smartAccount', 'authenticators', options],
      queryFn: () => fetchAccountAuthenticators(options),
      enabled: !!options.account && isSmartAccountChain(options.chainId),
    }),

  authenticator: (options: Parameters<typeof fetchAccountAuthenticator>[0]) =>
    queryOptions({
      queryKey: ['smartAccount', 'authenticator', options],
      queryFn: () => fetchAccountAuthenticator(options),
      enabled:
        !!options.account &&
        options.authenticatorId !== null &&
        options.authenticatorId !== undefined &&
        isSmartAccountChain(options.chainId),
    }),
}
