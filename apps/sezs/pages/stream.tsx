import Link from 'next/link'
import { useState } from 'react'

import { EventGate } from '../src/event/Status'
import { useEvent } from '../src/event/useEvent'
import { eventNameOf } from '../src/event/title'
import { Shell } from '../src/ui/Frame'

const Stream = () => {
  const ev = useEvent()
  const name = eventNameOf(ev.data?.event.name)
  const [set, setSet] = useState(0)
  return (
    <Shell title={`Livestream · ${name}`}>
      <section>
        <div className="wrap">
          <h2 className="section-title">Livestream</h2>
          <p className="section-sub">
            Sets follow the <Link href="/lineup">lineup</Link>.
          </p>
          <EventGate ev={ev}>
            {(data) => {
              const sets = data.lineup.filter((s) => s.role === 'dj' || s.role === 'vj' || s.role === 'host')
              if (!sets.length) return <p className="honest">No sets are on the event record yet.</p>
              const current = sets[Math.min(set, sets.length - 1)]
              return (
                <div className="panel">
                  <div className="stream-stage">
                    <p className="kicker" style={{ color: 'var(--gold)' }}>
                      {current.lane}
                    </p>
                    <h3 style={{ color: 'var(--cream)', fontSize: '1.6rem' }}>{current.handle}</h3>
                  </div>
                  <div className="row" style={{ marginTop: '1rem' }}>
                    {sets.map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        className="btn ghost"
                        onClick={() => setSet(i)}
                      >
                        {s.handle}
                      </button>
                    ))}
                  </div>
                </div>
              )
            }}
          </EventGate>
        </div>
      </section>
    </Shell>
  )
}

export default Stream
