import Link from 'next/link'
import { CSSProperties, ReactNode } from 'react'

export type ClockItem = {
  key: string
  /** Hour on a 12-hour clock face (12, 2, 4, 6, 8, 10). */
  hour: number
  title: ReactNode
  note?: ReactNode
  href?: string
  onClick?: () => void
  tone?: string
}

const pos = (hour: number): CSSProperties => {
  const a = ((hour % 12) / 12) * 2 * Math.PI
  // 12 o'clock is up: 0 rad after shifting by -90deg in standard math, i.e. use hour 0 = 12.
  const x = 50 + Math.sin(a) * 42
  const y = 50 - Math.cos(a) * 42
  return { '--x': `${x}%`, '--y': `${y}%` } as CSSProperties
}

/** Fixed clock positions so every room on the gallery wall stays where it belongs. */
export const ClockWall = ({ items, label, center }: { items: ClockItem[]; label: string; center?: ReactNode }) => (
  <div className="orbit clock-wall" role="list" aria-label={label}>
    <svg className="orbit-rings" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="44" />
      <circle cx="50" cy="50" r="28" className="thin" />
    </svg>
    {center ? <div className="orbit-center">{center}</div> : null}
    {items.map((it) => {
      const inner = (
        <>
          <span className="node" aria-hidden="true" />
          <span className="orbit-t">{it.title}</span>
          {it.note ? <span className="orbit-note">{it.note}</span> : null}
        </>
      )
      const style = pos(it.hour)
      const cls = 'orbit-item' + (it.tone ? ` tone-${it.tone}` : '')
      if (it.onClick) {
        return (
          <button key={it.key} type="button" className={cls} role="listitem" style={style} onClick={it.onClick}>
            {inner}
          </button>
        )
      }
      if (it.href) {
        return (
          <Link key={it.key} href={it.href} scroll={false} className={cls} role="listitem" style={style}>
            {inner}
          </Link>
        )
      }
      return (
        <div key={it.key} className={cls} role="listitem" style={style}>
          {inner}
        </div>
      )
    })}
  </div>
)
