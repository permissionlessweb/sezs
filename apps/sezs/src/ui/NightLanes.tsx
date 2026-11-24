import Link from 'next/link'
import { CSSProperties, useMemo, useState } from 'react'

import { ArtistName } from '../event/ArtistInfo'
import { Lane, LineupSet } from '../event/view'
import { PixelCore } from './primitives'

/**
 * The night as nested circles. Lanes are concentric rings (cellar nearest
 * the core). Each set is an arc on its ring between start and end. Opening
 * a set grows a child clock of the same form at that arc: the set's own
 * time, with its tracks as nodes around it. Same figure, one level down.
 *
 * Sets, lanes, and night length come from the event manifold via the caller.
 */
const TAU = Math.PI * 2
const R0 = 46
const STEP = 7.2
const ringR = (i: number) => R0 - i * STEP
const ang = (min: number, nightLen: number) => (min / nightLen) * TAU - Math.PI / 2
const pt = (r: number, a: number, cx = 50, cy = 50) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const
const arc = (r: number, a0: number, a1: number) => {
  const [x0, y0] = pt(r, a0)
  const [x1, y1] = pt(r, a1)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

type Night = {
  sets: LineupSet[]
  lanes: Lane[]
  nightLen: number
  fmt: (min: number | null) => string
}

const laneIx = (lanes: Lane[], id: string) => {
  const i = lanes.findIndex((l) => l.id === id)
  return i < 0 ? 0 : i
}
const hours = (nightLen: number) => {
  const step = 60
  const out: number[] = []
  for (let m = 0; m <= nightLen; m += step) out.push(m)
  return out
}


const Setlist = ({ s, night }: { s: LineupSet; night: Night }) => (
  <div className="setlist">
    <p className="setlist-head">
      <b><ArtistName name={s.name} id={s.id} /></b>
      <span>
        {night.fmt(s.start)}
        {s.end !== null && s.start !== null ? `–${night.fmt(s.end)}` : ''} · {night.lanes[laneIx(night.lanes, s.lane)]?.label}
      </span>
    </p>
    {s.tracks.length ? (
      <ol className="setlist-tracks">
        {s.tracks.map((t, i) => (
          <li key={i}>
            <i>{String(i + 1).padStart(2, '0')}</i> {t.title}
            {t.example ? <em className="tag-example">example</em> : null}
          </li>
        ))}
      </ol>
    ) : (
      <span className="admin-badge">{s.kind === 'music' ? 'No setlist' : 'No set'}</span>
    )}
    <p className="link-line">
      <Link className="pix-link" href={`/lineup#${s.ref}`}>anchor</Link>
      {s.link ? <Link className="pix-link" href={s.link}>open</Link> : null}
      {s.kind === 'music' ? <Link className="pix-link" href="/stream">stream</Link> : null}
    </p>
  </div>
)

const Dial = ({ open, setOpen, night }: { open: string | null; setOpen: (id: string | null) => void; night: Night }) => {
  const { sets, lanes, nightLen, fmt } = night
  const sel = sets.find((s) => s.id === open) || null
  const child = useMemo(() => {
    if (!sel || sel.start === null || sel.end === null) return null
    const r = ringR(laneIx(lanes, sel.lane))
    const mid = ang((sel.start + sel.end) / 2, nightLen)
    const [ax, ay] = pt(r, mid)
    const [cx, cy] = pt(Math.min(r + 4, 47) * 0.62, mid)
    return { ax, ay, cx, cy, mid }
  }, [sel, lanes, nightLen])
  return (
    <svg className="nl-dial" viewBox="0 0 100 100" role="group" aria-label="The night as nested rings: one ring per room, one arc per set">
      {lanes.map((l, i) => (
        <g key={l.id}>
          <circle className="nl-ring" cx="50" cy="50" r={ringR(i)} />
          <text className="nl-lane" x="50.6" y={50 - ringR(i) + 1.6}>{l.label}</text>
        </g>
      ))}
      {hours(nightLen).map((m) => {
        const [x0, y0] = pt(R0 + 1.2, ang(m, nightLen))
        const [x1, y1] = pt(R0 + 2.6, ang(m, nightLen))
        const [tx, ty] = pt(R0 + 4.4, ang(m, nightLen))
        return (
          <g key={m}>
            <line className="nl-tick" x1={x0} y1={y0} x2={x1} y2={y1} />
            <text className="nl-hour" x={tx} y={ty + 0.9} textAnchor="middle">{fmt(m)}</text>
          </g>
        )
      })}
      <foreignObject x="41" y="41" width="18" height="18"><PixelCore /></foreignObject>
      {sets.filter((s) => s.start !== null && s.end !== null).map((s) => {
        const r = ringR(laneIx(lanes, s.lane))
        const a0 = ang(s.start as number, nightLen) + 0.012
        const a1 = ang(s.end as number, nightLen) - 0.012
        const [nx, ny] = pt(r, a0)
        const on = s.id === open
        return (
          <g key={s.id} className={'nl-set k-' + s.kind + (on ? ' is-on' : '') + (open && !on ? ' is-dim' : '')}>
            <path className="nl-arc" d={arc(r, a0, a1)} />
            <path className="nl-hit" d={arc(r, a0, a1)} onClick={() => setOpen(on ? null : s.id)}>
              <title>{`${s.name} · ${fmt(s.start)}`}</title>
            </path>
            <rect className="nl-node" x={nx - 0.8} y={ny - 0.8} width="1.6" height="1.6" />
          </g>
        )
      })}
      {sel && child ? (
        <g className="nl-child">
          <line className="nl-branch" x1={child.ax} y1={child.ay} x2={child.cx} y2={child.cy} />
          <circle className="nl-child-ring" cx={child.cx} cy={child.cy} r="9" />
          <circle className="nl-child-core" cx={child.cx} cy={child.cy} r="1.6" />
          {sel.tracks.map((t, i) => {
            const a = (i / Math.max(sel.tracks.length, 1)) * TAU - Math.PI / 2
            const [x, y] = pt(9, a, child.cx, child.cy)
            const [lx, ly] = pt(12.4, a, child.cx, child.cy)
            return (
              <g key={i}>
                <line className="nl-branch thin" x1={child.cx} y1={child.cy} x2={x} y2={y} />
                <rect className="nl-track" x={x - 0.7} y={y - 0.7} width="1.4" height="1.4" />
                <text className="nl-track-t" x={lx} y={ly + 0.6} textAnchor="middle">{String(i + 1).padStart(2, '0')}</text>
              </g>
            )
          })}
          <text className="nl-child-t" x={child.cx} y={child.cy + 0.8} textAnchor="middle">{sel.tracks.length ? String(sel.tracks.length).padStart(2, '0') : '—'}</text>
        </g>
      ) : null}
    </svg>
  )
}

const Lanes = ({ open, setOpen, night }: { open: string | null; setOpen: (id: string | null) => void; night: Night }) => (
  <div className="nl-lanes" style={{ '--lanes': night.lanes.length } as CSSProperties}>
    <div className="nl-axis" aria-hidden="true">
      {hours(night.nightLen).map((m) => (
        <span key={m} style={{ top: `${(m / night.nightLen) * 100}%` }}>{night.fmt(m)}</span>
      ))}
    </div>
    {night.lanes.map((l) => (
      <section key={l.id} className="nl-lane-col" aria-label={l.label}>
        <h3>{l.label}{l.note ? <small>{l.note}</small> : null}</h3>
        <div className="nl-track-col">
          {night.sets.filter((s) => s.lane === l.id).map((s) => {
            const top = s.start === null ? 92 : (s.start / night.nightLen) * 100
            const h = s.start === null || s.end === null ? 6 : ((s.end - s.start) / night.nightLen) * 100
            const on = open === s.id
            return (
              <button
                key={s.id}
                id={s.ref}
                type="button"
                className={'nl-block k-' + s.kind + (on ? ' is-on' : '')}
                style={{ top: `${top}%`, height: `${h}%` }}
                aria-expanded={on}
                onClick={() => setOpen(on ? null : s.id)}
              >
                <i>{night.fmt(s.start)}</i>
                <b>{s.name}</b>
              </button>
            )
          })}
        </div>
      </section>
    ))}
  </div>
)

export const NightLanes = ({ sets, lanes, nightLen, fmt }: Night) => {
  const night = { sets, lanes, nightLen, fmt }
  const [view, setView] = useState<'rings' | 'lanes'>('rings')
  const [open, setOpen] = useState<string | null>(null)
  const sel = sets.find((s) => s.id === open) || null
  if (!sets.length) return <p className="honest">No lineup is on the event record yet.</p>
  return (
    <div className="nl">
      <div className="nl-switch" role="tablist" aria-label="View">
        {(['rings', 'lanes'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} type="button" className={view === v ? 'is-on' : ''} onClick={() => setView(v)}>
            {v === 'rings' ? 'Rings' : 'Lanes'}
          </button>
        ))}
      </div>
      <div className="nl-stage">
        <div className="nl-figure">{view === 'rings' ? <Dial open={open} setOpen={setOpen} night={night} /> : <Lanes open={open} setOpen={setOpen} night={night} />}</div>
        <aside className="nl-detail" aria-live="polite">
          {sel ? (
            <Setlist s={sel} night={night} />
          ) : (
            <>
              <p className="nl-hint">Pick a set to see what's in it.</p>
              <ol className="nl-index">
                {sets.slice()
                  .sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9))
                  .map((s) => (
                    <li key={s.id}>
                      <button type="button" className="pix-link" onClick={() => setOpen(s.id)}>
                        <i>{fmt(s.start)}</i> {s.name}
                      </button>
                      <small>{lanes[laneIx(lanes, s.lane)]?.label}</small>
                    </li>
                  ))}
              </ol>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
