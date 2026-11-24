import { queryOptions } from '@tanstack/react-query'

import { cosmWasmClientRouter } from '@dao-dao/utils'

import { HasPledgedResult } from './types'

/**
 * Query whether `walletAddress` has pledged (owns ≥1 token / mint_count > 0)
 * on the pledge collection. Chain is source of truth — not localStorage.
 *
 * Prefer cw721_svg extension `mint_count { address }`, then flat `mint_count`,
 * then standard `tokens { owner, limit: 1 }`.
 */
export const fetchHasPledged = async ({
  chainId,
  collection,
  walletAddress,
}: {
  chainId: string
  collection: string
  walletAddress: string
}): Promise<HasPledgedResult> => {
  if (!collection || !walletAddress || !chainId) {
    return { hasPledged: false, source: 'none' }
  }

  const client = await cosmWasmClientRouter.connect(chainId)

  // 1) Extension mint_count (cw721_svg QueryMsg::Extension)
  try {
    const ext = await client.queryContractSmart(collection, {
      extension: {
        msg: {
          mint_count: { address: walletAddress },
        },
      },
    })
    const count = Number(ext?.count ?? ext?.mint_count ?? 0)
    if (Number.isFinite(count)) {
      return {
        hasPledged: count > 0,
        mintCount: count,
        source: 'mint_count',
      }
    }
  } catch {
    // try flat shape
  }

  // 2) Flat mint_count (permissionless.money client / some schemas)
  try {
    const flat = await client.queryContractSmart(collection, {
      mint_count: { address: walletAddress },
    })
    const count = Number(flat?.count ?? flat?.mint_count ?? 0)
    if (Number.isFinite(count)) {
      return {
        hasPledged: count > 0,
        mintCount: count,
        source: 'mint_count',
      }
    }
  } catch {
    // fall through to tokens
  }

  // 3) tokens { owner, limit: 1 }
  try {
    const tokensRes = await client.queryContractSmart(collection, {
      tokens: {
        owner: walletAddress,
        limit: 1,
      },
    })
    const tokens: string[] = Array.isArray(tokensRes?.tokens)
      ? tokensRes.tokens
      : Array.isArray(tokensRes)
        ? tokensRes
        : []
    return {
      hasPledged: tokens.length > 0,
      tokenId: tokens[0],
      mintCount: tokens.length,
      source: 'tokens',
    }
  } catch {
    return { hasPledged: false, source: 'none' }
  }
}

export const hasPledgedQueryKey = (
  chainId: string,
  collection: string,
  walletAddress: string
) => [chainId, collection, walletAddress, 'hasPledged'] as const

export const hasPledgedQueries = {
  hasPledged: (options: {
    chainId: string
    collection: string
    walletAddress: string
  }) =>
    queryOptions({
      queryKey: hasPledgedQueryKey(
        options.chainId,
        options.collection,
        options.walletAddress
      ),
      queryFn: () => fetchHasPledged(options),
      enabled:
        !!options.chainId &&
        !!options.collection &&
        !!options.walletAddress,
    }),
}
