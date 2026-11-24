import { useEffect, useRef } from 'react'

import { bayer, force, PUSH, Shock } from './dither'
import { sample, Shape } from './shapes'

/**
 * The room: near-black field, one warm core, edge particles and filaments,
 * all quantised through an 8x8 ordered dither at 1/3 resolution.
 */
const SCALE = 3
const N = 720
const FPS = 30

// warm ramp: dim ember -> core -> hot white
const RAMP: [number, number, number][] = [
  [92, 44, 14],
  [196, 104, 34],
  [255, 179, 71],
  [255, 214, 150],
  [255, 241, 201],
]
const BG_NIGHT: [number, number, number] = [7, 7, 10]
const BG_DAY: [number, number, number] = [246, 238, 220]
const fieldBg = (): [number, number, number] =>
  typeof document !== 'undefined' && document.documentElement.dataset.tone === 'day' ? BG_DAY : BG_NIGHT

export default function Field({ shape = 'icosa', core: coreIn = [0.5, 0.32], intensity = 1 }: { shape?: Shape; core?: [number, number]; intensity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const shapeRef = useRef(shape)
  shapeRef.current = shape

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d', { alpha: false })
    if (!ctx) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // narrow screens: lift the core so it sits above the hero type, not behind it
    const narrow = window.innerWidth < 680
    const core: [number, number] = narrow ? [coreIn[0], Math.max(0.14, coreIn[1] * 0.62)] : coreIn
    const gain = intensity * (narrow ? 0.8 : 1)
    let W = 0
    let H = 0
    let img: ImageData
    let L: Float32Array
    let glow: Float32Array
    const resize = () => {
      W = Math.ceil(window.innerWidth / SCALE)
      H = Math.ceil(window.innerHeight / SCALE)
      cv.width = W
      cv.height = H
      img = ctx.createImageData(W, H)
      L = new Float32Array(W * H)
      glow = new Float32Array(W * H)
      const R = Math.min(W, H) * 0.34
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const d = Math.hypot(x - W * core[0], (y - H * core[1]) * 1.05) / R
          glow[y * W + x] = gain * (1.25 * Math.exp(-d * d * 2.2) + 0.05 * Math.exp(-d * 0.6))
        }
    }
    resize()

    let from = sample(shapeRef.current, N)
    let to = from
    let cur = shapeRef.current
    let morph = 1
    const ox = new Float32Array(N)
    const oy = new Float32Array(N)
    const shocks: Shock[] = []
    let mx = -1e3
    let my = -1e3
    let mouse = false
    const onMove = (e: PointerEvent) => {
      mx = e.clientX / SCALE
      my = e.clientY / SCALE
      mouse = true
    }
    const onLeave = () => (mouse = false)
    const onDown = (e: PointerEvent) => shocks.push({ x: e.clientX / SCALE, y: e.clientY / SCALE, start: performance.now() })
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    window.addEventListener('resize', resize)

    const plot = (x: number, y: number, v: number) => {
      const xi = x | 0
      const yi = y | 0
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) return
      L[yi * W + xi] += v
    }
    const line = (x0: number, y0: number, x1: number, y1: number, v: number) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0
      for (let i = 0; i <= n; i++) plot(x0 + ((x1 - x0) * i) / (n || 1), y0 + ((y1 - y0) * i) / (n || 1), v)
    }

    let raf = 0
    let last = 0
    const t0 = performance.now()
    const frame = (now: number) => {
      raf = still ? 0 : requestAnimationFrame(frame)
      if (!still && now - last < 1000 / FPS) return
      last = now
      if (document.hidden) return
      const t = (now - t0) / 1000

      if (shapeRef.current !== cur) {
        from = from.map((p, i) => {
          const q = to[i]
          return [p[0] + (q[0] - p[0]) * morph, p[1] + (q[1] - p[1]) * morph, p[2] + (q[2] - p[2]) * morph]
        })
        to = sample(shapeRef.current, N)
        cur = shapeRef.current
        morph = 0
      }
      morph = Math.min(1, morph + 0.025)
      const e = morph < 0.5 ? 2 * morph * morph : 1 - (-2 * morph + 2) ** 2 / 2

      const breathe = 0.92 + 0.08 * Math.sin(t * 0.7)
      for (let i = 0; i < L.length; i++) L[i] = glow[i] * breathe

      const cx = W * core[0]
      const cy = H * core[1]
      const R = Math.min(W, H) * (narrow ? 0.24 : 0.3)
      const ay = t * 0.18
      const ax = 0.42 + Math.sin(t * 0.11) * 0.2
      const cyA = Math.cos(ay)
      const syA = Math.sin(ay)
      const cxA = Math.cos(ax)
      const sxA = Math.sin(ax)
      for (let s = shocks.length - 1; s >= 0; s--) if (now - shocks[s].start > 675) shocks.splice(s, 1)

      let px0 = 0
      let py0 = 0
      for (let i = 0; i < N; i++) {
        const a = from[i]
        const b = to[i]
        let x = a[0] + (b[0] - a[0]) * e
        let y = a[1] + (b[1] - a[1]) * e
        let z = a[2] + (b[2] - a[2]) * e
        const f = i * 0.37
        y += Math.sin(t + f) * 0.012
        // rotate Y then X
        const x1 = x * cyA + z * syA
        const z1 = -x * syA + z * cyA
        const y1 = y * cxA - z1 * sxA
        const z2 = y * sxA + z1 * cxA
        const p = 2.6 / (2.6 + z2)
        let sx = cx + x1 * R * p
        let sy = cy + y1 * R * p
        const [fx, fy] = force(sx + ox[i], sy + oy[i], mx, my, mouse, shocks, now)
        ox[i] += (fx - ox[i]) * PUSH.easing
        oy[i] += (fy - oy[i]) * PUSH.easing
        sx += ox[i]
        sy += oy[i]
        // lit by the core only: nearer the core and nearer the viewer is brighter
        const lit = 0.35 + 0.65 * Math.max(0, 1 - z2) * 0.8
        plot(sx, sy, 0.9 * lit * gain)
        if (i % 2 && i > 0) line(px0, py0, sx, sy, 0.22 * lit) // filament along the edge
        if (i % 90 === 0) line(cx, cy, sx, sy, 0.05) // long filament to the core
        px0 = sx
        py0 = sy
      }
      // drifting motes
      for (let k = 0; k < 60; k++) {
        const a = k * 2.399 + t * 0.03 * ((k % 5) + 1)
        const r = (0.35 + ((k * 37) % 100) / 100) * Math.max(W, H) * 0.5
        plot(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.7, 0.55)
      }

      const d = img.data
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = y * W + x
          const v = L[i]
          const o = i * 4
          if (v > bayer(x, y) * 0.9 + 0.03) {
            const c = RAMP[Math.min(4, Math.max(0, (v * 3.2) | 0))]
            d[o] = c[0]
            d[o + 1] = c[1]
            d[o + 2] = c[2]
          } else {
            const bg = fieldBg()
            d[o] = bg[0]
            d[o + 1] = bg[1]
            d[o + 2] = bg[2]
          }
          d[o + 3] = 255
        }
      ctx.putImageData(img, 0, 0)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('resize', resize)
    }
  }, [coreIn[0], coreIn[1], intensity])

  return <canvas ref={ref} className="field-canvas" aria-hidden="true" />
}
