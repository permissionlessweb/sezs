import clsx from 'clsx'
import { ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  MarketplaceListingKind,
  MarketplaceSearchState,
  NormalizedMarketplaceListing,
  defaultMarketplaceSearchState,
  filterListings,
} from '@dao-dao/utils'

import type { ListingContentMeta } from './useMarketplaceContentBodies'
import type { NostrMarketplaceLiveStatus } from './useNostrMarketplaceLive'

export type CatalogDensity = 'comfortable' | 'compact' | 'grid2' | 'grid3'

export type MarketplaceCatalogPanelProps = {
  listings: NormalizedMarketplaceListing[]
  /** When true, show demo-source chip honesty */
  showDemoBanner?: boolean
  minBufferBlocks?: number
  onSelect?: (item: NormalizedMarketplaceListing) => void
  /** M6: per-listing content plane resolve status */
  contentMetaById?: Record<string, ListingContentMeta>
  contentResolving?: number
  contentBase?: string
  /** M7: progressive Nostr live chip (never blocks) */
  nostrStatus?: NostrMarketplaceLiveStatus
  nostrEventCount?: number
  nostrError?: string
  /** Header slot (e.g. help ?) rendered above filters */
  headerActions?: ReactNode
}

const MODE_CHIPS: { kind: MarketplaceListingKind | 'all'; label: string }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'fixed', label: 'Fixed' },
  { kind: 'auction', label: 'Auction' },
  { kind: 'buy_now', label: 'Buy now' },
]

const DENSITY_OPTIONS: { id: CatalogDensity; label: string }[] = [
  { id: 'comfortable', label: 'List' },
  { id: 'compact', label: 'Compact' },
  { id: 'grid2', label: '2-up' },
  { id: 'grid3', label: '3-up' },
]

const kindBadge = (kind: MarketplaceListingKind): string => {
  switch (kind) {
    case 'fixed':
      return 'Fixed'
    case 'auction':
      return 'Auction'
    case 'buy_now':
      return 'Buy now'
  }
}

const nostrChipLabel = (
  status: NostrMarketplaceLiveStatus | undefined,
  count: number
): string => {
  switch (status) {
    case 'connecting':
      return 'Live Nostr (connecting…)'
    case 'live':
      return `Live Nostr · ${count} event${count === 1 ? '' : 's'}`
    case 'idle':
      return count > 0
        ? `Live Nostr · ${count} event${count === 1 ? '' : 's'}`
        : 'Live Nostr (listening)'
    case 'error':
      return count > 0
        ? `Live Nostr · ${count} (relay hiccup)`
        : 'Live Nostr (relay offline)'
    case 'off':
    default:
      return 'Live Nostr (optional · off)'
  }
}

/**
 * Catalog + shared filter bar (M3) + content plane honesty (M6) + Nostr chip (M7).
 * Pure filterListings drives results — ICT-aligned availability / ending-soon.
 * P1: density controls + themed filter chrome.
 */
export const MarketplaceCatalogPanel = ({
  listings,
  showDemoBanner,
  minBufferBlocks = 7,
  onSelect,
  contentMetaById,
  contentResolving = 0,
  contentBase,
  nostrStatus = 'off',
  nostrEventCount = 0,
  nostrError,
  headerActions,
}: MarketplaceCatalogPanelProps) => {
  const { t } = useTranslation()
  const [search, setSearch] = useState<MarketplaceSearchState>(
    defaultMarketplaceSearchState()
  )
  const [density, setDensity] = useState<CatalogDensity>('comfortable')
  const [listLimit, setListLimit] = useState<number | 'all'>(50)

  const filtered = useMemo(
    () => filterListings(listings, search),
    [listings, search]
  )

  const visible = useMemo(() => {
    if (listLimit === 'all') return filtered
    return filtered.slice(0, listLimit)
  }, [filtered, listLimit])

  const setMode = (kind: MarketplaceListingKind | 'all') => {
    setSearch((s) => ({
      ...s,
      modes: kind === 'all' ? [] : [kind],
    }))
  }

  const activeMode: MarketplaceListingKind | 'all' =
    search.modes.length === 1 ? search.modes[0] : 'all'

  const isGrid = density === 'grid2' || density === 'grid3'
  const listClass = clsx(
    isGrid
      ? density === 'grid2'
        ? 'grid grid-cols-1 gap-3 sm:grid-cols-2'
        : 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'
      : 'flex flex-col gap-2'
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {showDemoBanner ? (
            <p className="text-xs text-text-interactive-warning-body rounded-md border border-border-interactive-warning bg-background-interactive-warning/10 p-2">
              {t('info.marketplaceDemoCatalog', {
                defaultValue:
                  'Showing ICT catalog_gap demo seeds (GL-FLW-3.5, GL-PRL-001, HC-TIN-30, HC-GUM-10, GL-LTD-001 + demo auctions). On-chain Product{} wins per SKU when listed. Nostr never finalizes purchases.',
              })}
            </p>
          ) : null}
        </div>
        {headerActions ? (
          <div className="flex shrink-0 items-center gap-2">{headerActions}</div>
        ) : null}
      </div>

      {/* M7 progressive chip + M6 content plane honesty — never gate catalog */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className={
            nostrStatus === 'live' || nostrStatus === 'idle'
              ? 'rounded-full border border-border-interactive-hover bg-background-button-secondary px-2.5 py-1 text-text-secondary'
              : 'rounded-full border border-border-primary bg-background-secondary px-2.5 py-1 text-text-tertiary'
          }
          title={
            nostrError
              ? `Progressive only — ${nostrError}`
              : 'Progressive only. Chain settles money and stock; Nostr never finalizes purchases.'
          }
        >
          {t('info.marketplaceNostrLiveChip', {
            defaultValue: nostrChipLabel(nostrStatus, nostrEventCount),
            count: nostrEventCount,
            status: nostrStatus,
          })}
        </span>
        {contentBase ? (
          <span
            className="rounded-full border border-border-primary bg-background-secondary px-2.5 py-1 text-text-tertiary"
            title={contentBase}
          >
            {contentResolving > 0
              ? t('info.marketplaceContentResolving', {
                  defaultValue:
                    'Listing media from content plane ({{n}} resolving…)',
                  n: contentResolving,
                })
              : t('info.marketplaceContentPlaneReady', {
                  defaultValue: 'Listing media from content plane',
                })}
          </span>
        ) : null}
      </div>

      {/* Themed filter bar */}
      <div className="flex flex-col gap-3 rounded-lg border border-border-primary bg-background-secondary/60 p-3 shadow-sm backdrop-blur-sm">
        <input
          className="primary-text w-full rounded-md border border-border-primary bg-background-base px-3 py-2 text-sm text-text-body outline-none ring-border-interactive-focus transition-shadow placeholder:text-text-tertiary focus:border-border-interactive-focus focus:ring-2"
          onChange={(e) =>
            setSearch((s) => ({ ...s, q: e.target.value }))
          }
          placeholder={t('form.marketplaceSearch', {
            defaultValue: 'Search title, sku, token…',
          })}
          type="search"
          value={search.q}
        />

        <div className="flex flex-wrap gap-2">
          {MODE_CHIPS.map(({ kind, label }) => {
            const on = activeMode === kind
            return (
              <button
                key={kind}
                className={clsx(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  on
                    ? 'bg-background-button text-text-button-primary shadow-sm'
                    : 'border border-border-primary bg-background-base text-text-secondary hover:border-border-interactive-hover hover:bg-background-interactive-hover'
                )}
                onClick={() => setMode(kind)}
                type="button"
              >
                {label}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="secondary-text text-text-tertiary">Min price</span>
            <input
              className="w-28 rounded-md border border-border-primary bg-background-base px-2 py-1.5 text-text-body outline-none focus:border-border-interactive-focus focus:ring-1 focus:ring-border-interactive-focus"
              inputMode="numeric"
              onChange={(e) =>
                setSearch((s) => ({
                  ...s,
                  priceMin: e.target.value || undefined,
                }))
              }
              placeholder="0"
              value={search.priceMin ?? ''}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="secondary-text text-text-tertiary">Max price</span>
            <input
              className="w-28 rounded-md border border-border-primary bg-background-base px-2 py-1.5 text-text-body outline-none focus:border-border-interactive-focus focus:ring-1 focus:ring-border-interactive-focus"
              inputMode="numeric"
              onChange={(e) =>
                setSearch((s) => ({
                  ...s,
                  priceMax: e.target.value || undefined,
                }))
              }
              placeholder="∞"
              value={search.priceMax ?? ''}
            />
          </label>
          <label className="flex items-center gap-2 pb-1.5">
            <input
              checked={search.onlyAvailable}
              className="accent-background-button"
              onChange={(e) =>
                setSearch((s) => ({
                  ...s,
                  onlyAvailable: e.target.checked,
                }))
              }
              type="checkbox"
            />
            <span className="secondary-text text-text-secondary">
              In stock / active only
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="secondary-text text-text-tertiary">
              Ending within (h)
            </span>
            <input
              className="w-20 rounded-md border border-border-primary bg-background-base px-2 py-1.5 text-text-body outline-none focus:border-border-interactive-focus focus:ring-1 focus:ring-border-interactive-focus"
              inputMode="numeric"
              min={0}
              onChange={(e) => {
                const n = e.target.value ? Number(e.target.value) : undefined
                setSearch((s) => ({
                  ...s,
                  endingWithinHours:
                    n != null && Number.isFinite(n) && n > 0 ? n : undefined,
                }))
              }}
              placeholder="—"
              type="number"
              value={search.endingWithinHours ?? ''}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="secondary-text text-text-tertiary">Sort</span>
            <select
              className="rounded-md border border-border-primary bg-background-base px-2 py-1.5 text-text-body outline-none focus:border-border-interactive-focus focus:ring-1 focus:ring-border-interactive-focus"
              onChange={(e) =>
                setSearch((s) => ({
                  ...s,
                  sort: e.target.value as MarketplaceSearchState['sort'],
                }))
              }
              value={search.sort}
            >
              <option value="newest">Newest / source</option>
              <option value="price_asc">Price ↑</option>
              <option value="price_desc">Price ↓</option>
              <option value="ending">Ending soon</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="secondary-text text-text-tertiary">Density</span>
            <select
              className="rounded-md border border-border-primary bg-background-base px-2 py-1.5 text-text-body outline-none focus:border-border-interactive-focus focus:ring-1 focus:ring-border-interactive-focus"
              onChange={(e) => setDensity(e.target.value as CatalogDensity)}
              value={density}
            >
              {DENSITY_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="secondary-text text-text-tertiary">Show</span>
            <select
              className="rounded-md border border-border-primary bg-background-base px-2 py-1.5 text-text-body outline-none focus:border-border-interactive-focus focus:ring-1 focus:ring-border-interactive-focus"
              onChange={(e) => {
                const v = e.target.value
                setListLimit(v === 'all' ? 'all' : Number(v))
              }}
              value={listLimit === 'all' ? 'all' : String(listLimit)}
            >
              <option value="12">12</option>
              <option value="24">24</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>
      </div>

      <p className="secondary-text text-xs text-text-tertiary">
        {t('info.marketplaceCatalogCount', {
          defaultValue:
            '{{shown}} of {{total}} listings · fixed buffer {{buffer}} blocks',
          shown: visible.length,
          total: listings.length,
          buffer: minBufferBlocks,
        })}
        {filtered.length > visible.length
          ? ` · showing first ${visible.length} of ${filtered.length} matches`
          : ''}
      </p>

      {!filtered.length ? (
        <p className="secondary-text text-sm">
          {t('info.marketplaceCatalogEmpty', {
            defaultValue:
              'No listings match filters. Clear mode chips or disable “in stock only”.',
          })}
        </p>
      ) : (
        <ul className={listClass}>
          {visible.map((item) => {
            const meta = contentMetaById?.[item.id]
            const compact = density === 'compact'
            return (
              <li key={item.id}>
                <button
                  className={clsx(
                    'flex w-full flex-col gap-1 rounded-lg border border-border-primary bg-background-base text-left transition-colors hover:border-border-interactive-hover hover:bg-background-interactive-hover',
                    compact ? 'p-2' : 'p-3',
                    isGrid && 'h-full'
                  )}
                  onClick={() => onSelect?.(item)}
                  type="button"
                >
                  <div className={clsx('flex gap-3', isGrid && 'flex-col')}>
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt=""
                        className={clsx(
                          'shrink-0 rounded-md object-cover bg-background-secondary',
                          isGrid
                            ? 'h-28 w-full'
                            : compact
                              ? 'h-10 w-10'
                              : 'h-12 w-12'
                        )}
                        src={item.imageUrl}
                      />
                    ) : item.contentCid ? (
                      <div
                        className={clsx(
                          'flex shrink-0 items-center justify-center rounded-md bg-background-secondary text-[9px] text-text-tertiary',
                          isGrid
                            ? 'h-28 w-full'
                            : compact
                              ? 'h-10 w-10'
                              : 'h-12 w-12'
                        )}
                      >
                        {meta?.status === 'loading' ? '…' : 'cid'}
                      </div>
                    ) : isGrid ? (
                      <div className="flex h-28 w-full shrink-0 items-center justify-center rounded-md bg-background-secondary text-xs text-text-tertiary">
                        no image
                      </div>
                    ) : null}
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-background-button-secondary px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
                          {kindBadge(item.kind)}
                        </span>
                        {item.source === 'demo' ? (
                          <span className="text-[10px] text-text-interactive-warning-body">
                            demo
                          </span>
                        ) : null}
                        {meta?.fromContentPlane ? (
                          <span className="text-[10px] text-text-tertiary">
                            content plane
                          </span>
                        ) : null}
                        {meta?.status === 'error' && item.contentCid ? (
                          <span
                            className="text-[10px] text-text-interactive-warning-body"
                            title={meta.error}
                          >
                            media unavailable
                          </span>
                        ) : null}
                        <span
                          className={clsx(
                            'primary-text font-medium text-text-body',
                            compact ? 'text-xs' : 'text-sm'
                          )}
                        >
                          {item.title}
                        </span>
                      </div>
                      {item.description && !compact ? (
                        <p className="secondary-text line-clamp-2 text-xs text-text-secondary">
                          {item.description}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-text-secondary">
                        {item.price != null ? (
                          <span>
                            {item.price} {item.denom}
                          </span>
                        ) : null}
                        {item.kind === 'fixed' ? (
                          <span>
                            avail {item.available ?? 0}
                            {item.reserved
                              ? ` · reserved ${item.reserved}`
                              : ''}
                            {item.stock != null
                              ? ` / stock ${item.stock}`
                              : ''}
                          </span>
                        ) : (
                          <span>
                            {item.endTime
                              ? `ends ${new Date(
                                  item.endTime * 1000
                                ).toLocaleString()}`
                              : 'no end'}
                            {item.isSettled ? ' · settled' : ''}
                          </span>
                        )}
                        {item.sku ? <span>sku {item.sku}</span> : null}
                        {item.tokenId ? (
                          <span>token {item.tokenId}</span>
                        ) : null}
                      </div>
                      {item.kind === 'fixed' && !compact ? (
                        <p className="caption-text text-[10px] text-text-tertiary">
                          {t('info.marketplaceBufferHint', {
                            defaultValue:
                              'Purchase reserves stock; settle after +{{buffer}} blocks (chain authority).',
                            buffer: minBufferBlocks,
                          })}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
