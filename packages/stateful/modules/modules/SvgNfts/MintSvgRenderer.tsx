import { useQuery, useQueries } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import {
  cwSvgMinterQueries,
  nftQueries,
  normalizeSvgCollectionAddress,
} from '@dao-dao/state/query'
import { CommonNftSelectors } from '@dao-dao/state/recoil'
import {
  Button,
  HorizontalScroller,
  MarkdownRenderer,
  NftCard,
  Tooltip,
  useCachedLoadable,
  useChain,
} from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'
import {
  executeSmartContract,
  makeCombineQueryResultsIntoLoadingData,
  processError,
} from '@dao-dao/utils'

import { useSmartAccount } from '../../../hooks/useSmartAccount'
import { useWallet } from '../../../hooks/useWallet'
import { OneClickShitstrapMint } from './OneClickShitstrapMint'
import { SvgNftModuleData } from './types'

/**
 * Browse + mint SVG collection using dao-dao-ui wallet/execute heuristics
 * (same patterns as MintNft module, plus Terp smartaccount tx options).
 * Lists collections from cw-svg-minter when configured (static site parity).
 */
export const MintNftRenderer = ({
  variables: {
    nftCollection,
    svgMinter,
    description,
    mint: { contract, msg, buttonLabel },
  },
}: ModuleRendererProps<SvgNftModuleData>) => {
  const { t } = useTranslation()
  const { chainId } = useChain()
  const { address: walletAddress = '', isWalletConnected } = useWallet()
  const { resolveTxOptions, getSigningClientForTx, rememberSelected } =
    useSmartAccount({
      chainId,
      address: walletAddress,
    })

  const [minting, setMinting] = useState(false)
  const [selectedCollection, setSelectedCollection] = useState(nftCollection)

  const activeCollection = selectedCollection || nftCollection
  const mintContract = contract || activeCollection

  const collectionsQuery = useQuery({
    ...cwSvgMinterQueries.listSvgCollectionsReverse({
      chainId,
      contractAddress: svgMinter || '',
      limit: 40,
    }),
    enabled: !!svgMinter,
  })

  const collectionAddresses = useMemo(() => {
    const raw = collectionsQuery.data || []
    return raw
      .map((item) => normalizeSvgCollectionAddress(item))
      .filter(Boolean)
  }, [collectionsQuery.data])

  const allTokensLoadable = useCachedLoadable(
    activeCollection
      ? CommonNftSelectors.unpaginatedAllTokensSelector({
          contractAddress: activeCollection,
          chainId,
        })
      : undefined
  )

  const first100Cards = useQueries({
    queries:
      allTokensLoadable.state === 'hasValue' && activeCollection
        ? allTokensLoadable.contents.slice(0, 100).map((tokenId) =>
            nftQueries.cardInfo({
              collection: activeCollection,
              chainId,
              tokenId,
            })
          )
        : [],
    combine: makeCombineQueryResultsIntoLoadingData(),
  })

  const onMint = async () => {
    if (!walletAddress) {
      toast.error(t('error.logInToContinue'))
      return
    }
    if (!mintContract) {
      toast.error(
        t('error.noContract', {
          defaultValue: 'No mint contract configured for this module.',
        })
      )
      return
    }

    setMinting(true)
    try {
      const mintMsg = JSON.parse(
        msg.replaceAll('{{wallet}}', walletAddress)
      ) as object

      const txOptions = await resolveTxOptions(1)
      const client = await getSigningClientForTx(txOptions)

      await executeSmartContract(
        client,
        walletAddress,
        mintContract,
        mintMsg,
        undefined,
        undefined,
        undefined,
        txOptions
      )

      rememberSelected()
      toast.success(t('success.transactionSuccess', { defaultValue: 'Minted' }))
    } catch (err) {
      console.error(err)
      toast.error(
        processError(err, {
          forceCapture: false,
        })
      )
    } finally {
      setMinting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {description && (
        <MarkdownRenderer className="text-base" markdown={description} />
      )}

      {svgMinter && (
        <div className="flex flex-col gap-2">
          <p className="primary-text text-sm">
            {t('title.svgCollections', {
              defaultValue: 'SVG collections',
            })}
          </p>
          {collectionsQuery.isLoading ? (
            <p className="secondary-text text-xs">
              {t('info.loading', { defaultValue: 'Loading…' })}
            </p>
          ) : collectionsQuery.isError ? (
            <p className="text-xs text-text-interactive-error">
              {t('error.failedToLoadCollections', {
                defaultValue: 'Could not list collections from svg minter.',
              })}
            </p>
          ) : collectionAddresses.length === 0 ? (
            <p className="secondary-text text-xs">
              {t('info.noSvgCollections', {
                defaultValue: 'No collections returned from minter yet.',
              })}
            </p>
          ) : (
            <div className="flex flex-row flex-wrap gap-1">
              {collectionAddresses.map((addr) => (
                <Button
                  key={addr}
                  onClick={() => setSelectedCollection(addr)}
                  pressed={activeCollection === addr}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {addr.slice(0, 10)}…{addr.slice(-6)}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {!activeCollection ? (
        <p className="secondary-text text-sm">
          {t('info.configureSvgCollection', {
            defaultValue:
              'Set a cw721_svg collection or svg minter in the module editor to browse and mint.',
          })}
        </p>
      ) : (
        (first100Cards.loading || first100Cards.data.length > 0) && (
          <HorizontalScroller
            Component={NftCard}
            containerClassName="-mx-16 3xl:-mx-64 px-[1px]"
            itemClassName="w-64"
            items={first100Cards}
            shadowClassName="w-16 3xl:w-64"
          />
        )
      )}

      {activeCollection && (
        <p className="secondary-text font-mono text-xs break-all">
          {activeCollection}
        </p>
      )}

      <Tooltip
        title={isWalletConnected ? undefined : t('error.logInToContinue')}
      >
        <Button
          center
          disabled={!isWalletConnected || !mintContract}
          loading={minting}
          onClick={onMint}
          size="lg"
        >
          {buttonLabel}
        </Button>
      </Tooltip>

      {activeCollection && (
        <OneClickShitstrapMint
          chainId={chainId}
          collectionAddress={activeCollection}
          mintContract={mintContract}
          mintDenom="uthiol"
          pricePerToken="0"
          quantity={1}
        />
      )}
    </div>
  )
}
