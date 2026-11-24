import Link from 'next/link'
import { CSSProperties, ReactNode } from 'react'

import { bayer } from './dither'

/** A movement: pixel numeral, serif title, flowing body, filament below. */
export const Movement = ({
  n,
  title,
  lede,
  id,
  children,
  align = 'center',
}: {
  n?: number | string
  title: ReactNode
  lede?: ReactNode
  id?: string
  children?: ReactNode
  align?: 'center' | 'left'
}) => (
  <section className={'mv mv-' + align} id={id}>
    {n !== undefined ? <p className="mv-n">{n} ·</p> : null}
    <h2 className="mv-title">{title}</h2>
    {lede ? <p className="mv-lede">{lede}</p> : null}
    {children ? <div className="mv-body">{children}</div> : null}
    <Filament />
  </section>
)

export const Filament = () => (
  <svg className="filament" viewBox="0 0 600 60" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 30 C150 0 220 60 300 30 S450 0 600 30" />
    <circle cx="300" cy="30" r="2.4" />
  </svg>
)

/** Hero: title floating in the core's light. */
export const Halo = ({ kicker, title, sub, children, compact }: { kicker?: ReactNode; title: ReactNode; sub?: ReactNode; children?: ReactNode; compact?: boolean }) => (
  <header className={compact ? 'halo halo-page' : 'halo'}>
    {kicker ? <p className="halo-kicker">{kicker}</p> : null}
    <h1 className="halo-title">{title}</h1>
    {sub ? <p className="halo-sub">{sub}</p> : null}
    {children ? <div className="halo-act">{children}</div> : null}
  </header>
)

export type OrbitItem = { key: string; title: ReactNode; note?: ReactNode; href?: string; id?: string; onClick?: () => void }

/** Items placed on a circle around a dithered core. Mobile: a vertical filament. */
export const Orbit = ({ items, label, center, rings = 1 }: { items: OrbitItem[]; label: string; center?: ReactNode; rings?: number }) => {
  const n = Math.max(items.length, 1)
  return (
    <div className="orbit" role="list" aria-label={label} style={{ '--n': n } as CSSProperties}>
      <svg className="orbit-rings" viewBox="0 0 100 100" aria-hidden="true">
        {Array.from({ length: rings + 1 }, (_, i) => (
          <circle key={i} cx="50" cy="50" r={44 - i * 9} />
        ))}
      </svg>
      <div className="orbit-core" aria-hidden="true">
        <PixelCore />
      </div>
      {center ? <div className="orbit-center">{center}</div> : null}
      {items.map((it, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2
        const style = { '--x': `${50 + Math.cos(a) * 44}%`, '--y': `${50 + Math.sin(a) * 44}%` } as CSSProperties
        const body = (
          <>
            <span className="node" aria-hidden="true" />
            <span className="orbit-t">{it.title}</span>
            {it.note ? <span className="orbit-note">{it.note}</span> : null}
          </>
        )
        return (
          <div key={it.key} className="orbit-item" role="listitem" style={style} id={it.id}>
            {it.href ? (
              <Link href={it.href} scroll={false}>{body}</Link>
            ) : it.onClick ? (
              <button type="button" className="orbit-hit" onClick={it.onClick}>{body}</button>
            ) : (
              body
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Numbered steps on a shallow arc, permissionless-style "1 · Send". */
export const Ritual = ({ steps, active }: { steps: { title: ReactNode; note?: ReactNode }[]; active?: number }) => (
  <ol className="ritual">
    {steps.map((s, i) => (
      <li key={i} className={active === i ? 'is-on' : active !== undefined && i < active ? 'is-done' : ''} style={{ '--k': Math.sin(((i + 0.5) / steps.length) * Math.PI) } as CSSProperties}>
        <span className="ritual-n">{i + 1} ·</span>
        <span className="ritual-t">{s.title}</span>
        {s.note ? <span className="ritual-note">{s.note}</span> : null}
      </li>
    ))}
  </ol>
)

/** label ........ value */
export const Ledger = ({ rows }: { rows: { k: ReactNode; v: ReactNode; tone?: 'ok' | 'dim' }[] }) => (
  <dl className="ledger">
    {rows.map((r, i) => (
      <div key={i} className={r.tone ? 'is-' + r.tone : ''}>
        <dt>{r.k}</dt>
        <dd>{r.v}</dd>
      </div>
    ))}
  </dl>
)

/** Small dithered core: the only light in a composition. */
export const PixelCore = ({ cells = 21 }: { cells?: number }) => {
  const c = (cells - 1) / 2
  let hot = ''
  let warm = ''
  let ember = ''
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++) {
      const d = Math.hypot(x - c, y - c) / c
      const v = Math.exp(-d * d * 3)
      if (v <= bayer(x, y)) continue
      const r = `M${x} ${y}h1v1h-1z`
      if (v > 0.8) hot += r
      else if (v > 0.45) warm += r
      else ember += r
    }
  return (
    <svg viewBox={`0 0 ${cells} ${cells}`} shapeRendering="crispEdges" className="pixel-core">
      <path d={ember} fill="#a0521a" />
      <path d={warm} fill="#ffb347" />
      <path d={hot} fill="#fff1c9" />
    </svg>
  )
}
