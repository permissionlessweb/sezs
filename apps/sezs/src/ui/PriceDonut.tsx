import { useEffect, useState } from 'react'

import { RailId, RAIL_LABEL, TicketTier, discountPct, priceCents } from '../event/api'
import { PixelDonut } from './PixelDonut'

export const CATALOG_RAILS: RailId[] = ['zec', 'penumbra']
const SHORT: Record<RailId, string> = { zec: 'ZEC', penumbra: 'Penumbra' }
const usd = (c: number) => `$${(c / 100).toFixed(2)}`

/** Price ring for one tier. Highlights the selected rail and eases the center to that price. */
export const PriceDonut = ({
  tier,
  selected,
  quiet,
}: {
  tier: TicketTier
  selected?: RailId | null
  quiet?: boolean
}) => {
  const rails = CATALOG_RAILS.filter((id) => tier.rails.includes(id))
  const target = selected && tier.rails.includes(selected) ? priceCents(tier, selected) : tier.listCents
  const [shown, setShown] = useState(target)
  useEffect(() => {
    const still = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still) {
      setShown(target)
      return
    }
    let cur = shown
    let raf = 0
    const tick = () => {
      cur += (target - cur) * 0.22
      if (Math.abs(target - cur) < 0.5) {
        setShown(target)
        return
      }
      setShown(cur)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // shown is the animation source; we only restart when the target changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const sub = selected ? SHORT[selected] : 'LIST'
  return (
    <figure className={'donut-fig' + (selected ? ' is-picked' : '')}>
      <PixelDonut
        label="Ticket price by rail. The lit ring is the method you picked. Solid pixels are what you pay. Sparse pixels are the discount."
        center={usd(Math.round(shown))}
        sub={sub}
        rings={rails.map((id) => {
          const off = discountPct(tier, id) / 100
          const on = selected === id
          if (!selected) {
            return {
              segs: [
                { value: 1 - off, tone: off ? 'lit' : 'pale' as const },
                { value: off, tone: 'dither' as const },
              ],
            }
          }
          if (on) {
            return {
              segs: [
                { value: 1 - off, tone: 'lit' as const },
                { value: off, tone: 'dither' as const },
              ],
            }
          }
          return {
            segs: [
              { value: 1 - off, tone: 'pale' as const },
              { value: off, tone: 'dither' as const },
            ],
          }
        })}
      />
      {quiet ? null : selected ? (
      <figcaption>
          <p className="donut-picked">
            {RAIL_LABEL[selected]} · {usd(priceCents(tier, selected))}
            {discountPct(tier, selected) ? ` · ${discountPct(tier, selected)}% off list` : ' · list'}
          </p>
      </figcaption>
      ) : null}
    </figure>
  )
}
