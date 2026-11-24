import Link from 'next/link'

import { EventGate } from '../src/event/Status'
import { formatSpan, venueLine } from '../src/event/format'
import { eventNameOf, eventTitleBreak } from '../src/event/title'
import { useEvent } from '../src/event/useEvent'
import { fromManifold } from '../src/event/view'
import { ArtistName } from '../src/event/ArtistInfo'
import { Frame } from '../src/ui/Frame'
import { Halo, Movement, Orbit, Ritual } from '../src/ui/primitives'

const Home = () => {
  const ev = useEvent()
  const name = eventNameOf(ev.data?.event.name)
  const when = ev.data ? formatSpan(ev.data.event) : ''
  return (
    <Frame title={when ? `${name} · ${when}` : name} shape="icosa" core={[0.5, 0.3]}>
      <Halo
        kicker={when || 'The date comes with the event record'}
        title={eventTitleBreak(ev.data?.event.name)}
        sub="Private events powered by anti-surveillance money."
      >
        <Link className="pix-btn" href="/tickets">Tickets</Link>
        <Link className="pix-btn ghost" href="/lineup">Lineup</Link>
      </Halo>

      <EventGate ev={ev}>
        {(data) => {
          const v = fromManifold(data)
          return (
            <>
              <Movement n={1} title="On the bill" lede={data.event.summary ? `${data.event.summary} ${venueLine(data.venue)}`.trim() : 'Music, vendors, rooms. One lineup.'}>
                <Orbit
                  label="On the bill"
                  rings={2}
                  center={<span className="orbit-center-t">the bill</span>}
                  items={v.bill.map((a) => ({ key: a.id, title: <ArtistName name={a.name} id={a.id} />, note: a.sub }))}
                />
                <p className="lineup-cta-wrap">
                  <Link href="/lineup" className="pix-btn lineup-cta">Full lineup</Link>
                </p>
              </Movement>

              <Movement n={2} title="How it works">
                <Ritual
                  steps={[
                    { title: 'Self Custodial Login', note: 'Your keys hold your ticket.' },
                    { title: 'Buy tickets with encrypted money', note: 'Pay with shielded ZEC, private to you.' },
                    { title: 'Arrive and Check In Privately', note: 'An usher confirms your ticket at the door.' },
                  ]}
                />
                <p className="mv-foot">
                  <Link className="pix-link" href="/sponsors">sponsors</Link> · <Link className="pix-link" href="/gallery?view=raffles">raffles</Link> · <Link className="pix-link" href="/gallery">gallery</Link> · <Link className="pix-link" href="/faq">faq</Link>
                </p>
              </Movement>
            </>
          )
        }}
      </EventGate>
    </Frame>
  )
}

export default Home
