import { describe, expect, test, vi } from 'vitest'

import { subscribeNostr, type NostrEvent } from './nostrSubscribe'

class MockWebSocket {
  static OPEN = 1
  static instances: MockWebSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []
  url: string

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.()
    })
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.onclose?.()
  }

  emitEvent(event: NostrEvent) {
    this.onmessage?.({
      data: JSON.stringify(['EVENT', 'sub', event]),
    })
  }
}

describe('subscribeNostr', () => {
  test('soft-fails with no relays', () => {
    const onError = vi.fn()
    const sub = subscribeNostr({
      relays: [],
      filters: [{ kinds: [30018] }],
      onEvent: () => {},
      onError,
    })
    expect(onError).toHaveBeenCalled()
    sub.close()
  })

  test('REQ and EVENT path', async () => {
    MockWebSocket.instances = []
    const seen: NostrEvent[] = []
    const sub = subscribeNostr({
      relays: ['wss://relay.example'],
      filters: [{ kinds: [30018], limit: 5 }],
      onEvent: (e) => seen.push(e),
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      subPrefix: 'test-mkt',
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(MockWebSocket.instances.length).toBe(1)
    const ws = MockWebSocket.instances[0]
    expect(ws.sent[0]).toContain('REQ')
    expect(ws.sent[0]).toContain('30018')

    const evt: NostrEvent = {
      id: 'evt1',
      pubkey: 'pk',
      created_at: 1,
      kind: 30018,
      tags: [],
      content: '{}',
      sig: 's',
    }
    ws.emitEvent(evt)
    expect(seen).toHaveLength(1)
    expect(seen[0].id).toBe('evt1')

    sub.close()
  })
})
