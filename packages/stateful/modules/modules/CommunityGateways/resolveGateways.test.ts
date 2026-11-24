import { describe, expect, test } from 'vitest'

import {
  gatewaysFromMesh,
  normalizeGatewayEntry,
  partitionGateways,
  resolveGatewayDirectory,
} from './resolveGateways'

describe('normalizeGatewayEntry', () => {
  test('accepts https buzz entry', () => {
    const g = normalizeGatewayEntry({
      id: 'a',
      kind: 'buzz',
      label: 'Public',
      url: 'https://buzz.example/embed',
      visibility: 'public',
    })
    expect(g?.url).toBe('https://buzz.example/embed')
    expect(g?.kind).toBe('buzz')
  })

  test('rejects non-http', () => {
    expect(
      normalizeGatewayEntry({
        kind: 'hermes',
        url: 'ftp://nope',
        label: 'x',
      })
    ).toBeNull()
  })
})

describe('gatewaysFromMesh', () => {
  test('maps embeds + relays', () => {
    const rows = gatewaysFromMesh({
      v: 1,
      relays: ['wss://relay.example'],
      query: '',
      embeds: {
        buzz: 'https://buzz.example',
        hermes: 'https://hermes.example',
      },
    })
    expect(rows.some((r) => r.id === 'mesh-buzz-embed')).toBe(true)
    expect(rows.some((r) => r.id === 'mesh-hermes')).toBe(true)
    expect(rows.some((r) => r.relayWss === 'wss://relay.example')).toBe(true)
  })
})

describe('resolveGatewayDirectory', () => {
  test('merges curated over mesh without dupes', () => {
    const list = resolveGatewayDirectory({
      data: {
        useChainMeshDefault: true,
        meshJson: '',
        gateways: [
          {
            id: 'curated',
            kind: 'buzz',
            label: 'Curated',
            url: 'https://buzz.example',
            visibility: 'public',
          },
        ],
      },
      chainMeshJson: JSON.stringify({
        v: 1,
        relays: [],
        query: '',
        embeds: { buzz: 'https://buzz.example' },
      }),
    })
    const buzz = partitionGateways(list).buzz
    expect(buzz.filter((g) => g.url === 'https://buzz.example')).toHaveLength(1)
    expect(buzz[0].id).toBe('curated')
  })
})
