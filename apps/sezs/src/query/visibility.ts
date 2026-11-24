/** Run a poll only while the tab is visible.
 *
 * Starts with an immediate tick, then repeats every `ms`. When the tab is
 * hidden the interval stops (no ticks in the background). When it becomes
 * visible again, one tick runs immediately and the interval resumes.
 */

export type VisibilityIo = {
  hidden: () => boolean
  subscribe: (onChange: () => void) => () => void
}

export const documentVisibility = (): VisibilityIo => ({
  hidden: () => typeof document !== 'undefined' && document.hidden,
  subscribe: (onChange) => {
    if (typeof document === 'undefined') return () => {}
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  },
})

export function startVisibleInterval(tick: () => void, ms: number, io: VisibilityIo = documentVisibility()): () => void {
  let id: ReturnType<typeof setInterval> | undefined
  const start = () => {
    if (id != null) return
    tick()
    id = setInterval(tick, ms)
  }
  const stop = () => {
    if (id == null) return
    clearInterval(id)
    id = undefined
  }
  const sync = () => {
    if (io.hidden()) stop()
    else start()
  }
  sync()
  const unsub = io.subscribe(sync)
  return () => {
    stop()
    unsub()
  }
}
