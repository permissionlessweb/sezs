import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Loader, MarkdownRenderer, useDao } from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'
import {
  MESH_STORAGE_KEY,
  MeshMarketplaceV1,
  MeshResolveError,
  NormalizedMarketplaceListing,
  ResolvedMesh,
  demoListingsFromMesh,
  getSupportedChainConfig,
  mergeMeshMarketplace,
  normalizeFixedProduct,
  parseMeshMarketplace,
  resolveMesh,
} from '@dao-dao/utils'

import {
  DevOpsDisclosure,
  DevOpsMonoLine,
} from '../../components/DevOpsDisclosure'
import { ModuleSectionHeader } from '../../components/ModuleSectionHeader'
import { MarketplaceBidDrawer } from './MarketplaceBidDrawer'
import { MarketplaceCatalogPanel } from './MarketplaceCatalogPanel'
import { MarketplacePurchaseDrawer } from './MarketplacePurchaseDrawer'
import { MarketplaceModuleData } from './types'

const MARKETPLACE_INFO_MD = `### What this is

The DAO’s **marketplace**: browse community goods and listings, then purchase or bid with your wallet.

### How to use it

1. Browse the catalog for available items.  
2. Select a listing to open purchase or bid steps.  
3. Confirm the amount carefully, then sign with your wallet.  
4. After a successful payment, **copy the transaction link** to share or keep a receipt.

### Tips

- Settlements happen on-chain — only sign transactions you understand.  
- If the catalog is empty, stewards may still be adding inventory.
`

const meshSourceLabel = (source: ResolvedMesh['source']): string => {
  switch (source) {
    case 'dao_storage':
      return `DAO storage “${MESH_STORAGE_KEY}”`
    case 'module':
      return 'Marketplace module values'
    case 'text_record':
      return 'account text record'
    case 'chain_default':
      return 'chain headstash defaults'
    case 'override':
      return 'explicit override'
    default:
      return source
  }
}

/**
 * Marketplace tab: mesh discovery (M0) + catalog/filters (M3).
 * Purchase/bid drawers = M4–M5.
 */
export const MarketplaceRenderer = ({
  variables: {
    fixedPriceContract,
    auctionContract,
    description,
    contentBase,
    acceptedDenom,
    minBufferBlocks,
    useChainMeshDefault = true,
    meshJson,
  },
}: ModuleRendererProps<MarketplaceModuleData>) => {
  const { t } = useTranslation()
  const dao = useDao()
  const chainConfig = getSupportedChainConfig(dao.chainId)
  const chainServices = chainConfig?.services

  const [selected, setSelected] = useState<NormalizedMarketplaceListing | null>(
    null
  )

  const fromModule: MeshMarketplaceV1 = {
    fixedPrice: fixedPriceContract || undefined,
    auction: auctionContract || undefined,
    contentBase: contentBase || undefined,
    acceptedDenom: acceptedDenom || undefined,
    minBufferBlocks: minBufferBlocks || undefined,
    modes: ['fixed', 'auction', 'buy_now'],
  }

  const meshQuery = useQuery({
    queryKey: [
      'marketplaceModule',
      'resolveMesh',
      dao.chainId,
      dao.coreAddress,
      fixedPriceContract,
      auctionContract,
      contentBase,
      acceptedDenom,
      minBufferBlocks,
      meshJson,
      useChainMeshDefault,
      dao.info.items[MESH_STORAGE_KEY] ?? null,
    ],
    queryFn: async (): Promise<ResolvedMesh> =>
      resolveMesh({
        chainId: dao.chainId,
        daoAddress: dao.coreAddress,
        chainServices: useChainMeshDefault === false ? {} : chainServices,
        loaders: {
          getDaoStorageItem: async (key) => {
            const fromInfo = dao.info.items[key]
            if (fromInfo !== undefined && fromInfo !== '') {
              return fromInfo
            }
            return null
          },
          getModuleValues: async () => ({
            marketplaceFixedPrice: fixedPriceContract || undefined,
            marketplaceAuction: auctionContract || undefined,
            marketplaceContentBase: contentBase || undefined,
            marketplaceAcceptedDenom: acceptedDenom || undefined,
            marketplaceMinBufferBlocks: minBufferBlocks || undefined,
            meshJson: meshJson || undefined,
          }),
        },
      }),
    retry: false,
  })

  const mesh = meshQuery.data
  const meshError = meshQuery.error
  const marketplace =
    mesh?.marketplace ||
    parseMeshMarketplace(fromModule) ||
    mergeMeshMarketplace(undefined, fromModule) ||
    fromModule

  const hasContract = !!(marketplace.fixedPrice || marketplace.auction)
  const denom = marketplace.acceptedDenom || acceptedDenom || 'uterp'
  const buffer = marketplace.minBufferBlocks ?? minBufferBlocks ?? 7
  const fp = marketplace.fixedPrice
  const auc = marketplace.auction

  // Lab SKUs first (APPSTATE / walkthrough), then ICT demo SKU, then env list.
  // NEXT_PUBLIC_MARKETPLACE_SKUS=comma-separated overrides extras (always includes lab defaults).
  const DEMO_SKUS = (() => {
    const lab = ['lab-sticker', 'lab-badge', 'lab-patch']
    const env =
      typeof process !== 'undefined' && process.env.NEXT_PUBLIC_MARKETPLACE_SKUS
        ? process.env.NEXT_PUBLIC_MARKETPLACE_SKUS.split(/[\s,]+/).filter(
            Boolean
          )
        : []
    const ict = ['GL-LTD-001']
    return Array.from(new Set([...lab, ...env, ...ict]))
  })()

  const chainProductsQuery = useQuery({
    queryKey: [
      'marketplaceCatalog',
      'products',
      dao.chainId,
      fp,
      DEMO_SKUS.join(','),
    ],
    enabled: !!fp,
    queryFn: async () => {
      if (!fp) return [] as NormalizedMarketplaceListing[]
      const rows: NormalizedMarketplaceListing[] = []
      for (const sku of DEMO_SKUS) {
        try {
          // Prefer react-query factory when client available via queryClient;
          // direct smart query path uses generated query options shape.
          const { getCosmWasmClientForChainId } = await import('@dao-dao/utils')
          const { MarketplaceMirrorQueryClient } = await import(
            '@dao-dao/state/contracts'
          )
          const client = new MarketplaceMirrorQueryClient(
            await getCosmWasmClientForChainId(dao.chainId),
            fp
          )
          const response = await client.product({ sku })
          rows.push(
            normalizeFixedProduct({
              response,
              contract: fp,
              denom,
              source: 'chain',
            })
          )
        } catch {
          // SKU not listed on-chain yet — skip
        }
      }
      return rows
    },
    staleTime: 15_000,
    retry: false,
  })

  const chainAuctionsQuery = useQuery({
    queryKey: ['marketplaceCatalog', 'auctions', dao.chainId, auc],
    enabled: !!auc,
    queryFn: async () => {
      // Auction list needs nft_contract filter; without curated NFT contract
      // we fall back to demo seed (honest gap until mesh carries nft collections).
      return [] as NormalizedMarketplaceListing[]
    },
    staleTime: 15_000,
    retry: false,
  })

  const listings = useMemo(() => {
    const chainFixed = chainProductsQuery.data ?? []
    const chainAuc = chainAuctionsQuery.data ?? []
    if (chainFixed.length || chainAuc.length) {
      return [...chainFixed, ...chainAuc]
    }
    // Demo seed aligned with ICT vectors when contracts configured
    if (hasContract) {
      return demoListingsFromMesh({
        fixedPriceContract: fp,
        auctionContract: auc,
        acceptedDenom: denom,
      })
    }
    return []
  }, [
    chainProductsQuery.data,
    chainAuctionsQuery.data,
    hasContract,
    fp,
    auc,
    denom,
  ])

  const usingDemo =
    hasContract &&
    !(chainProductsQuery.data?.length || chainAuctionsQuery.data?.length) &&
    listings.some((l) => l.source === 'demo')

  const storageMesh = dao.info.items[MESH_STORAGE_KEY]
  const catalogLoading =
    !!fp && chainProductsQuery.isLoading && !chainProductsQuery.data

  return (
    <div className="flex flex-col gap-4">
      <ModuleSectionHeader
        infoMarkdown={MARKETPLACE_INFO_MD}
        infoTitle={t('title.marketplace', { defaultValue: 'Marketplace' })}
        lede={
          description ? (
            <MarkdownRenderer className="text-sm" markdown={description} />
          ) : (
            t('info.marketplaceModuleIntroShort', {
              defaultValue: 'Browse and buy DAO inventory.',
            })
          )
        }
        title={t('title.marketplace', { defaultValue: 'Marketplace' })}
      />

      {meshQuery.isLoading ? (
        <p className="caption-text opacity-70">
          {t('info.marketplaceResolving', {
            defaultValue: 'Loading catalog…',
          })}
        </p>
      ) : meshError ? (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border-primary px-4 py-4">
          <p className="primary-text text-sm">
            {t('error.marketplaceMeshResolveFailedShort', {
              defaultValue:
                'Could not load marketplace config. Operators: enable Marketplace or publish mesh.v1.',
            })}
          </p>
          <DevOpsDisclosure>
            <DevOpsMonoLine
              value={
                meshError instanceof MeshResolveError
                  ? meshError.message
                  : meshError instanceof Error
                    ? meshError.message
                    : String(meshError)
              }
            />
          </DevOpsDisclosure>
        </div>
      ) : (
        <DevOpsDisclosure
          label={t('title.marketplaceDiscovery', {
            defaultValue: 'Operator · mesh.v1.marketplace',
          })}
        >
          <DevOpsMonoLine
            label="source"
            value={mesh ? meshSourceLabel(mesh.source) : 'module'}
          />
          <DevOpsMonoLine
            label="fixedPrice"
            value={marketplace.fixedPrice || '—'}
          />
          <DevOpsMonoLine label="auction" value={marketplace.auction || '—'} />
          <DevOpsMonoLine
            label="contentBase"
            value={marketplace.contentBase || '—'}
          />
          <DevOpsMonoLine
            label="acceptedDenom"
            value={marketplace.acceptedDenom || '—'}
          />
          <DevOpsMonoLine label="minBufferBlocks" value={String(buffer)} />
          <DevOpsMonoLine
            label="DAO storage"
            value={
              storageMesh ? 'mesh.v1 present' : 'not set (enable writes it)'
            }
          />
          {(mesh?.warnings?.length ?? 0) > 0 ? (
            <p className="caption-text opacity-80">
              {t('info.marketplaceMeshHints', {
                defaultValue:
                  'Mesh notes (setup only — not a checkout failure): {{hints}}',
                hints: mesh!.warnings
                  .map((w) =>
                    w
                      .replace(
                        /catalog cannot load[^.—]*/gi,
                        'catalog empty until contracts are set'
                      )
                      .trim()
                  )
                  .filter(Boolean)
                  .slice(0, 3)
                  .join(' · '),
              })}
            </p>
          ) : null}
        </DevOpsDisclosure>
      )}

      {!hasContract ? (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border-primary px-4 py-8 text-center">
          <p className="primary-text text-sm">
            {t('title.marketplaceCatalogEmpty', {
              defaultValue: 'No listings yet',
            })}
          </p>
          <p className="secondary-text text-sm">
            {t('info.marketplaceCatalogEmpty', {
              defaultValue:
                'This DAO has not published marketplace contracts. When mesh.v1.marketplace.fixedPrice or auction is set, inventory shows here automatically.',
            })}
          </p>
          <p className="caption-text opacity-60">
            {t('info.marketplaceCatalogEmptyHowTo', {
              defaultValue:
                'Operators: Manage Modules → Marketplace, or publish mesh.v1 on the DAO core.',
            })}
          </p>
        </div>
      ) : catalogLoading ? (
        <Loader />
      ) : (
        <>
          <MarketplaceCatalogPanel
            listings={listings}
            minBufferBlocks={buffer}
            onSelect={setSelected}
            showDemoBanner={usingDemo}
          />

          {selected?.kind === 'fixed' ? (
            <MarketplacePurchaseDrawer
              chainId={dao.chainId}
              listing={selected}
              minBufferBlocks={buffer}
              onClose={() => setSelected(null)}
              onPurchased={() => {
                void chainProductsQuery.refetch()
              }}
              onSettled={() => {
                void chainProductsQuery.refetch()
              }}
              onCancelled={() => {
                void chainProductsQuery.refetch()
              }}
            />
          ) : null}

          {selected?.kind === 'auction' || selected?.kind === 'buy_now' ? (
            <MarketplaceBidDrawer
              listing={selected}
              onClose={() => setSelected(null)}
              onBid={() => {
                void chainAuctionsQuery.refetch()
              }}
              onSettled={() => {
                void chainAuctionsQuery.refetch()
              }}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
