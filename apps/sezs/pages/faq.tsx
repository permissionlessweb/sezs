import { useState } from 'react'

import { FAQ } from '../src/content/event'
import { useEvent } from '../src/event/useEvent'
import { eventNameOf } from '../src/event/title'
import { Frame } from '../src/ui/Frame'
import { Halo, Movement } from '../src/ui/primitives'

const TABS = ['attendees', 'artists', 'sponsors'] as const

const Faq = () => {
  const ev = useEvent()
  const name = eventNameOf(ev.data?.event.name)
  const [tab, setTab] = useState<(typeof TABS)[number]>('attendees')
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  const rows =
    ev.data?.faq && ev.data.faq.length && tab === 'attendees'
      ? ev.data.faq.map((row) => ({ q: row.question, a: row.answer }))
      : FAQ[tab]

  const toggle = (key: string) => {
    setOpen((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <Frame title={`FAQ · ${name}`} shape="octa" core={[0.5, 0.24]}>
      <Halo compact title="Questions" />
      <Movement title="Questions">
        <div className="arc-switch" role="tablist" aria-label="Audience">
          {TABS.map((t, i) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? 'is-on' : ''}
              style={{ ['--k' as string]: Math.sin(((i + 0.5) / TABS.length) * Math.PI) }}
              onClick={() => {
                setTab(t)
                setOpen(new Set())
              }}
            >
              <i>{i + 1} ·</i> {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <ol className="qa" role="tabpanel">
          {rows.map((row, i) => {
            const panelId = `faq-${tab}-${i}`
            const btnId = `${panelId}-btn`
            const isOpen = open.has(row.q)
            return (
              <li key={row.q} className={isOpen ? 'is-open' : ''}>
                <span className="qa-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <h3>
                  <button
                    type="button"
                    id={btnId}
                    className="qa-acc"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => toggle(row.q)}
                  >
                    {row.q}
                  </button>
                </h3>
                <div id={panelId} role="region" aria-labelledby={btnId} hidden={!isOpen}>
                  <p>{row.a}</p>
                </div>
              </li>
            )
          })}
        </ol>
      </Movement>
    </Frame>
  )
}

export default Faq
