import Link from 'next/link'

import { EventGate } from '../src/event/Status'
import { useEvent } from '../src/event/useEvent'
import { eventNameOf } from '../src/event/title'
import { Frame } from '../src/ui/Frame'
import { Halo, Movement, Orbit } from '../src/ui/primitives'

const Sponsors = () => {
  const ev = useEvent()
  const name = eventNameOf(ev.data?.event.name)
  return (
    <Frame title={`Sponsors · ${name}`} shape="icosa" core={[0.5, 0.3]}>
      <Halo kicker="Sponsors and collaborators" title="Sponsors" sub="Who is on the event record, and a 20-minute call for projects that want to join." />
      <EventGate ev={ev}>
        {(data) => (
          <Movement n={1} title="Around the light">
            {data.sponsors.length ? (
              <>
                <Orbit
                  label="Sponsors"
                  rings={2}
                  items={data.sponsors.map((s) => ({ key: s.id, id: s.id, title: s.handle }))}
                  center={<span className="orbit-center-t">the night</span>}
                />
                <ol className="qa">
                  {data.sponsors.map((s, i) => (
                    <li key={s.id}>
                      <span className="qa-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                      {s.logo ? <img src={s.logo} alt="" width={48} height={48} /> : null}
                      <h3>{s.handle}</h3>
                      {s.tier ? <p className="fine">{s.tier}</p> : null}
                      {s.example ? <p className="fine">Example listing</p> : null}
                      {s.note ? <p>{s.note}</p> : null}
                      {s.href ? (
                        <p className="link-line">
                          {s.href.startsWith('/') ? (
                            <Link className="pix-link" href={s.href}>open</Link>
                          ) : (
                            <a className="pix-link" href={s.href} target="_blank" rel="noopener noreferrer">open</a>
                          )}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
          </Movement>
        )}
      </EventGate>
      <Movement n={2} title="Raffles" lede="Prizes, entries, and draws live on their own page, from the same event record.">
        <Link className="pix-btn" href="/gallery?view=raffles">Raffles</Link>
      </Movement>
      <Movement n={3} title="Discovery calls" id="discovery" lede="Twenty minutes, booked through the public calendar, not the private reservations board.">
        <Link className="pix-btn" href="/lineup">Lineup</Link>
      </Movement>
    </Frame>
  )
}

export default Sponsors
