import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import { TerpAuctionClient } from '@dao-dao/state/contracts'
import {
  AUCTION_HONESTY_COPY,
  CHAIN_GAS_MULTIPLIER,
  MARKETPLACE_NOSTR_KINDS,
  NormalizedMarketplaceListing,
  buildBidIntent,
  computeMinBidAmount,
  isAuctionLive,
  mapPurchaseError,
  processError,
  secondsUntilEnd,
} from '@dao-dao/utils'

import { useWallet } from '../../../hooks'
import { MarketplaceTxReceipt } from './MarketplaceTxReceipt'

export type MarketplaceBidDrawerProps = {
  listing: NormalizedMarketplaceListing
  chainId: string
  /** CosmWasm Decimal min bid increment from auction Config (default 0). */
  minIncrement?: string
  onClose: () => void
  onBid?: (info: {
    auctionId: string
    amount: string
    denom: string
    mode: 'auction' | 'buy_now'
    txHash?: string
  }) => void
  onSettled?: (auctionId: string) => void
}

/** Progressive steps: price → confirm → advanced (EN-F5 / P1.1). */
type FormStep = 'price' | 'confirm' | 'advanced'

/**
 * M5 — NFT auction PlaceBid + Buy-now path.
 * Chain: TerpAuction place_bid / settle (authoritative).
 * NIP-15: kinds 30020 / 1021 / 1022 are progressive only (see marketplaceNostr).
 * EN-F5: after bid/settle TX, auto-copy explorer link.
 */
export const MarketplaceBidDrawer = ({
  listing,
  chainId,
  minIncrement = '0',
  onClose,
  onBid,
  onSettled,
}: MarketplaceBidDrawerProps) => {
  const { t } = useTranslation()
  const {
    address: walletAddress,
    isWalletConnected,
    getSigningClient,
    connect,
    refreshBalances,
  } = useWallet()

  const isBuyNow = listing.kind === 'buy_now'
  const isAuction = listing.kind === 'auction'
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const minBid = useMemo(
    () =>
      computeMinBidAmount({
        reservePrice: listing.reservePrice || listing.price || '0',
        highBid: listing.highBid,
        minIncrement,
      }),
    [listing.reservePrice, listing.price, listing.highBid, minIncrement]
  )
  const [bidAmount, setBidAmount] = useState(minBid)
  const [submitting, setSubmitting] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [phase, setPhase] = useState<'form' | 'bid_placed' | 'settled'>('form')
  const [formStep, setFormStep] = useState<FormStep>('price')

  useEffect(() => {
    setBidAmount(minBid)
  }, [minBid])

  useEffect(() => {
    const id = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000
    )
    return () => window.clearInterval(id)
  }, [])

  const remaining = secondsUntilEnd(listing.endTime, now)
  const live = isAuctionLive(listing, now)

  const intent = useMemo(
    () =>
      buildBidIntent({
        listing,
        bidAmount: isBuyNow ? undefined : bidAmount,
        minIncrement,
      }),
    [listing, bidAmount, isBuyNow, minIncrement]
  )

  const runBid = useCallback(async () => {
    if (!isAuction && !isBuyNow) return
    if (!isWalletConnected || !walletAddress) {
      toast.error(AUCTION_HONESTY_COPY.connectWallet)
      try {
        await connect()
      } catch {
        /* */
      }
      return
    }
    if ('error' in intent) {
      toast.error(intent.error)
      return
    }
    if (listing.source === 'demo') {
      toast.error(AUCTION_HONESTY_COPY.demoNoChain)
    }
    if (!live && isAuction) {
      toast.error(AUCTION_HONESTY_COPY.auctionEnded)
      return
    }

    setSubmitting(true)
    try {
      const signing = await getSigningClient()
      const client = new TerpAuctionClient(
        signing,
        walletAddress,
        intent.contract
      )
      const result = await client.placeBid(
        { auctionId: intent.auctionId },
        CHAIN_GAS_MULTIPLIER,
        isBuyNow ? 'marketplace buy_now' : 'marketplace place_bid',
        [{ denom: intent.denom, amount: intent.fundsAmount }]
      )
      setTxHash(result.transactionHash)
      setPhase('bid_placed')
      toast.success(
        isBuyNow
          ? t('success.marketplaceBuyNow', {
              defaultValue: 'Buy-now submitted on-chain.',
            })
          : t('success.marketplaceBid', {
              defaultValue: 'Bid submitted on-chain (NIP-15 1021 is not finality).',
            })
      )
      refreshBalances?.()
      onBid?.({
        auctionId: intent.auctionId,
        amount: intent.fundsAmount,
        denom: intent.denom,
        mode: intent.mode,
        txHash: result.transactionHash,
      })
    } catch (err) {
      console.error(err)
      toast.error(mapPurchaseError(err) || processError(err))
    } finally {
      setSubmitting(false)
    }
  }, [
    isAuction,
    isBuyNow,
    isWalletConnected,
    walletAddress,
    intent,
    listing.source,
    live,
    getSigningClient,
    connect,
    refreshBalances,
    onBid,
    t,
  ])

  const runSettle = useCallback(async () => {
    if (!listing.auctionId || !walletAddress) return
    setSubmitting(true)
    try {
      const signing = await getSigningClient()
      const client = new TerpAuctionClient(
        signing,
        walletAddress,
        listing.contract
      )
      const result = await client.settle(
        { auctionId: listing.auctionId },
        CHAIN_GAS_MULTIPLIER,
        'marketplace settle auction'
      )
      setTxHash(result.transactionHash)
      setPhase('settled')
      toast.success(
        t('success.marketplaceAuctionSettled', {
          defaultValue: 'Auction settled on-chain.',
        })
      )
      onSettled?.(listing.auctionId)
    } catch (err) {
      console.error(err)
      toast.error(mapPurchaseError(err) || processError(err))
    } finally {
      setSubmitting(false)
    }
  }, [
    listing.auctionId,
    listing.contract,
    walletAddress,
    getSigningClient,
    onSettled,
    t,
  ])

  if (!isAuction && !isBuyNow) {
    return null
  }

  const formatCountdown = (s: number | null) => {
    if (s == null) return '—'
    if (s <= 0) return 'ended'
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${h}h ${m}m ${sec}s`
  }

  const stepIndex =
    formStep === 'price' ? 0 : formStep === 'confirm' ? 1 : 2

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-primary p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="primary-text text-sm">
            {isBuyNow
              ? t('title.marketplaceBuyNow', { defaultValue: 'Buy now' })
              : t('title.marketplacePlaceBid', { defaultValue: 'Place bid' })}
          </p>
          <p className="secondary-text mt-0.5 font-mono text-xs">
            auction #{listing.auctionId} · {listing.title}
          </p>
        </div>
        <button
          className="text-xs text-text-secondary underline"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="secondary-text">Reserve / price</span>
          <p className="font-mono">
            {listing.reservePrice || listing.price} {listing.denom}
          </p>
        </div>
        <div>
          <span className="secondary-text">High bid</span>
          <p className="font-mono">
            {listing.highBid && listing.highBid !== '0'
              ? `${listing.highBid} ${listing.denom}`
              : '—'}
          </p>
        </div>
        <div>
          <span className="secondary-text">Countdown</span>
          <p className="font-mono">{formatCountdown(remaining)}</p>
        </div>
        <div>
          <span className="secondary-text">Min next bid</span>
          <p className="font-mono">
            {minBid} {listing.denom}
          </p>
        </div>
      </div>

      {listing.nftContract ? (
        <p className="font-mono text-[10px] text-text-tertiary break-all">
          nft {listing.nftContract} #{listing.tokenId}
        </p>
      ) : null}

      {listing.source === 'demo' ? (
        <p className="text-xs text-text-interactive-warning-body">
          {AUCTION_HONESTY_COPY.demoNoChain}
        </p>
      ) : null}

      {phase === 'form' ? (
        <>
          <div
            aria-label="Bid steps"
            className="flex flex-wrap gap-1.5 text-[11px]"
            role="tablist"
          >
            {(
              [
                ['price', '1 · Price'],
                ['confirm', '2 · Confirm'],
                ['advanced', '3 · Advanced'],
              ] as const
            ).map(([id, label], i) => (
              <button
                key={id}
                aria-selected={formStep === id}
                className={
                  formStep === id
                    ? 'rounded-full border border-border-interactive-focus bg-background-button-secondary px-2.5 py-1 font-medium'
                    : i < stepIndex
                      ? 'rounded-full border border-border-primary bg-background-secondary px-2.5 py-1 text-text-secondary'
                      : 'rounded-full border border-border-primary px-2.5 py-1 text-text-tertiary'
                }
                onClick={() => setFormStep(id)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          {formStep === 'price' ? (
            <>
              {!isBuyNow ? (
                <label className="flex flex-col gap-1 text-xs">
                  <span className="secondary-text">Bid amount (micro-denom)</span>
                  <input
                    className="w-full rounded border border-border-primary bg-background-base px-2 py-1 font-mono"
                    disabled={submitting || !live}
                    onChange={(e) => setBidAmount(e.target.value)}
                    value={bidAmount}
                  />
                </label>
              ) : (
                <p className="text-sm font-mono">
                  {AUCTION_HONESTY_COPY.buyNow}: {minBid} {listing.denom}
                </p>
              )}
              <button
                className="self-start rounded-md bg-background-button px-3 py-2 text-xs text-text-button-primary disabled:opacity-50"
                disabled={
                  ('error' in intent) || (isAuction && !live)
                }
                onClick={() => setFormStep('confirm')}
                type="button"
              >
                Continue to confirm
              </button>
            </>
          ) : null}

          {formStep === 'confirm' ? (
            <>
              <div className="rounded border border-border-primary bg-background-secondary/40 p-3 text-xs">
                <p className="font-medium">
                  {isBuyNow ? 'Confirm buy now' : 'Confirm bid'}
                </p>
                <p className="mt-1 font-mono">
                  {isBuyNow
                    ? `${minBid} ${listing.denom}`
                    : `${bidAmount} ${listing.denom}`}
                </p>
                <p className="mt-1 text-text-tertiary">
                  {AUCTION_HONESTY_COPY.nipBidNotChain}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-md border border-border-primary px-3 py-2 text-xs"
                  onClick={() => setFormStep('price')}
                  type="button"
                >
                  Back
                </button>
                {!isWalletConnected ? (
                  <button
                    className="rounded-md bg-background-button px-3 py-2 text-xs text-text-button-primary"
                    onClick={() => connect()}
                    type="button"
                  >
                    Connect wallet
                  </button>
                ) : (
                  <button
                    className="rounded-md bg-background-button px-3 py-2 text-xs text-text-button-primary disabled:opacity-50"
                    disabled={
                      submitting ||
                      'error' in intent ||
                      (isAuction && !live)
                    }
                    onClick={runBid}
                    type="button"
                  >
                    {submitting
                      ? 'Signing…'
                      : isBuyNow
                        ? `Buy now · ${'error' in intent ? '—' : intent.fundsAmount}`
                        : `Place bid · ${bidAmount}`}
                  </button>
                )}
                <button
                  className="rounded-md border border-border-primary px-3 py-2 text-xs text-text-secondary"
                  onClick={() => setFormStep('advanced')}
                  type="button"
                >
                  Advanced
                </button>
              </div>
            </>
          ) : null}

          {formStep === 'advanced' ? (
            <>
              <ul className="secondary-text list-inside list-disc text-[11px]">
                <li>
                  Chain PlaceBid is authoritative · NIP-15 kind{' '}
                  {MARKETPLACE_NOSTR_KINDS.bid} is progressive only
                </li>
                <li>{AUCTION_HONESTY_COPY.nipBidNotChain}</li>
                <li>{AUCTION_HONESTY_COPY.nostrNotFinal}</li>
                <li>
                  Auction product kind {MARKETPLACE_NOSTR_KINDS.auctionProduct} ·
                  confirm {MARKETPLACE_NOSTR_KINDS.bidConfirmation}
                </li>
                <li className="font-mono break-all">
                  contract {listing.contract}
                </li>
              </ul>
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-md border border-border-primary px-3 py-2 text-xs"
                  onClick={() => setFormStep('confirm')}
                  type="button"
                >
                  Back to confirm
                </button>
                {isWalletConnected ? (
                  <button
                    className="rounded-md bg-background-button px-3 py-2 text-xs text-text-button-primary disabled:opacity-50"
                    disabled={
                      submitting ||
                      'error' in intent ||
                      (isAuction && !live)
                    }
                    onClick={runBid}
                    type="button"
                  >
                    {submitting
                      ? 'Signing…'
                      : isBuyNow
                        ? `Buy now · ${'error' in intent ? '—' : intent.fundsAmount}`
                        : `Place bid · ${bidAmount}`}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {phase === 'bid_placed' || phase === 'settled' ? (
        <div className="rounded border border-border-primary p-3 text-xs">
          <p className="font-medium">
            {phase === 'settled' ? 'Settled' : 'Bid / buy submitted'}
          </p>
          {txHash ? (
            <MarketplaceTxReceipt
              chainId={chainId}
              className="mt-2 flex flex-col gap-1.5"
              txHash={txHash}
            />
          ) : null}
          {phase === 'bid_placed' ? (
            <button
              className="mt-2 rounded-md border border-border-primary px-3 py-2 text-xs disabled:opacity-50"
              disabled={submitting}
              onClick={runSettle}
              type="button"
            >
              Settle auction (after end)
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
