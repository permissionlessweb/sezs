import Link from 'next/link'

import { EventGate } from '../src/event/Status'
import { useEvent } from '../src/event/useEvent'
import { eventNameOf } from '../src/event/title'
import { fromManifold } from '../src/event/view'
import { Shell } from '../src/ui/Frame'

const Night = () => {
  const ev = useEvent()
  const name = eventNameOf(ev.data?.event.name)
  return (
    <Shell title={`Night of · ${name}`}>
      <section>
        <div className="wrap">
          <h2 className="section-title">Night of</h2>
          <p className="section-sub">
            Public board. Discovery lives on the <Link href="/lineup">lineup</Link>.
          </p>
          <EventGate ev={ev}>
            {(data) => {
              const v = fromManifold(data)
              return (
                <div className="panel">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Where</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.night.map((r, i) => (
                        <tr key={r.time + r.what + i}>
                          <td>{r.time}</td>
                          <td>{r.where}</td>
                          <td>{r.href ? <Link href={r.href}>{r.what}</Link> : r.what}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }}
          </EventGate>
        </div>
      </section>
    </Shell>
  )
}

export default Night
