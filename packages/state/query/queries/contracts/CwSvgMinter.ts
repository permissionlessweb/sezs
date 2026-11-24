import { queryOptions } from '@tanstack/react-query'

import { cosmWasmClientRouter } from '@dao-dao/utils'

export type SvgCollectionListItem = {
  /** Collection contract address when returned as string or object. */
  address?: string
  collection?: string
  creator?: string
  label?: string
  [key: string]: unknown
}

/**
 * List SVG collections from cw-svg-minter (newest first).
 * Mirrors terp.network `CwSvgMinterQueryClient.listSvgCollectionsReverse`.
 */
export const fetchListSvgCollectionsReverse = async ({
  chainId,
  contractAddress,
  limit = 30,
  startBefore,
}: {
  chainId: string
  contractAddress: string
  limit?: number
  startBefore?: string | null
}): Promise<(SvgCollectionListItem | string)[]> => {
  if (!contractAddress) {
    return []
  }

  const client = await cosmWasmClientRouter.connect(chainId)
  const res = await client.queryContractSmart(contractAddress, {
    list_svg_collections_reverse: {
      limit,
      ...(startBefore ? { start_before: startBefore } : {}),
    },
  })

  // Contract may return { collections: [...] } or a bare array.
  if (Array.isArray(res)) {
    return res
  }
  if (res && Array.isArray(res.collections)) {
    return res.collections
  }
  if (res && Array.isArray(res.svg_collections)) {
    return res.svg_collections
  }
  return []
}

export const normalizeSvgCollectionAddress = (
  item: SvgCollectionListItem | string
): string => {
  if (typeof item === 'string') {
    return item
  }
  return (
    item.address ||
    item.collection ||
    (typeof item.contract === 'string' ? item.contract : '') ||
    ''
  )
}

export const cwSvgMinterQueries = {
  listSvgCollectionsReverse: (
    options: Parameters<typeof fetchListSvgCollectionsReverse>[0]
  ) =>
    queryOptions({
      queryKey: ['cwSvgMinter', 'listSvgCollectionsReverse', options],
      queryFn: () => fetchListSvgCollectionsReverse(options),
      enabled: !!options.contractAddress && !!options.chainId,
    }),
}
