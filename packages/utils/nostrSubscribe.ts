/**
 * Minimal Nostr live plane over mesh.relays[] (progressive enhancement).
 *
 * Design: Live plane is optional. Catalog / month view must work via HTTP/chain
 * alone. This client only speaks REQ/EVENT/CLOSE over WSS — no NIP-07, no
 * signing, no full client library. Never used to settle money.
 */

export type NostrFilter = {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  /** Tag filters e.g. '#t': ['marketplace'] */
  [tag: `#${string}`]: string[] | undefined
}

export type NostrEvent = {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export type SubscribeOptions = {
  /** Relay WSS URLs (usually mesh.relays). */
  relays: string[]
  /** REQ filters (OR'd by the relay). */
  filters: NostrFilter[]
  onEvent: (event: NostrEvent, relay: string) => void
  onEose?: (relay: string) => void
  onError?: (err: Error, relay: string) => void
  onStatus?: (
    status: 'connecting' | 'open' | 'closed' | 'error',
    relay: string
  ) => void
  /** Max relays to open (default 3). */
  maxRelays?: number
  /** WebSocket factory (tests / non-browser). */
  WebSocketImpl?: typeof WebSocket
  /** Sub id prefix for debugging (default mesh-sub). */
  subPrefix?: string
}

export type NostrSubscription = {
  /** Close all sockets and stop receiving. */
  close: () => void
  /** Active relay URLs that still have an open socket. */
  relays: () => string[]
}

let subCounter = 0

function nextSubId(prefix: string): string {
  subCounter += 1
  return `${prefix}-${subCounter}-${Date.now().toString(36)}`
}

/**
 * Subscribe to Nostr kinds on mesh relays.
 * Failures on individual relays never throw — they call onError and leave
 * other relays running. Empty relays → soft error + noop subscription.
 */
export function subscribeNostr(opts: SubscribeOptions): NostrSubscription {
  const WebSocketImpl = opts.WebSocketImpl ?? globalThis.WebSocket
  if (!WebSocketImpl) {
    opts.onError?.(
      new Error('WebSocket not available in this environment'),
      opts.relays[0] || ''
    )
    return { close: () => {}, relays: () => [] }
  }

  if (!opts.relays?.length) {
    opts.onError?.(new Error('no relays configured'), '')
    return { close: () => {}, relays: () => [] }
  }

  if (!opts.filters?.length) {
    opts.onError?.(new Error('no filters configured'), '')
    return { close: () => {}, relays: () => [] }
  }

  const max = opts.maxRelays ?? 3
  const relays = [...new Set(opts.relays.filter(Boolean))].slice(0, max)
  const sockets = new Map<string, WebSocket>()
  let closed = false
  const subId = nextSubId(opts.subPrefix ?? 'mesh-sub')

  for (const relay of relays) {
    try {
      opts.onStatus?.('connecting', relay)
      const ws = new WebSocketImpl(relay)
      sockets.set(relay, ws)

      ws.onopen = () => {
        if (closed) {
          ws.close()
          return
        }
        opts.onStatus?.('open', relay)
        // REQ frame: ["REQ", <sub_id>, <filter1>, <filter2>, ...]
        const frame = ['REQ', subId, ...opts.filters]
        ws.send(JSON.stringify(frame))
      }

      ws.onmessage = (ev) => {
        if (closed) return
        let msg: unknown
        try {
          msg = JSON.parse(String(ev.data))
        } catch {
          return
        }
        if (!Array.isArray(msg) || msg.length < 2) return
        const type = msg[0]
        if (type === 'EVENT' && msg.length >= 3) {
          const event = msg[2] as NostrEvent
          if (event && typeof event === 'object' && event.id) {
            opts.onEvent(event, relay)
          }
        } else if (type === 'EOSE') {
          opts.onEose?.(relay)
        } else if (type === 'NOTICE' && typeof msg[1] === 'string') {
          opts.onError?.(new Error(`relay notice: ${msg[1]}`), relay)
        }
      }

      ws.onerror = () => {
        opts.onStatus?.('error', relay)
        opts.onError?.(new Error(`WebSocket error on ${relay}`), relay)
      }

      ws.onclose = () => {
        sockets.delete(relay)
        opts.onStatus?.('closed', relay)
      }
    } catch (err) {
      opts.onError?.(
        err instanceof Error ? err : new Error(String(err)),
        relay
      )
    }
  }

  return {
    close: () => {
      closed = true
      for (const [, ws] of sockets) {
        try {
          if (ws.readyState === WebSocketImpl.OPEN) {
            ws.send(JSON.stringify(['CLOSE', subId]))
          }
          ws.close()
        } catch {
          // ignore
        }
      }
      sockets.clear()
    },
    relays: () => [...sockets.keys()],
  }
}
