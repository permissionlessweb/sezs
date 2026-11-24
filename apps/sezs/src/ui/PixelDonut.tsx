import { bayer } from './dither'

/**
 * 8-bit donut. Every cell of a G×G grid is lit or dark; a segment's tone
 * decides its density. 'lit' = solid warm, 'pale' = solid pale,
 * 'line' = white checker, 'dither' = sparse ordered dither (the discount).
 */
export type PixSeg = { value: number; tone: 'lit' | 'pale' | 'line' | 'dither' }
export type PixRing = { segs: PixSeg[] }

const FILL = { lit: '#ffb347', pale: '#f7d9a8', line: '#ffffff', dither: '#f7d9a8' }

export const PixelDonut = ({ rings, label, center, sub, G = 72 }: { rings: PixRing[]; label: string; center: string; sub?: string; G?: number }) => {
  const c = (G - 1) / 2
  const outer = c - 1
  const band = rings.length > 1 ? Math.max(3, Math.floor((outer * 0.55) / rings.length)) : Math.floor(outer * 0.22)
  const gap = rings.length > 1 ? 2 : 0
  const paths: Record<string, string> = { lit: '', pale: '', line: '', dither: '', core: '', hot: '' }
  for (let y = 0; y < G; y++)
    for (let x = 0; x < G; x++) {
      const dx = x - c
      const dy = y - c
      const r = Math.hypot(dx, dy)
      const cell = `M${x} ${y}h1v1h-1z`
      // core glow in the hole
      const inner = outer - rings.length * (band + gap)
      if (r < inner) {
        const v = Math.exp(-((r / inner) ** 2) * 2.6) * 0.95
        if (v > bayer(x, y)) paths[v > 0.7 ? 'hot' : 'core'] += cell
        continue
      }
      const ri = Math.floor((outer - r) / (band + gap))
      if (ri < 0 || ri >= rings.length) continue
      if (outer - r - ri * (band + gap) > band) continue
      // clockwise from 12 o'clock
      const a = (Math.atan2(dx, -dy) / (Math.PI * 2) + 1) % 1
      let acc = 0
      for (const s of rings[ri].segs) {
        if (a < acc + s.value) {
          const t = bayer(x, y)
          const on = s.tone === 'dither' ? t < 0.2 : s.tone === 'line' ? (x + y) % 2 === 0 : true
          if (on) paths[s.tone] += cell
          break
        }
        acc += s.value
      }
    }
  return (
    <svg className="pix-donut" viewBox={`0 0 ${G} ${G}`} shapeRendering="crispEdges" role="img" aria-label={label}>
      <title>{label}</title>
      <path d={paths.core} fill="#c46822" />
      <path d={paths.hot} fill="#fff1c9" />
      <path d={paths.dither} fill={FILL.dither} opacity=".7" />
      <path d={paths.line} fill={FILL.line} opacity=".75" />
      <path d={paths.pale} fill={FILL.pale} />
      <path d={paths.lit} fill={FILL.lit} />
      <text x={c + 0.5} y={c + (sub ? 0 : 2)} textAnchor="middle" className="pix-donut-c">
        {center}
      </text>
      {sub ? (
        <text x={c + 0.5} y={c + 5} textAnchor="middle" className="pix-donut-s">
          {sub}
        </text>
      ) : null}
    </svg>
  )
}
