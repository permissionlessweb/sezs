import { describe, expect, it, vi } from 'vitest'

import {
  buildBuzzOpenUrl,
  httpToWss,
  probeRelayerHttp,
  resolveBuzzRelayer,
  wssToHttp,
} from './resolveRelayer'

describe('resolveBuzzRelayer', () => {
  it('prefers module HTTP/WSS over chain fallbacks', () => {
    const r = resolveBuzzRelayer({
      relayerHttpUrl: 'http://relay.example:3000',
      relayerWssUrl: 'ws://relay.example:3000',
      chainHttpFallback: 'http://chain.example',
      chainWssFallback: 'ws://chain.example',
    })
    expect(r.httpUrl).toBe('http://relay.example:3000')
    expect(r.wssUrl).toBe('ws://relay.example:3000')
    expect(r.source).toBe('module')
  })

  it('derives WSS from HTTP when only HTTP is set', () => {
    const r = resolveBuzzRelayer({
      relayerHttpUrl: 'https://buzz.example',
    })
    expect(r.wssUrl).toBe('wss://buzz.example')
  })

  it('uses embed then chain', () => {
    const r = resolveBuzzRelayer({
      embedBaseUrl: 'http://127.0.0.1:3001',
      chainHttpFallback: 'http://localhost:3000',
    })
    expect(r.httpUrl).toBe('http://127.0.0.1:3001')
    expect(r.source).toBe('embed')
  })

  it('returns empty when nothing configured', () => {
    const r = resolveBuzzRelayer({})
    expect(r.httpUrl).toBe('')
    expect(r.wssUrl).toBe('')
    expect(r.source).toBe('empty')
  })
})

describe('httpToWss / wssToHttp', () => {
  it('round-trips scheme', () => {
    expect(httpToWss('http://localhost:3000/path')).toBe(
      'ws://localhost:3000'
    )
    expect(wssToHttp('wss://buzz.example/foo')).toBe('https://buzz.example')
  })
})

describe('buildBuzzOpenUrl', () => {
  it('appends discovery params', () => {
    const url = buildBuzzOpenUrl('http://127.0.0.1:3001', {
      communityId: 'evt-1',
      daoAddress: 'terp1dao',
      chainId: '120u-1',
    })
    expect(url).toContain('community=evt-1')
    expect(url).toContain('dao=terp1dao')
    expect(url).toContain('chain_id=120u-1')
  })

  it('returns empty for non-http', () => {
    expect(buildBuzzOpenUrl('ws://only')).toBe('')
  })
})

describe('probeRelayerHttp', () => {
  it('reports ok on 200 liveness', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/plain' },
    })
    const r = await probeRelayerHttp(
      'http://127.0.0.1:3001',
      fetchImpl as unknown as typeof fetch
    )
    expect(r.state).toBe('ok')
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('reports unreachable when fetch throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const r = await probeRelayerHttp(
      'http://localhost:3000',
      fetchImpl as unknown as typeof fetch
    )
    expect(r.state).toBe('unreachable')
  })
})
