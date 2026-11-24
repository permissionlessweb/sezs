import { describe, expect, test } from 'vitest'

import { buildCollabEndpoints } from './collabEndpoints'

describe('buildCollabEndpoints', () => {
  test('empty when no mesh and no module', () => {
    const s = buildCollabEndpoints({})
    expect(s.publicEmpty).toBe(true)
    expect(s.privateEmpty).toBe(true)
    expect(s.publicCards).toEqual([])
    expect(s.privateCards).toEqual([])
  })

  test('module buzz overrides mesh', () => {
    const s = buildCollabEndpoints({
      mesh: {
        embeds: { buzz: 'https://mesh-buzz.example' },
        relays: [],
        source: 'dao_storage',
        warnings: [],
      },
      moduleBuzz: 'https://module-buzz.example',
    })
    expect(s.publicCards[0].url).toBe('https://module-buzz.example')
    expect(s.publicCards[0].sourceHint).toBe('module')
    expect(s.publicEmpty).toBe(false)
  })

  test('relays become public cards without inventing embeds', () => {
    const s = buildCollabEndpoints({
      mesh: {
        embeds: {},
        relays: ['wss://relay.example'],
        source: 'chain_default',
        warnings: ['mesh has no buzz embed — collab slot empty'],
      },
    })
    expect(s.publicCards).toHaveLength(1)
    expect(s.publicCards[0].kind).toBe('relay')
    expect(s.publicCards[0].relayWss).toBe('wss://relay.example')
    expect(s.privateEmpty).toBe(true)
  })

  test('hermes from mesh is private plane only', () => {
    const s = buildCollabEndpoints({
      mesh: {
        embeds: { hermes: 'https://hermes.example' },
        relays: [],
        source: 'module',
        warnings: [],
      },
    })
    expect(s.privateCards).toHaveLength(1)
    expect(s.privateCards[0].plane).toBe('private')
    expect(s.publicEmpty).toBe(true)
  })

  test('rejects non-http urls', () => {
    const s = buildCollabEndpoints({
      moduleBuzz: 'not-a-url',
      moduleHermes: 'ftp://bad.example',
    })
    expect(s.publicEmpty).toBe(true)
    expect(s.privateEmpty).toBe(true)
  })
})
