/**
 * Deterministic sign-in adapter state machine.
 * idle → connecting → connected | error. No timers live here.
 */
export type AdapterPhase = 'idle' | 'connecting' | 'connected' | 'error'

export type AdapterIdentity = {
  kind: string
  id: string
}

export type AdapterState = {
  phase: AdapterPhase
  identity?: AdapterIdentity
  error?: string
  waiting?: boolean
}

export type AdapterEvent =
  | { type: 'start' }
  | { type: 'waiting' }
  | { type: 'success'; identity: AdapterIdentity }
  | { type: 'fail'; error: string }
  | { type: 'reset' }

export const idleAdapter = (): AdapterState => ({ phase: 'idle' })

/** Pure reducer. A second start while connecting is ignored (no double request). */
export const reduceAdapter = (state: AdapterState, event: AdapterEvent): AdapterState => {
  switch (event.type) {
    case 'reset':
      return idleAdapter()
    case 'start':
      if (state.phase === 'connecting' || state.phase === 'connected') return state
      return { phase: 'connecting' }
    case 'waiting':
      if (state.phase !== 'connecting') return state
      return { ...state, waiting: true }
    case 'success':
      if (state.phase !== 'connecting') return state
      return { phase: 'connected', identity: event.identity }
    case 'fail':
      if (state.phase !== 'connecting') return state
      return { phase: 'error', error: event.error }
    default:
      return state
  }
}
