import { useEffect } from 'react'
import { useRouter } from 'next/router'

import { EventGate } from '../src/event/Status'
import { useEvent } from '../src/event/useEvent'
import { eventNameOf } from '../src/event/title'
import { fromManifold } from '../src/event/view'
import { ArtistName, useArtistInfo } from '../src/event/ArtistInfo'
import { DoorPointer } from '../src/calendar/DoorPointer'
import { ChainList } from '../src/calendar/ChainList'
import { Frame } from '../src/ui/Frame'
import { NightLanes } from '../src/ui/NightLanes'
import { Halo, Movement, Orbit } from '../src/ui/primitives'

const Lineup = () => {
  const ev = useEvent()
  const name = eventNameOf(ev.data?.event.name)
  const { open } = useArtistInfo()
  const router = useRouter()

  useEffect(() => {
    const q = router.query
    const artist = typeof q.artist === 'string' ? q.artist : ''
    const vendor = typeof q.vendor === 'string' ? q.vendor : ''
    if (artist) open({ id: artist, name: artist })
    else if (vendor) open({ id: vendor, name: vendor })
  }, [router.query, open])

  return (
    <Frame title={`Lineup · ${name}`} shape="helix" core={[0.5, 0.24]}>
      <Halo compact title="Lineup" />
      <DoorPointer />
      <EventGate ev={ev}>
        {(data) => {
          const v = fromManifold(data)
          const artists = (data.artists || []).slice()
          const fromSets = v.sets
            .filter((s) => s.kind === 'music' || s.kind === 'floor')
            .map((s) => ({ id: s.id, name: s.name }))
          const seen = new Set(artists.map((a) => a.name.trim().toLowerCase()))
          for (const s of fromSets) {
            const k = s.name.trim().toLowerCase()
            if (!k || seen.has(k)) continue
            seen.add(k)
            artists.push({ id: s.id, name: s.name })
          }
          const vendors = data.vendors || []
          return (
            <>
              <Movement n={1} title="The night" id="night">
                <NightLanes sets={v.sets} lanes={v.lanes} nightLen={v.nightLen} fmt={v.fmt} />
              </Movement>
              {v.around.length ? (
                <Movement title="All night">
                  <ul className="all-night">
                    {v.around.map((a) => (
                      <li key={a.id}>
                        <ArtistName name={a.name} id={a.id} />
                        <small>{a.note}</small>
                      </li>
                    ))}
                  </ul>
                </Movement>
              ) : null}
              <Movement n={2} title="Artists" id="artists">
                {artists.length ? (
                  <Orbit
                    label="Artists"
                    rings={2}
                    center={<span className="orbit-center-t">artists</span>}
                    items={artists.map((a) => ({
                      key: a.id,
                      title: <ArtistName name={a.name} id={a.id} />,
                      note: undefined,
                    }))}
                  />
                ) : (
                  <span className="admin-badge">None</span>
                )}
              </Movement>
              <Movement n={3} title="Vendors" id="vendors">
                {vendors.length ? (
                  <Orbit
                    label="Vendors"
                    rings={1}
                    center={<span className="orbit-center-t">vendors</span>}
                    items={vendors.map((v0) => ({
                      key: v0.id,
                      title: <ArtistName name={v0.name} id={v0.id} />,
                      note: v0.services,
                    }))}
                  />
                ) : (
                  <span className="admin-badge">None</span>
                )}
              </Movement>
              <Movement n={4} title="Nights" id="nights">
                <ChainList />
              </Movement>
            </>
          )
        }}
      </EventGate>
    </Frame>
  )
}

export default Lineup
