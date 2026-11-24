import { ArrowOutwardRounded, CollectionsBookmarkOutlined } from '@mui/icons-material'
import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useFieldArray, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { HugeDecimal } from '@dao-dao/math'
import { EligibleCollectionCardProps } from '@dao-dao/types'
import {
  getSupportedChainConfig,
  toAccessibleImageUrl,
} from '@dao-dao/utils'
import {
  Button,
  LinkWrapper,
  ProfileImage,
  TokenAmountDisplay,
  TooltipInfoIcon,
  TooltipLikeDisplay,
  useChain,
} from '@dao-dao/stateless'
import { InfuseNftsData } from '../../InfusionsRenderer'
import { asPath, prefixed } from '../../formPaths'


export const EligibleCollectionCard = ({
  fieldNamePrefix,
  nftAddr,
  paymentSub,
  requiredParams,
  index,
  nftInfo,
  contractInfo,
  bundleType,
  globalPaymentSub,
  onUseSingleFeeSubstitute,
}: EligibleCollectionCardProps) => {
  const { t } = useTranslation()
  const { chainId } = useChain()

  const [usingFeeSub, setUsingFeeSub] = useState<boolean>(false)
  const [imageLoading, setImageLoading] = useState(!!nftInfo.image)
  const [imageLoadErrored, setImageLoadErrored] = useState(false)
  const [loadedImageSrc, setLoadedImgSrc] = useState<string>()

  const { control, watch } = useFormContext<InfuseNftsData>()

  const bundlesPath = asPath<'infusionBundles'>(
    prefixed(fieldNamePrefix, 'infusionBundles')
  )
  const fundsPath = asPath<'funds'>(prefixed(fieldNamePrefix, 'funds'))

  const watchInfusionBundles = watch(bundlesPath) || []

  // funds field array keeps RHF paths aligned with HorizontalInfusionCard
  useFieldArray({
    control,
    name: fundsPath,
  })

  const selectedFromCollection = useMemo(() => {
    if (!Array.isArray(watchInfusionBundles)) {
      return 0
    }
    return watchInfusionBundles.reduce((count: number, bundle: any) => {
      const n = (bundle?.nfts || []).filter(
        (n: { addr: string }) => n.addr === nftAddr
      ).length
      return count + n
    }, 0)
  }, [watchInfusionBundles, nftAddr])

  const minReq = requiredParams.min_req || 1
  const maxReq = requiredParams.max_req ?? null
  const metMin = selectedFromCollection >= minReq

  const collectionExplorerUrl = (() => {
    const templates = getSupportedChainConfig(chainId)?.explorerUrlTemplates
    if (templates?.wallet) {
      // Best-effort: many explorers use account path for contracts too.
      return templates.wallet.replace('REPLACE', nftAddr)
    }
    return `https://explorer.terp.network/account/${nftAddr}`
  })()

  const onSetFeeSub = () => {
    const next = !usingFeeSub
    setUsingFeeSub(next)
    onUseSingleFeeSubstitute(nftAddr, next)
  }

  useEffect(() => {
    if (
      // If showing a video, don't load image.
      //   video ||
      !nftInfo.image ||
      loadedImageSrc === toAccessibleImageUrl(nftInfo.image)
    ) {
      return
    }

    setImageLoading(true)

    const img = new Image()
    img.onload = () => {
      setLoadedImgSrc(img.src)
      setImageLoading(false)
      setImageLoadErrored(false)
    }
    img.onerror = () => {
      setLoadedImgSrc(undefined)
      setImageLoading(false)
      setImageLoadErrored(true)
    }
    img.src = toAccessibleImageUrl(nftInfo.image)
  }, [nftInfo.image, loadedImageSrc])

  const showingImageUrl = nftInfo.image && !imageLoadErrored


  return (
    <div
      className={clsx(
        'flex flex-col justify-between rounded-lg border shadow-sm transition-colors',
        usingFeeSub
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400'
          : 'border-border-primary'
      )}
    >

      <div className="flex flex-col items-center">
        <div className="p-6 pb-4">
          <ProfileImage
            imageUrl={loadedImageSrc}
            loading={imageLoading}
            rounded={true}
            size="lg"
          />
        </div>

        <div className="px-6 pb-4">
          <div className="flex flex-col items-center gap-1">
            <div className="flex flex-row items-center gap-1 text-text-tertiary">
              <CollectionsBookmarkOutlined className="!h-4 !w-4" />
              <span className="secondary-text text-xs uppercase tracking-wide">
                {t('info.eligibleSourceCollection', {
                  defaultValue: 'Source collection',
                })}
              </span>
            </div>
            <LinkWrapper
              href={collectionExplorerUrl}
              onClick={(e) => e.stopPropagation()}
              openInNewTab
              className="relative group"
            >
              <TooltipLikeDisplay
                className="group-hover:opacity-100 absolute -top-8 left-1/2 z-10 -translate-x-1/2 transform opacity-0 shadow-dp4 transition-opacity hover:!opacity-90"
                icon={<ArrowOutwardRounded className="!h-4 !w-4" />}
                label={t('button.openInDestination', {
                  destination: t('info.explorer', { defaultValue: 'Explorer' }),
                })}
              />
              <h3 className="title-text text-center text-lg font-medium text-text-body transition-colors hover:text-text-interactive-hover">
                {contractInfo.name}
              </h3>
            </LinkWrapper>
            <p className="secondary-text max-w-full truncate font-mono text-xs">
              {nftAddr}
            </p>
          </div>
        </div>

        <div className="w-full border-t border-border-interactive-disabled" />

        <div className="w-full space-y-3 px-6 py-4">
          <p className="secondary-text text-center text-xs">
            {t('info.infusionComposableHint', {
              defaultValue:
                'Compose bundles from this collection. Select NFTs you hold — each bundle must meet min requirements (or pay a substitute).',
            })}
          </p>

          <div className="flex flex-col items-center space-y-1">
            <div className="flex items-center">
              <span className="secondary-text text-xs font-medium uppercase tracking-wide">
                {t('info.minRequired')}
              </span>
              <TooltipInfoIcon
                className="ml-1"
                size="xs"
                title={t('info.minRequiredTooltip', {
                  defaultValue:
                    'Minimum NFTs from this collection required per infusion bundle (AllOf requires every collection).',
                })}
              />
            </div>
            <span
              className={clsx(
                'primary-text text-base font-semibold',
                metMin ? 'text-text-interactive-valid' : 'text-text-body'
              )}
            >
              {selectedFromCollection} / {minReq}
              {maxReq != null ? ` (max ${maxReq})` : ''}
            </span>
            <span className="secondary-text text-xs">
              {metMin
                ? t('info.collectionMinMet', {
                    defaultValue: 'Minimum met for this collection',
                  })
                : t('info.collectionMinNeeded', {
                    defaultValue: 'Add more NFTs from this collection',
                  })}
            </span>
          </div>

          {requiredParams.payment_substitute && (
            <div className="flex flex-col items-center space-y-3 pt-2">
              <div className="flex items-center">
                <span className="secondary-text text-xs font-medium uppercase tracking-wide">
                  {t('info.paymentSubstitute')}
                </span>
                <TooltipInfoIcon
                  className="ml-1"
                  size="xs"
                  title={t('info.paymentSubstituteTooltip', {
                    defaultValue:
                      'Pay tokens instead of burning NFTs from this collection. Static mint fees still apply.',
                  })}
                />
              </div>
              <TokenAmountDisplay
                amount={HugeDecimal.from(
                  requiredParams.payment_substitute.balance
                )}
                decimals={requiredParams.payment_substitute.token.decimals}
                iconUrl={requiredParams.payment_substitute.token.imageUrl}
                showFullAmount
                symbol={requiredParams.payment_substitute.token.symbol}
              />
              {paymentSub && !globalPaymentSub && (
                <div className="pt-2">
                  <Button onClick={onSetFeeSub} size="sm" variant="secondary">
                    {usingFeeSub
                      ? t('button.removePaymentSubstitute')
                      : t('button.usePaymentSubstitute')}
                  </Button>
                </div>
              )}
              {usingFeeSub && 'any_of' in bundleType && (
                <p className="secondary-text text-center text-xs">
                  {t('info.anyOfFeeSubHint', {
                    defaultValue:
                      'AnyOf: fee substitute covers this collection slot for the bundle.',
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
