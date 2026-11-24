import { describe, expect, test } from 'vitest'

import {
  BUZZ_PROTOCOL_VERSION,
  buildBuzzDaoAttestMessage,
} from './constants'
import { buildBuzzEmbedUrl } from './embedUrl'

describe('buildBuzzEmbedUrl', () => {
  test('builds embed URL with nostr auth and view', () => {
    const url = buildBuzzEmbedUrl({
      embedBase: 'https://buzz.terp.network',
      daoAddress: 'terp1dao',
      chainId: 'morocco-1',
      defaultView: 'public',
    })
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://buzz.terp.network')
    expect(parsed.pathname).toBe('/embed')
    expect(parsed.searchParams.get('dao')).toBe('terp1dao')
    expect(parsed.searchParams.get('chain')).toBe('morocco-1')
    expect(parsed.searchParams.get('view')).toBe('public')
    expect(parsed.searchParams.get('parent')).toBe('daodao')
    expect(parsed.searchParams.get('auth')).toBe('nostr')
  })

  test('supports event and admin views', () => {
    expect(
      new URL(
        buildBuzzEmbedUrl({
          embedBase: 'https://buzz.example',
          daoAddress: 'terp1x',
          chainId: 'morocco-1',
          defaultView: 'admin',
        })
      ).searchParams.get('view')
    ).toBe('admin')
  })

  test('strips trailing slash on embed base', () => {
    const url = buildBuzzEmbedUrl({
      embedBase: 'https://buzz.terp.network/',
      daoAddress: 'terp1dao',
      chainId: 'morocco-1',
      defaultView: 'event',
    })
    expect(url.startsWith('https://buzz.terp.network/embed?')).toBe(true)
    expect(new URL(url).searchParams.get('view')).toBe('event')
  })
})

describe('Buzz protocol isolation', () => {
  test('protocol constant is terp-buzz/v1', () => {
    expect(BUZZ_PROTOCOL_VERSION).toBe('terp-buzz/v1')
  })

  test('daoAttest message uses terp-buzz/v1 only (not bounties)', () => {
    const message = buildBuzzDaoAttestMessage({
      chainId: 'morocco-1',
      daoAddress: 'terp1dao',
      addr: 'terp1user',
      nonce: 'n1',
      purpose: 'room-gate',
      exp: 1700000000,
    })
    expect(message.startsWith(`${BUZZ_PROTOCOL_VERSION}/dao-attest`)).toBe(true)
    expect(message).not.toContain('terp-bounties')
    expect(message).not.toContain('terp-hermes')
    expect(message).toContain('purpose=room-gate')
  })
})
