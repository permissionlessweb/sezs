import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState, type ReactNode } from 'react'

import { useAuth } from '../src/auth/AuthContext'
import { DOCS, docsHref } from '../src/docs/links'
import { EventGate } from '../src/event/Status'
import { GalleryWork, RafflePrize } from '../src/event/api'
import { ArtistName } from '../src/event/ArtistInfo'
import { Redirect } from '../src/ui/Redirect'
import { isSignedInArtist } from '../src/event/roles-gate'
import { eventNameOf } from '../src/event/title'
import { useEvent } from '../src/event/useEvent'
import {
  ChainRaffle,
  formatCoin,
  formatWhen,
  loadMine,
  loadRaffleListings,
  rafflePhase,
  type RaffleLoad,
} from '../src/event/raffle-client'
import { Frame } from '../src/ui/Frame'
import { ClockWall, ClockItem } from '../src/ui/ClockWall'
import { Halo, Movement, Orbit, PixelCore, type OrbitItem } from '../src/ui/primitives'
import { CollectionsPrep } from '../src/gallery/CollectionsPrep'
import { ShowcaseEditor } from '../src/gallery/ShowcaseEditor'
import { emptyShowcase, parseInviteFragment } from '../src/gallery/showcase'
import { CHARITY_HALF } from '../src/gallery/split'
import { SplitDonut } from '../src/ui/SplitDonut'

type View = 'home' | 'artists' | 'artist' | 'gallery' | 'works' | 'work' | 'join' | 'studio' | 'vendors' | 'vendor' | 'raffles'

const q = (view: View, id?: string) =>
  view === 'home' ? '/gallery' : `/gallery?view=${view}${id ? `&id=${encodeURIComponent(id)}` : ''}`

const zec = (n: number) => `${Number(n.toFixed(4))} ZEC`

const InviteNote = () => {
  if (typeof window === 'undefined') return null
  const parsed = parseInviteFragment(window.location.hash)
  if ('error' in parsed) {
    return window.location.hash ? <p className="gx-note" role="status">{parsed.error}</p> : null
  }
  return <p className="gx-note">Invite {parsed.i.slice(0, 8)}… is in the fragment. It is not sent to the server from this page.</p>
}

const EmptyState = ({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) => (
  <div className="gx-panel gx-empty">
    <div className="gx-empty-core" aria-hidden="true"><PixelCore cells={31} /></div>
    <h2>{title}</h2>
    <p className="gx-note">{body}</p>
    {action ? (
      <p style={{ marginTop: '1rem' }}>
        <Link className="pix-btn ghost" href={action.href} scroll={false}>{action.label}</Link>
      </p>
    ) : null}
  </div>
)

const WorkModal = ({ w, onClose }: { w: GalleryWork; onClose: () => void }) => {
  const charityHalf = w.priceZec * CHARITY_HALF
  const charity = charityHalf * 2
  return (
    <div className="wallet-scrim" role="presentation" onClick={onClose} data-work-modal="open">
      <div
        className="wallet-modal artist-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wallet-modal-bar">
          <h2 id="work-modal-title">{w.title}</h2>
          <button type="button" className="pix-link" onClick={onClose}>
            close
          </button>
        </div>
        <p className="gx-note"><ArtistName name={w.artist} id={w.artistId} /></p>
        {w.about ? <p className="artist-about">{w.about}</p> : null}
        <div className="gx-panel">
          <dl className="gx-facts">
            <dt>Price</dt><dd>{zec(w.priceZec)}</dd>
            <dt>To a charity you choose (11.1%)</dt><dd>{zec(charityHalf)}</dd>
            <dt>To a charity the artist chose (11.1%)</dt><dd>{zec(charityHalf)}</dd>
            <dt>To the artist (77.8%)</dt><dd>{zec(w.priceZec - charity)}</dd>
            <dt>Network fee</dt><dd>Set by your wallet</dd>
            <dt className="total">You pay</dt><dd className="total">{zec(w.priceZec)} + network fee</dd>
          </dl>
          <div className="admin-badges" style={{ marginTop: '1rem' }}>
            <span className="admin-badge">Buy is off</span>
            <span className="admin-badge">no escrow contract</span>
          </div>
          <button className="pix-btn" type="button" disabled style={{ marginTop: '.6rem' }}>
            Buy with shielded ZEC
          </button>
        </div>
      </div>
    </div>
  )
}

const RaffleModal = ({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) => (
  <div className="wallet-scrim" role="presentation" onClick={onClose} data-raffle-modal="open">
    <div
      className="wallet-modal artist-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="raffle-modal-title"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="wallet-modal-bar">
        <h2 id="raffle-modal-title">{title}</h2>
        <button type="button" className="pix-link" onClick={onClose}>
          close
        </button>
      </div>
      {children}
    </div>
  </div>
)

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

const normalizeView = (raw: string | undefined): View => {
  if (raw === 'works' || raw === 'work') return 'gallery'
  return (raw || 'home') as View
}

const Gallery = () => {
  const router = useRouter()
  const ev = useEvent()
  const { session } = useAuth()
  const [draft, setDraft] = useState(emptyShowcase)
  const [listings, setListings] = useState<RaffleLoad | null>(null)
  const [mine, setMine] = useState<Record<number, number>>({})
  const rawView = (router.query.view as string) || 'home'
  const view = normalizeView(rawView)
  const id = router.query.id as string | undefined
  const works = ev.data?.gallery || []
  const prizes = ev.data?.raffles || []
  const canRegister = isSignedInArtist(session, ev.data)
  const name = eventNameOf(ev.data?.event.name)
  const owner = session?.wallet?.address || ''

  const go = (next: View, nextId?: string) => {
    void router.push(q(next, nextId), undefined, { scroll: false })
  }

  useEffect(() => {
    if (!router.isReady) return
    if (rawView === 'works' || rawView === 'work') {
      void router.replace(q('gallery', rawView === 'work' ? id : undefined), undefined, { scroll: false })
    }
  }, [rawView, id, router, router.isReady])

  useEffect(() => {
    if (view !== 'raffles') return
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
  }, [view, owner])

  useEffect(() => {
    if (view !== 'gallery' && view !== 'raffles') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (id) go(view)
        else go('home')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (view === 'artists' || view === 'artist') {
    return <Redirect to={view === 'artist' && id ? `/lineup?artist=${encodeURIComponent(id)}` : '/lineup#artists'} label="Lineup" />
  }
  if (view === 'vendors' || view === 'vendor') {
    return <Redirect to={view === 'vendor' && id ? `/lineup?vendor=${encodeURIComponent(id)}` : '/lineup#vendors'} label="Lineup" />
  }

  const wall: ClockItem[] = [
    { key: 'g', hour: 12, title: 'Gallery', onClick: () => go('gallery') },
    { key: 'r', hour: 6, title: 'Raffles', onClick: () => go('raffles') },
  ]

  let crumb: { href: string; label: string }[] = []
  let title = 'Gallery'
  let lede: string | undefined
  let body: JSX.Element | null = null
  const work = view === 'gallery' ? works.find((x) => x.id === id) : undefined
  const listing = view === 'raffles' && id?.startsWith('listing-')
    ? listings?.items.find((r) => `listing-${r.raffleId}` === id)
    : undefined
  const prize = view === 'raffles' && !listing ? prizes.find((p) => p.id === id) : undefined

  if (view === 'gallery') {
    title = 'Gallery'
    lede = works.length ? `${works.length} piece${works.length === 1 ? '' : 's'}.` : undefined
    crumb = [{ href: q('home'), label: 'Gallery' }]
    const items: OrbitItem[] = works.map((w) => ({
      key: w.id,
      title: w.title,
      note: w.artist,
      href: q('gallery', w.id),
    }))
    body = works.length ? (
      <Orbit label="Gallery" rings={2} center={<span className="orbit-center-t">gallery</span>} items={items} />
    ) : (
      <span className="admin-badge">None</span>
    )
    if (id && !work) {
      lede = undefined
      body = <EmptyState title="Nothing here" body="It may have been removed. Browse the digital gallery instead." action={{ href: q('gallery'), label: 'Gallery' }} />
    }
  } else if (view === 'raffles') {
    title = 'Raffles'
    crumb = [{ href: q('home'), label: 'Gallery' }]
    const items: OrbitItem[] = [
      ...(listings?.items || []).map((r) => ({
        key: `listing-${r.raffleId}`,
        title: `Raffle ${r.raffleId}`,
        note: rafflePhase(r).label,
        href: q('raffles', `listing-${r.raffleId}`),
      })),
      ...prizes.map((p) => ({
        key: p.id,
        title: p.title,
        note: statusLine(p),
        href: q('raffles', p.id),
      })),
    ]
    body = !listings ? (
      <span className="admin-badge">Checking</span>
    ) : items.length ? (
      <Orbit label="Raffles" rings={2} center={<span className="orbit-center-t">raffles</span>} items={items} />
    ) : (
      <p className="fine">{listings.note || 'No listings'}</p>
    )
  } else if (view === 'join') {
    title = 'Show in the gallery'
    crumb = [{ href: q('home'), label: 'Gallery' }]
    body = canRegister ? (
      <>
        <InviteNote />
        <CollectionsPrep seed={draft.collections} onChange={(rows) => setDraft({ ...draft, collections: rows.map((r) => ({ chain: r.chain, addr: r.addr, kind: r.kind, adapter: r.adapter })) })} />
      </>
    ) : (
      <EmptyState title="Artist sign-in required" body="Showing work in the gallery is only available to a wallet that is signed in and listed as an artist on the event record." />
    )
  } else if (view === 'studio') {
    title = 'Showcase'
    lede = draft.displayName ? `${draft.displayName}.` : undefined
    crumb = [{ href: q('home'), label: 'Gallery' }]
    body = session ? (
      <>
        <SplitDonut />
        <ShowcaseEditor value={draft} onChange={setDraft} />
      </>
    ) : (
      <>
        <SplitDonut />
        <div className="gx-panel">
          <h2>Sign in to draft a showcase</h2>
          <p className="gx-note">Keplr, Zafu, or a browser key with a passkey. Sign-in is not a listing.</p>
        </div>
      </>
    )
  }

  return (
    <Frame title={`${title} · ${name}`} shape={view === 'studio' ? 'tetra' : 'cube'} core={[0.5, view === 'studio' ? 0.2 : 0.3]} intensity={view === 'studio' ? 0.62 : 1}>
      <Halo
        compact
        kicker={
          crumb.length ? (
            <>
              {crumb.map((c, i) => (
                <span key={c.href}>{i ? ' / ' : ''}<Link href={c.href} scroll={false}>{c.label}</Link></span>
              ))}
            </>
          ) : undefined
        }
        title={title}
        sub={lede}
      />
      <EventGate ev={ev}>
        {() => (
          <>
            {view === 'home' ? (
              <Movement n={1} title="Rooms">
                <ClockWall
                  label="Gallery"
                  items={wall}
                  center={<span className="orbit-center-t">rooms</span>}
                />
              </Movement>
            ) : null}
            {view === 'home' && canRegister ? (
              <p className="halo-act">
                <Link className="pix-btn" href={q('join')} scroll={false}>Show in the gallery</Link>
              </p>
            ) : null}
            {view !== 'home' ? (
              <Movement n={1} title={title} align={view === 'gallery' || view === 'raffles' ? 'center' : 'left'} id="gallery-detail">
                <div className="gx-body">{body}</div>
                <p className="mv-foot gx-docs">
                  <a className="pix-link" href={docsHref(DOCS.gallery)} target="_blank" rel="noopener noreferrer">Docs</a>
                </p>
              </Movement>
            ) : (
              <p className="mv-foot gx-docs">
                <a className="pix-link" href={docsHref(DOCS.gallery)} target="_blank" rel="noopener noreferrer">Docs</a>
              </p>
            )}
            {work ? <WorkModal w={work} onClose={() => go('gallery')} /> : null}
            {listing ? (
              <RaffleModal title={`Raffle ${listing.raffleId}`} onClose={() => go('raffles')}>
                <p className={'raffle-st is-' + rafflePhase(listing).key}>{rafflePhase(listing).label}</p>
                <p>{assetLine(listing)}</p>
                {listing.comment ? <p>{listing.comment}</p> : null}
                <dl className="raffle-kv">
                  <div><dt>Ticket price</dt><dd>{formatCoin(listing.ticketPrice)}</dd></div>
                  <div><dt>Tickets sold</dt><dd>{listing.maxTickets ? `${listing.ticketsSold} of ${listing.maxTickets}` : String(listing.ticketsSold)}</dd></div>
                  <div><dt>Ends</dt><dd>{formatWhen(listing.endsAt)}</dd></div>
                  <div><dt>Your tickets</dt><dd>{owner ? String(mine[listing.raffleId] ?? 0) : 'Sign in to see your tickets.'}</dd></div>
                </dl>
              </RaffleModal>
            ) : null}
            {prize ? (
              <RaffleModal title={prize.title} onClose={() => go('raffles')}>
                {prize.note ? <p>{prize.note}</p> : null}
                <p>Entries {prize.entries}</p>
                <p>{statusLine(prize)}</p>
                {prize.draw?.proofHref ? (
                  <p className="link-line">
                    <a className="pix-link" href={prize.draw.proofHref} target="_blank" rel="noopener noreferrer">
                      randomness proof
                    </a>
                  </p>
                ) : null}
              </RaffleModal>
            ) : null}
          </>
        )}
      </EventGate>
    </Frame>
  )
}

export default Gallery
