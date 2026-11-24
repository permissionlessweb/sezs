import { useCallback, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import { MarketplaceMirrorClient } from '@dao-dao/state/contracts'
import {
  BUFFER_HONESTY_COPY,
  CHAIN_GAS_MULTIPLIER,
  NormalizedMarketplaceListing,
  buildPurchaseIntent,
  clampPurchaseQty,
  computePurchaseFunds,
  computeSettleAfter,
  mapPurchaseError,
  processError,
  settleAllowedAtHeight,
} from '@dao-dao/utils'

import { useWallet } from '../../../hooks'
import { MarketplaceTxReceipt } from './MarketplaceTxReceipt'

export type MarketplacePurchaseDrawerProps = {
  listing: NormalizedMarketplaceListing
  minBufferBlocks?: number
  chainId: string
  /** Current chain height when known (enables settle CTA). */
  chainHeight?: number | null
  /** Last reserved order after successful purchase (from events or user input). */
  lastOrderId?: number | null
  lastSettleAfter?: number | null
  onClose: () => void
  onPurchased?: (info: {
    sku: string
    qty: number
    funds: string
    denom: string
    txHash?: string
  }) => void
  onSettled?: (orderId: number) => void
  onCancelled?: (orderId: number) => void
}

/** Progressive steps: price → confirm → advanced (EN-F5 / P1.1). */
type FormStep = 'price' | 'confirm' | 'advanced'

/**
 * M4 — fixed-price purchase drawer.
 * qty ≤ available; funds = unit_price * qty; buffer honesty; no seller cancel.
 * Auction/buy_now → M5.
 * EN-F5: after purchase/settle TX, auto-copy explorer link.
 */
export const MarketplacePurchaseDrawer = ({
  listing,
  minBufferBlocks = 7,
  chainId,
  chainHeight,
  lastOrderId: lastOrderIdProp,
  lastSettleAfter: lastSettleAfterProp,
  onClose,
  onPurchased,
  onSettled,
  onCancelled,
}: MarketplacePurchaseDrawerProps) => {
  const { t } = useTranslation()
  const {
    address: walletAddress,
    isWalletConnected,
    getSigningClient,
    connect,
    refreshBalances,
  } = useWallet()

  const available = listing.available ?? 0
  const [qty, setQty] = useState(() => clampPurchaseQty(1, available) || 0)
  const [submitting, setSubmitting] = useState(false)
  const [phase, setPhase] = useState<'form' | 'reserved' | 'done'>('form')
  const [formStep, setFormStep] = useState<FormStep>('price')
  const [localOrderId, setLocalOrderId] = useState<number | null>(null)
  const [localSettleAfter, setLocalSettleAfter] = useState<number | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  const orderId = lastOrderIdProp ?? localOrderId
  const settleAfter = lastSettleAfterProp ?? localSettleAfter

  const clamped = clampPurchaseQty(qty, available)
  const funds =
    listing.price != null
      ? computePurchaseFunds(listing.price, clamped)
      : '0'

  const intent = useMemo(
    () =>
      buildPurchaseIntent({
        listing,
        qty: clamped,
        minBufferBlocks,
      }),
    [listing, clamped, minBufferBlocks]
  )

  const canSettle =
    orderId != null &&
    settleAfter != null &&
    chainHeight != null &&
    settleAllowedAtHeight(settleAfter, chainHeight)

  const isFixed = listing.kind === 'fixed' && !!listing.sku
  const isDemo = listing.source === 'demo'

  const runPurchase = useCallback(async () => {
    if (!isFixed) return
    if (!isWalletConnected || !walletAddress) {
      toast.error(BUFFER_HONESTY_COPY.connectWallet)
      try {
        await connect()
      } catch {
        /* user rejected */
      }
      return
    }
    if ('error' in intent) {
      toast.error(intent.error)
      return
    }
    if (isDemo) {
      toast.error(BUFFER_HONESTY_COPY.demoNoChain)
      // Still allow attempt if operator listed same SKU — chain will reject if missing
    }

    setSubmitting(true)
    try {
      const signing = await getSigningClient()
      const client = new MarketplaceMirrorClient(
        signing,
        walletAddress,
        intent.contract
      )
      const result = await client.purchase(
        { qty: intent.qty, sku: intent.sku },
        CHAIN_GAS_MULTIPLIER,
        'marketplace purchase',
        [{ denom: intent.denom, amount: intent.fundsAmount }]
      )
      setTxHash(result.transactionHash)
      setPhase('reserved')
      // Best-effort: estimate settle_after from current height if we can read it
      try {
        const h = await signing.getHeight()
        setLocalSettleAfter(computeSettleAfter(h, minBufferBlocks))
      } catch {
        setLocalSettleAfter(null)
      }
      // Parse order id from events when present
      const oid = extractOrderIdFromResult(result)
      if (oid != null) setLocalOrderId(oid)

      toast.success(
        t('success.marketplacePurchaseReserved', {
          defaultValue:
            'Purchase reserved (on-chain buffer). Settle after buffer elapses.',
        })
      )
      refreshBalances?.()
      onPurchased?.({
        sku: intent.sku,
        qty: intent.qty,
        funds: intent.fundsAmount,
        denom: intent.denom,
        txHash: result.transactionHash,
      })
    } catch (err) {
      console.error(err)
      toast.error(mapPurchaseError(err) || processError(err))
    } finally {
      setSubmitting(false)
    }
  }, [
    isFixed,
    isWalletConnected,
    walletAddress,
    intent,
    isDemo,
    getSigningClient,
    minBufferBlocks,
    connect,
    refreshBalances,
    onPurchased,
    t,
  ])

  const runSettle = useCallback(async () => {
    if (orderId == null || !walletAddress) return
    if (
      settleAfter != null &&
      chainHeight != null &&
      !settleAllowedAtHeight(settleAfter, chainHeight)
    ) {
      toast.error(
        `${BUFFER_HONESTY_COPY.earlySettle} (need ≥ ${settleAfter}, height ${chainHeight})`
      )
      return
    }
    setSubmitting(true)
    try {
      const signing = await getSigningClient()
      const client = new MarketplaceMirrorClient(
        signing,
        walletAddress,
        listing.contract
      )
      const result = await client.settle(
        { orderId },
        CHAIN_GAS_MULTIPLIER,
        'marketplace settle'
      )
      setTxHash(result.transactionHash)
      setPhase('done')
      toast.success(
        t('success.marketplaceSettled', {
          defaultValue: 'Order settled. Stock committed on-chain.',
        })
      )
      onSettled?.(orderId)
    } catch (err) {
      console.error(err)
      toast.error(mapPurchaseError(err) || processError(err))
    } finally {
      setSubmitting(false)
    }
  }, [
    orderId,
    walletAddress,
    settleAfter,
    chainHeight,
    getSigningClient,
    listing.contract,
    onSettled,
    t,
  ])

  const runCancel = useCallback(async () => {
    if (orderId == null || !walletAddress) return
    setSubmitting(true)
    try {
      const signing = await getSigningClient()
      const client = new MarketplaceMirrorClient(
        signing,
        walletAddress,
        listing.contract
      )
      const result = await client.cancel(
        { orderId },
        CHAIN_GAS_MULTIPLIER,
        'marketplace cancel (buyer)'
      )
      setTxHash(result.transactionHash)
      setPhase('done')
      toast.success(
        t('success.marketplaceCancelled', {
          defaultValue: 'Order cancelled. Reserved stock released.',
        })
      )
      onCancelled?.(orderId)
    } catch (err) {
      console.error(err)
      toast.error(mapPurchaseError(err) || processError(err))
    } finally {
      setSubmitting(false)
    }
  }, [
    orderId,
    walletAddress,
    getSigningClient,
    listing.contract,
    onCancelled,
    t,
  ])

  if (!isFixed) {
    return (
      <div className="rounded-md border border-border-primary p-4">
        <p className="primary-text text-sm">
          {t('title.marketplaceAuctionDefer', {
            defaultValue: 'Auction / buy-now — M5 bid drawer',
          })}
        </p>
        <p className="secondary-text mt-1 text-xs">
          {BUFFER_HONESTY_COPY.nostrNotFinal}
        </p>
        <button
          className="mt-3 text-xs underline"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      </div>
    )
  }

  const stepIndex =
    formStep === 'price' ? 0 : formStep === 'confirm' ? 1 : 2

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-primary p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="primary-text text-sm">
            {t('title.marketplacePurchase', {
              defaultValue: 'Purchase (fixed-price)',
            })}
          </p>
          <p className="secondary-text mt-0.5 font-mono text-xs">
            {listing.sku} · {listing.title}
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

      {isDemo ? (
        <p className="text-xs text-text-interactive-warning-body">
          {BUFFER_HONESTY_COPY.demoNoChain}
        </p>
      ) : null}

      {phase === 'form' ? (
        <>
          {/* Progressive: price → confirm → advanced */}
          <div
            aria-label="Purchase steps"
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
                onClick={() => {
                  // Allow back/forward freely; confirm requires valid qty
                  if (id === 'confirm' && (clamped < 1 || available <= 0)) {
                    toast.error('Pick a quantity first')
                    return
                  }
                  setFormStep(id)
                }}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          {formStep === 'price' ? (
            <>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="secondary-text">Unit price</span>
                  <p className="font-mono">
                    {listing.price} {listing.denom}
                  </p>
                </div>
                <div>
                  <span className="secondary-text">Available</span>
                  <p className="font-mono">
                    {available}
                    {listing.reserved ? ` (reserved ${listing.reserved})` : ''}
                    {listing.stock != null ? ` / stock ${listing.stock}` : ''}
                  </p>
                </div>
              </div>

              <label className="flex flex-col gap-1 text-xs">
                <span className="secondary-text">
                  Qty (max available={available})
                </span>
                <input
                  className="w-24 rounded border border-border-primary bg-background-base px-2 py-1 font-mono"
                  disabled={available <= 0 || submitting}
                  max={available}
                  min={1}
                  onChange={(e) =>
                    setQty(clampPurchaseQty(Number(e.target.value), available))
                  }
                  type="number"
                  value={clamped || ''}
                />
              </label>

              <p className="font-mono text-sm">
                Total: {funds} {listing.denom}
              </p>

              <button
                className="self-start rounded-md bg-background-button px-3 py-2 text-xs text-text-button-primary disabled:opacity-50"
                disabled={available <= 0 || clamped < 1}
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
                <p className="font-medium">Confirm purchase</p>
                <p className="mt-1 font-mono">
                  {clamped} × {listing.sku} = {funds} {listing.denom}
                </p>
                <p className="mt-1 text-text-tertiary">
                  {BUFFER_HONESTY_COPY.reserved}
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
                    className="rounded-md bg-background-button px-3 py-2 text-xs text-text-button-primary disabled:opacity-50"
                    disabled={submitting}
                    onClick={() => connect()}
                    type="button"
                  >
                    Connect wallet
                  </button>
                ) : (
                  <button
                    className="rounded-md bg-background-button px-3 py-2 text-xs text-text-button-primary disabled:opacity-50"
                    disabled={submitting || available <= 0 || clamped < 1}
                    onClick={runPurchase}
                    type="button"
                  >
                    {submitting ? 'Signing…' : `Purchase ×${clamped}`}
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
                <li>{BUFFER_HONESTY_COPY.reserved}</li>
                <li>
                  Buffer {minBufferBlocks} blocks · settle_after = height +{' '}
                  {minBufferBlocks}
                </li>
                <li>{BUFFER_HONESTY_COPY.sellerCancel}</li>
                <li>{BUFFER_HONESTY_COPY.nostrNotFinal}</li>
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
                    disabled={submitting || available <= 0 || clamped < 1}
                    onClick={runPurchase}
                    type="button"
                  >
                    {submitting ? 'Signing…' : `Purchase ×${clamped}`}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {phase === 'reserved' || phase === 'done' ? (
        <div className="flex flex-col gap-2 rounded border border-border-interactive-warning p-3 text-xs">
          <p className="font-medium text-text-interactive-warning-body">
            {phase === 'done'
              ? 'Order terminal'
              : BUFFER_HONESTY_COPY.reserved}
          </p>
          {txHash ? (
            <MarketplaceTxReceipt chainId={chainId} txHash={txHash} />
          ) : null}
          <p className="font-mono">
            order_id: {orderId ?? '— (parse from tx / query ListOrders)'}
          </p>
          <p className="font-mono">
            settle_after: {settleAfter ?? '—'} · height:{' '}
            {chainHeight ?? '—'}
          </p>
          {settleAfter != null &&
          chainHeight != null &&
          !settleAllowedAtHeight(settleAfter, chainHeight) ? (
            <p className="text-text-interactive-warning-body">
              {BUFFER_HONESTY_COPY.earlySettle} (need block {settleAfter})
            </p>
          ) : null}

          {phase === 'reserved' ? (
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                className="rounded-md bg-background-button px-3 py-2 text-xs text-text-button-primary disabled:opacity-50"
                disabled={submitting || !canSettle || orderId == null}
                onClick={runSettle}
                title={
                  !canSettle
                    ? BUFFER_HONESTY_COPY.earlySettle
                    : 'Settle after buffer'
                }
                type="button"
              >
                Settle
              </button>
              <button
                className="rounded-md border border-border-primary px-3 py-2 text-xs disabled:opacity-50"
                disabled={submitting || orderId == null}
                onClick={runCancel}
                type="button"
              >
                Cancel (buyer only)
              </button>
              <p className="w-full text-[10px] text-text-tertiary">
                {BUFFER_HONESTY_COPY.sellerCancel}. No seller cancel control.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Best-effort order_id from wasm execute events. */
function extractOrderIdFromResult(result: {
  events?: readonly {
    type: string
    attributes: readonly { key: string; value: string }[]
  }[]
  logs?: readonly {
    events: readonly {
      type: string
      attributes: readonly { key: string; value: string }[]
    }[]
  }[]
}): number | null {
  const events = [
    ...(result.events ?? []),
    ...(result.logs ?? []).flatMap((l) => l.events),
  ]
  for (const ev of events) {
    for (const attr of ev.attributes) {
      if (
        attr.key === 'order_id' ||
        attr.key === 'order-id' ||
        attr.key.endsWith('order_id')
      ) {
        const n = Number(attr.value)
        if (Number.isFinite(n)) return n
      }
    }
  }
  return null
}
