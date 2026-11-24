/**
 * Ordered dithering + dot physics.
 *
 * Portions adapted from lenxism/dither (src/lib/dither-algorithms.ts,
 * src/lib/particle-system.ts), MIT License:
 *
 *   Copyright (c) 2026 Dither Playground Contributors
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the
 *   "Software"), to deal in the Software without restriction, including
 *   without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to permit
 *   persons to whom the Software is furnished to do so, subject to the
 *   following conditions: The above copyright notice and this permission
 *   notice shall be included in all copies or substantial portions of the
 *   Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */

// prettier-ignore
export const BAYER_8X8 = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
]

/** Threshold in (0,1) for cell (x,y). */
export const bayer = (x: number, y: number) => (BAYER_8X8[(y & 7) * 8 + (x & 7)] + 1) / 65

/** Mouse push + click shockwave constants (from the dither ref, scaled for a low-res field). */
export const PUSH = { radius: 34, peak: 9, easing: 0.12 }
export const SHOCK = { speed: 90, width: 14, strength: 7, duration: 675 }

export type Shock = { x: number; y: number; start: number }

/** Displacement force on a point from cursor + shockwaves. */
export const force = (
  px: number,
  py: number,
  mx: number,
  my: number,
  mouse: boolean,
  shocks: Shock[],
  now: number
): [number, number] => {
  let fx = 0
  let fy = 0
  if (mouse) {
    const vx = px - mx
    const vy = py - my
    const d2 = vx * vx + vy * vy
    if (d2 > 0.1 && d2 < PUSH.radius * PUSH.radius) {
      const d = Math.sqrt(d2)
      const f = (1 - d / PUSH.radius) ** 3 * PUSH.peak
      fx += (vx / d) * f
      fy += (vy / d) * f
    }
  }
  for (const s of shocks) {
    const t = now - s.start
    const r = (t / 1000) * SHOCK.speed
    const life = 1 - t / SHOCK.duration
    const sx = px - s.x
    const sy = py - s.y
    const d = Math.sqrt(sx * sx + sy * sy)
    if (d < 0.1) continue
    const band = Math.abs(d - r)
    if (band < SHOCK.width) {
      const f = (1 - band / SHOCK.width) * life * SHOCK.strength
      fx += (sx / d) * f
      fy += (sy / d) * f
    }
  }
  return [fx, fy]
}
