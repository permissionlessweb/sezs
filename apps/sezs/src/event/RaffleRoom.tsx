import { useEffect, useState } from 'react'

import { useAuth } from '../auth/AuthContext'
import { RafflePrize } from './api'
import {
  ChainRaffle,
  formatCoin,
  formatWhen,
  loadMine,
  loadRaffleListings,
  rafflePhase,
  type RaffleLoad,
} from './raffle-client'

const statusLine = (p: RafflePrize) => {
  if (p.status === 'drawn' && p.draw?.winnerIndex != null) {
    return `Drawn. Winning entry ${p.draw.winnerIndex} of ${p.entries}.`
  }
  if (p.status === 'closed' && p.draw && p.draw.winnerIndex == null) {
    return 'A draw was requested. Waiting on the randomness beacon. No winner has been chosen yet.'
  }
  if (p.status === 'closed') return 'Closed. A draw has not been requested yet.'
  return 'Open. One paid ticket is one entry.'
}

const assetLine = (r: ChainRaffle) => {
  if (!r.assets.length) return 'Prize details come from the listing on the raffle contract.'
  return r.assets
    .map((a) => {
      if (a.kind === 'cw721') return a.tokenId ? `Token ${a.tokenId}` : 'An NFT prize'
      if (a.kind === 'coin' && a.coin) return formatCoin(a.coin)
      return 'A prize on the listing'
    })
    .join(' · ')
}

const ListingCard = ({ r, mine }: { r: ChainRaffle; mine?: number }) => {
  const phase = rafflePhase(r)
  const sold = r.maxTickets ? `${r.ticketsSold} of ${r.maxTickets}` : String(r.ticketsSold)
  return (
    <li id={`listing-${r.raffleId}`}>
      <span className="qa-n" aria-hidden="true">{String(r.raffleId).padStart(2, '0')}</span>
      <h3>Raffle {r.raffleId}</h3>
      <p className={'raffle-st is-' + phase.key}>{phase.label}</p>
      <p>{assetLine(r)}</p>
      {r.comment ? <p>{r.comment}</p> : null}
      <dl className="raffle-kv">
        <div><dt>Ticket price</dt><dd>{formatCoin(r.ticketPrice)}</dd></div>
        <div><dt>Tickets sold</dt><dd>{sold}</dd></div>
        <div><dt>Ends</dt><dd>{formatWhen(r.endsAt)}</dd></div>
        <div><dt>Your tickets</dt><dd>{mine == null ? 'Sign in to see your tickets.' : String(mine)}</dd></div>
      </dl>
    </li>
  )
}

/** Raffles room: contract listings plus prizes on the event record. */
export const RaffleRoom = ({ prizes }: { prizes: RafflePrize[] }) => {
  const { session } = useAuth()
  const owner = session?.wallet?.address || ''
  const [listings, setListings] = useState<RaffleLoad | null>(null)
  const [mine, setMine] = useState<Record<number, number>>({})

  useEffect(() => {
    let live = true
    loadRaffleListings().then(async (loaded) => {
      if (!live) return
      setListings(loaded)
      if (owner && loaded.items.length) {
        const held = await loadMine(loaded, owner)
        if (live) setMine(held)
      } else {
        setMine({})
      }
    })
    return () => {
      live = false
    }
  }, [owner])

  return (
    <div className="raffle-room" data-room="raffles">
      <div className="admin-badges">
        <span className="admin-badge">{listings?.items.length ?? '…'}</span>
        <span className="admin-badge">{prizes.length}</span>
      </div>
      {!listings ? (
        <span className="admin-badge">Checking</span>
      ) : listings.items.length ? (
        <ol className="qa raffle-list">
          {listings.items.map((r) => (
            <ListingCard key={r.raffleId} r={r} mine={owner ? mine[r.raffleId] ?? 0 : undefined} />
          ))}
        </ol>
      ) : (
        <p className="fine">{listings.note || 'No listings'}</p>
      )}
      {prizes.length ? (
        <ol className="qa raffle-list">
          {prizes.map((p, i) => (
            <li key={p.id} id={p.id}>
              <span className="qa-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <h3>{p.title}</h3>
              {p.note ? <p>{p.note}</p> : null}
              <p>Entries {p.entries}</p>
              <p>{statusLine(p)}</p>
              {p.draw?.proofHref ? (
                <p className="link-line">
                  <a className="pix-link" href={p.draw.proofHref} target="_blank" rel="noopener noreferrer">
                    randomness proof
                  </a>
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
