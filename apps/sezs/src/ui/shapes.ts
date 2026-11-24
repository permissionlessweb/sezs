/**
 * Wireframe solids sampled into evenly spaced edge points.
 * Independent implementation of the "particles along polyhedron edges,
 * morph by progress" idea studied in OutThisLife/bb-particles (no code taken;
 * that repo has no license).
 */
export type V3 = [number, number, number]
export type Shape = 'icosa' | 'octa' | 'cube' | 'ring' | 'tetra' | 'helix'

const phi = (1 + Math.sqrt(5)) / 2

const solid = (verts: V3[], edgeLen: number): [V3, V3][] => {
  const out: [V3, V3][] = []
  for (let i = 0; i < verts.length; i++)
    for (let j = i + 1; j < verts.length; j++) {
      const d = Math.hypot(verts[i][0] - verts[j][0], verts[i][1] - verts[j][1], verts[i][2] - verts[j][2])
      if (Math.abs(d - edgeLen) < 1e-3) out.push([verts[i], verts[j]])
    }
  return out
}

const EDGES: Record<Exclude<Shape, 'ring' | 'helix'>, () => [V3, V3][]> = {
  icosa: () => {
    const v: V3[] = []
    for (const a of [-1, 1]) for (const b of [-phi, phi]) v.push([0, a, b], [a, b, 0], [b, 0, a])
    return solid(v, 2)
  },
  octa: () => solid([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], Math.SQRT2),
  cube: () => {
    const v: V3[] = []
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z])
    return solid(v, 2)
  },
  tetra: () => solid([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], 2 * Math.SQRT2),
}

const norm = (pts: V3[]) => {
  const r = Math.max(...pts.map((p) => Math.hypot(...p))) || 1
  return pts.map((p) => [p[0] / r, p[1] / r, p[2] / r] as V3)
}

export const sample = (shape: Shape, n: number): V3[] => {
  if (shape === 'ring') {
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2
      const k = i % 3 // three concentric tilted rings
      const r = 1 - k * 0.22
      return [Math.cos(a) * r, Math.sin(a) * r * Math.cos(k * 0.5), Math.sin(a) * r * Math.sin(k * 0.5)] as V3
    })
  }
  if (shape === 'helix') {
    return norm(Array.from({ length: n }, (_, i) => {
      const t = i / n
      const a = t * Math.PI * 10
      return [Math.cos(a) * 0.7, (t - 0.5) * 2, Math.sin(a) * 0.7] as V3
    }))
  }
  const edges = EDGES[shape]()
  const lens = edges.map(([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))
  const total = lens.reduce((s, l) => s + l, 0)
  const out: V3[] = []
  let e = 0
  let acc = 0
  for (let i = 0; i < n; i++) {
    const t = (i / n) * total
    while (e < edges.length - 1 && acc + lens[e] < t) acc += lens[e++]
    const [a, b] = edges[e]
    const u = (t - acc) / lens[e]
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u])
  }
  return norm(out)
}
