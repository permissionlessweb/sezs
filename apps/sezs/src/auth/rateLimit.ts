/**
 * Device-local attempt limiter for desk/admin unlock.
 * This is not a server rate limit. Static export has no origin to enforce one.
 */
const WINDOW_MS = 60_000
const MAX = 5
const KEY = 'sezs-auth-attempts-v1'

type Bucket = { t: number; n: number }

function read(): Record<string, Bucket> {
  if (typeof sessionStorage === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return {}
    const o = JSON.parse(raw) as Record<string, Bucket>
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch {
    return {}
  }
}

function write(o: Record<string, Bucket>) {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(KEY, JSON.stringify(o))
}

export function allowAttempt(bucket: string): { ok: boolean; waitMs: number } {
  const now = Date.now()
  const all = read()
  const cur = all[bucket]
  if (!cur || now - cur.t > WINDOW_MS) {
    all[bucket] = { t: now, n: 1 }
    write(all)
    return { ok: true, waitMs: 0 }
  }
  if (cur.n >= MAX) {
    return { ok: false, waitMs: WINDOW_MS - (now - cur.t) }
  }
  cur.n += 1
  write(all)
  return { ok: true, waitMs: 0 }
}

export const RATE_MAX = MAX
export const RATE_WINDOW_MS = WINDOW_MS
