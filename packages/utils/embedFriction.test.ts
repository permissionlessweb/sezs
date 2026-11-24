import { describe, expect, test } from 'vitest'

import {
  LAB_BUZZ_RELAY_HTTP_ORIGIN,
  describeEmbedFriction,
  hasEmbedBase,
  httpOriginFromMaybeWsUrl,
  isNostrRelayRootAsEmbedBase,
  onlyBuzzRelayConfigured,
  pickBuzzEmbedShellBase,
} from './embedFriction'

describe('describeEmbedFriction', () => {
  test('EMBED_MISSING generic locks F0 copy key', () => {
    const d = describeEmbedFriction('EMBED_MISSING')
    expect(d.code).toBe('EMBED_MISSING')
    expect(d.messageKey).toBe('friction.EMBED_MISSING')
    expect(d.defaultMessage).toMatch(/No embed base URL/i)
    expect(d.defaultMessage).toMatch(/mesh\.v1 embeds/i)
  })

  test('EMBED_MISSING surface keys for bounties/buzz/hermes', () => {
    for (const surface of ['bounties', 'buzz', 'hermes'] as const) {
      const d = describeEmbedFriction('EMBED_MISSING', { surface })
      expect(d.code).toBe('EMBED_MISSING')
      expect(d.surface).toBe(surface)
      expect(d.messageKey).toBe(`friction.EMBED_MISSING.${surface}`)
      expect(d.defaultMessage).toMatch(new RegExp(surface, 'i'))
      expect(d.defaultMessage).toMatch(/mesh\.v1/)
    }
  })

  test('MESH_RESOLVE_FAILED locks key and optional detail', () => {
    const base = describeEmbedFriction('MESH_RESOLVE_FAILED')
    expect(base.code).toBe('MESH_RESOLVE_FAILED')
    expect(base.messageKey).toBe('friction.MESH_RESOLVE_FAILED')
    expect(base.defaultMessage).toMatch(/Could not resolve mesh\.v1/i)

    const withDetail = describeEmbedFriction('MESH_RESOLVE_FAILED', {
      detail: 'no sources available',
    })
    expect(withDetail.messageKey).toBe('friction.MESH_RESOLVE_FAILED')
    expect(withDetail.defaultMessage).toContain('no sources available')
  })

  test('DEEP_LINK_ONLY defaults surface hermes', () => {
    const d = describeEmbedFriction('DEEP_LINK_ONLY')
    expect(d.code).toBe('DEEP_LINK_ONLY')
    expect(d.messageKey).toBe('friction.DEEP_LINK_ONLY')
    expect(d.surface).toBe('hermes')
  })

  test('HOST_UNREACHABLE / ORIGIN_MISMATCH / LAB_ONLY stable keys', () => {
    expect(describeEmbedFriction('HOST_UNREACHABLE').messageKey).toBe(
      'friction.HOST_UNREACHABLE'
    )
    expect(
      describeEmbedFriction('ORIGIN_MISMATCH', { surface: 'buzz' }).messageKey
    ).toBe('friction.ORIGIN_MISMATCH.buzz')
    expect(describeEmbedFriction('LAB_ONLY').messageKey).toBe(
      'friction.LAB_ONLY'
    )
  })

  test('RELAY_NOT_EMBED locks soft-pending copy for collab', () => {
    const d = describeEmbedFriction('RELAY_NOT_EMBED', {
      surface: 'buzz',
      detail: 'http://localhost:3000',
    })
    expect(d.code).toBe('RELAY_NOT_EMBED')
    expect(d.surface).toBe('buzz')
    expect(d.messageKey).toBe('friction.RELAY_NOT_EMBED.buzz')
    expect(d.defaultMessage).toMatch(/relay root/i)
    expect(d.defaultMessage).toMatch(/embed shell/i)
    expect(d.defaultMessage).toContain('http://localhost:3000')
  })
})

describe('hasEmbedBase', () => {
  test('rejects empty / whitespace / nullish without inventing hosts', () => {
    expect(hasEmbedBase(undefined)).toBe(false)
    expect(hasEmbedBase(null)).toBe(false)
    expect(hasEmbedBase('')).toBe(false)
    expect(hasEmbedBase('   ')).toBe(false)
  })

  test('accepts non-empty configured base', () => {
    expect(hasEmbedBase('https://bounties.example')).toBe(true)
    expect(hasEmbedBase('  https://buzz.example/  ')).toBe(true)
  })
})

describe('isNostrRelayRootAsEmbedBase / pickBuzzEmbedShellBase', () => {
  test('lab dual-relay origin is never an iframe embed base', () => {
    expect(isNostrRelayRootAsEmbedBase(LAB_BUZZ_RELAY_HTTP_ORIGIN)).toBe(true)
    expect(
      isNostrRelayRootAsEmbedBase('http://localhost:3000/embed')
    ).toBe(true)
    expect(isNostrRelayRootAsEmbedBase('http://192.168.0.4:3001')).toBe(false)
    expect(isNostrRelayRootAsEmbedBase('https://buzz.terp.network')).toBe(
      false
    )
  })

  test('ws(s) known relay origins map to http(s) origin', () => {
    expect(httpOriginFromMaybeWsUrl('ws://localhost:3000')).toBe(
      'http://localhost:3000'
    )
    expect(
      isNostrRelayRootAsEmbedBase('http://relay.lab:7777', {
        knownRelayOrigins: ['ws://relay.lab:7777'],
      })
    ).toBe(true)
  })

  test('pickBuzzEmbedShellBase skips relay and prefers embed shell', () => {
    expect(
      pickBuzzEmbedShellBase([
        'http://localhost:3000',
        'http://192.168.0.4:3001',
      ])
    ).toBe('http://192.168.0.4:3001')
    expect(pickBuzzEmbedShellBase(['http://localhost:3000'])).toBe(
      undefined
    )
    expect(onlyBuzzRelayConfigured(['http://localhost:3000'])).toBe(true)
    expect(
      onlyBuzzRelayConfigured([
        'http://localhost:3000',
        'http://192.168.0.4:3001',
      ])
    ).toBe(false)
  })
})
