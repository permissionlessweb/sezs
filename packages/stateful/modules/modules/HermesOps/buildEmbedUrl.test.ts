import { describe, expect, test } from 'vitest'

import { HERMES_PROTOCOL_VERSION } from './constants'
import {
  buildHermesOpsEmbedUrl,
  resolveHermesShellMode,
  shouldUseDeepLinkOnly,
} from './embedUrl'

describe('buildHermesOpsEmbedUrl', () => {
  test('builds /hermes/embed with member-gate auth', () => {
    const url = buildHermesOpsEmbedUrl({
      embedBase: 'https://ops.terp.network',
      daoAddress: 'terp1dao',
      chainId: 'morocco-1',
      defaultView: 'kanban',
    })
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://ops.terp.network')
    expect(parsed.pathname).toBe('/hermes/embed')
    expect(parsed.searchParams.get('dao')).toBe('terp1dao')
    expect(parsed.searchParams.get('chain')).toBe('morocco-1')
    expect(parsed.searchParams.get('view')).toBe('kanban')
    expect(parsed.searchParams.get('parent')).toBe('daodao')
    expect(parsed.searchParams.get('auth')).toBe('member-gate')
  })

  test('does not double /hermes when base already ends with it', () => {
    const url = buildHermesOpsEmbedUrl({
      embedBase: 'https://ops.terp.network/hermes',
      daoAddress: 'terp1dao',
      chainId: 'morocco-1',
      defaultView: 'status',
    })
    expect(new URL(url).pathname).toBe('/hermes/embed')
    expect(new URL(url).searchParams.get('view')).toBe('status')
  })

  test('optional boardSlug for CommunityInfra / EventHub deep-bridge', () => {
    const url = buildHermesOpsEmbedUrl({
      embedBase: 'https://ops.terp.network',
      daoAddress: 'terp1dao',
      chainId: '120u-1',
      defaultView: 'kanban',
      boardSlug: 'community-gateway',
    })
    expect(new URL(url).searchParams.get('board')).toBe('community-gateway')
  })
})

describe('resolveHermesShellMode / shouldUseDeepLinkOnly', () => {
  test('deepLinkOnly flag → deep_link_only (default-safe)', () => {
    expect(
      resolveHermesShellMode({
        deepLinkOnly: true,
        embedOrigin: 'https://ops.terp.network',
      })
    ).toBe('deep_link_only')
    expect(
      shouldUseDeepLinkOnly({
        deepLinkOnly: true,
        embedOrigin: 'https://ops.terp.network',
      })
    ).toBe(true)
  })

  test('missing origin with deepLinkOnly false → embed_missing', () => {
    expect(
      resolveHermesShellMode({ deepLinkOnly: false, embedOrigin: '' })
    ).toBe('embed_missing')
    expect(
      shouldUseDeepLinkOnly({ deepLinkOnly: false, embedOrigin: '' })
    ).toBe(true)
  })

  test('iframe when embed ready and deepLinkOnly false', () => {
    expect(
      resolveHermesShellMode({
        deepLinkOnly: false,
        embedOrigin: 'https://ops.terp.network',
      })
    ).toBe('iframe')
    expect(
      shouldUseDeepLinkOnly({
        deepLinkOnly: false,
        embedOrigin: 'https://ops.terp.network',
      })
    ).toBe(false)
  })
})

describe('HermesOps protocol isolation', () => {
  test('protocol is terp-hermes/v1 (not bounties or buzz)', () => {
    expect(HERMES_PROTOCOL_VERSION).toBe('terp-hermes/v1')
    expect(HERMES_PROTOCOL_VERSION).not.toContain('bounties')
    expect(HERMES_PROTOCOL_VERSION).not.toContain('buzz')
    expect(HERMES_PROTOCOL_VERSION).not.toBe('terp-hermes-ops/v1')
  })
})
