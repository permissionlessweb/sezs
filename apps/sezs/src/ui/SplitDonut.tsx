import { CHARITY_HALF } from '../gallery/split'
import { PixelDonut } from './PixelDonut'

const p = (n: number) => `${Number((n * 100).toFixed(1))}%`

/** Intended sale split from src/gallery/split.ts. Copy, not a payout. */
export const SplitDonut = () => {
  const artist = 1 - CHARITY_HALF * 2
  return (
    <figure className="donut-fig">
      <PixelDonut
        G={60}
        label="Intended sale split: artist share and two charity cuts"
        center={p(artist)}
        sub="ARTIST"
        rings={[{ segs: [
          { value: artist, tone: 'lit' },
          { value: CHARITY_HALF, tone: 'pale' },
          { value: CHARITY_HALF, tone: 'line' },
        ] }]}
      />
      <figcaption>
        <ol className="donut-key">
          <li><i className="k-lit" /><b>Payment to the artist</b><span>{p(artist)}</span></li>
          <li><i className="k-pale" /><b>Donation, the buyer's charity</b><span>{p(CHARITY_HALF)}</span></li>
          <li><i className="k-line" /><b>Donation, the artist's charity</b><span>{p(CHARITY_HALF)}</span></li>
        </ol>
        <p className="fine">This is the intended split. The site holds no funds and runs no escrow, so nothing is paid out yet. Your wallet sets the network fee, on top.</p>
      </figcaption>
    </figure>
  )
}
