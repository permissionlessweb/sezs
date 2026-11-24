import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { ArtistListing, GalleryWork, LineupSlot, ResolvedEvent, VendorListing } from './api'
import { useEvent } from './useEvent'
import { formatClock } from './format'

type ArtistRef = { id?: string; name: string }

type ArtistInfoValue = {
  open: (ref: ArtistRef) => void
  close: () => void
  current: ArtistRef | null
}

const Ctx = createContext<ArtistInfoValue | null>(null)

export const useArtistInfo = () => {
  const ctx = useContext(Ctx)
  if (!ctx) {
    return {
      open: (_ref: ArtistRef) => {},
      close: () => {},
      current: null as ArtistRef | null,
    }
  }
  return ctx
}

const norm = (s: string) => s.trim().toLowerCase()

const findArtist = (data: ResolvedEvent | null, ref: ArtistRef) => {
  if (!data) return null
  const artists = data.artists || []
  const byId = ref.id ? artists.find((a) => a.id === ref.id) : undefined
  const byName = artists.find((a) => norm(a.name) === norm(ref.name) || (ref.id && norm(a.id) === norm(ref.id)))
  const artist: ArtistListing | undefined = byId || byName
  const name = artist?.name || ref.name
  const slots: LineupSlot[] = (data.lineup || []).filter(
    (s) => norm(s.handle) === norm(name) || (artist && (norm(s.handle) === norm(artist.name) || s.id === artist.id)),
  )
  const works: GalleryWork[] = (data.gallery || []).filter(
    (w) => norm(w.artist) === norm(name) || (artist && (w.artistId === artist.id || norm(w.artist) === norm(artist.name))),
  )
  const vendors: VendorListing[] = (data.vendors || []).filter(
    (v) => norm(v.name) === norm(name) || (v.handle && norm(v.handle) === norm(name)),
  )
  return { artist, name, slots, works, vendors }
}

const labelLane = (id: string) => id.slice(0, 1).toUpperCase() + id.slice(1)

/** Clickable artist name. Opens the shared artist info modal. */
export const ArtistName = ({
  name,
  id,
  className,
  children,
}: {
  name: string
  id?: string
  className?: string
  children?: ReactNode
}) => {
  const { open } = useArtistInfo()
  return (
    <button type="button" className={className ? `artist-name ${className}` : 'artist-name'} onClick={() => open({ name, id })}>
      {children || name}
    </button>
  )
}

export const ArtistInfoProvider = ({ children }: { children: ReactNode }) => {
  const [current, setCurrent] = useState<ArtistRef | null>(null)
  const open = useCallback((ref: ArtistRef) => {
    if (!ref.name && !ref.id) return
    setCurrent(ref)
  }, [])
  const close = useCallback(() => setCurrent(null), [])
  const value = useMemo(() => ({ open, close, current }), [open, close, current])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const ArtistInfoModal = () => {
  const { current, close } = useArtistInfo()
  const ev = useEvent()
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, close])
  if (!current) return null
  const info = findArtist(ev.data, current)
  const tz = ev.data?.event.timezone
  return (
    <div className="wallet-scrim" role="presentation" onClick={close} data-artist-modal="open">
      <div
        className="artist-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="artist-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wallet-modal-bar">
          <h2 id="artist-modal-title">{info?.name || current.name}</h2>
          <button type="button" className="pix-link" onClick={close}>
            close
          </button>
        </div>
        {info?.artist?.about ? <p className="artist-about">{info.artist.about}</p> : null}
        {info?.artist?.address ? <p className="mono fine">{info.artist.address}</p> : null}
        {info?.slots.length ? (
          <ul className="artist-sets">
            {info.slots.map((s) => (
              <li key={s.id}>
                <time>
                  {formatClock(s.start, tz)}
                  {s.durationMin ? ` · ${s.durationMin}m` : ''}
                </time>
                <span>{labelLane(s.lane)}</span>
                <span>{s.role}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="admin-badge">No set</span>
        )}
        {info?.vendors.length ? (
          <ul className="artist-sets">
            {info.vendors.map((v) => (
              <li key={v.id}>
                <span>{v.name}</span>
                {v.services ? <span>{v.services}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {info?.works.length ? <p className="fine">{info.works.length} in the gallery</p> : null}
      </div>
    </div>
  )
}
