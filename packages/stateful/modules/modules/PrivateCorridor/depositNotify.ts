/**
 * Subscribe to hash-market corridor deposit notifications.
 *
 * Trust: open watch from this webapp; observations are coordination hints.
 * Re-verify deposit before advancing production automation when possible.
 *
 * API: docs in hash-market docs/corridor-deposit-notify.md
 */

export type OpenCorridorWatchBody = {
  intent_id: string
  corridor_id: string
  btc_deposit_addr: string
  domain_bind: string
  dest_owner_binding: string
  client_proof_digest: string
  client_pubkey_hex?: string
  ttl_secs?: number
}

export type DepositObservation = {
  intent_id: string
  btc_deposit_addr: string
  txid: string
  amount_sats: number
  confirmations: number
  observed_at: number
  reporter: string
  domain_bind?: string
}

export type CorridorNotifyEvent =
  | { type: 'watch_opened'; intent_id: string; btc_deposit_addr: string; at: number }
  | { type: 'deposit_observed'; observation: DepositObservation }
  | { type: 'watch_expired'; intent_id: string; at: number }

const trimBase = (base: string) => base.replace(/\/$/, '')

/** Open a deposit watch bound to UI client proof (origin webapp on server). */
export const openCorridorWatch = async (
  notifyBase: string,
  body: OpenCorridorWatchBody
): Promise<Response> => {
  return fetch(`${trimBase(notifyBase)}/corridor/watches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Poll status (fallback when SSE unavailable). */
export const pollCorridorWatch = async (
  notifyBase: string,
  intentId: string
): Promise<{ status: string; observation?: DepositObservation }> => {
  const res = await fetch(
    `${trimBase(notifyBase)}/corridor/watches/${encodeURIComponent(intentId)}`
  )
  if (!res.ok) {
    throw new Error(`watch status ${res.status}`)
  }
  return res.json()
}

/**
 * SSE subscribe. Returns cleanup function.
 * Prefer notesBase / oracleBase host if unified hash-market-server.
 */
export const subscribeCorridorDeposits = (
  notifyBase: string,
  intentId: string,
  onEvent: (ev: CorridorNotifyEvent) => void,
  onError?: (err: Event) => void
): (() => void) => {
  if (typeof EventSource === 'undefined') {
    // Poll fallback every 3s
    let stopped = false
    const tick = async () => {
      if (stopped) return
      try {
        const st = await pollCorridorWatch(notifyBase, intentId)
        if (st.status === 'deposit_observed' && st.observation) {
          onEvent({ type: 'deposit_observed', observation: st.observation })
          return
        }
      } catch (e) {
        console.warn('corridor poll', e)
      }
      if (!stopped) {
        setTimeout(tick, 3000)
      }
    }
    void tick()
    return () => {
      stopped = true
    }
  }

  const url = `${trimBase(notifyBase)}/corridor/watches/${encodeURIComponent(intentId)}/events`
  const es = new EventSource(url)
  es.addEventListener('corridor', (msg) => {
    try {
      const data = JSON.parse((msg as MessageEvent).data) as CorridorNotifyEvent
      onEvent(data)
    } catch (e) {
      console.warn('corridor sse parse', e)
    }
  })
  es.onerror = (err) => {
    onError?.(err)
  }
  return () => {
    es.close()
  }
}

/** Lab helper: report observation to open hub (same host). */
export const reportLabObservation = async (
  notifyBase: string,
  observation: DepositObservation
): Promise<Response> => {
  return fetch(`${trimBase(notifyBase)}/corridor/observations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(observation),
  })
}
