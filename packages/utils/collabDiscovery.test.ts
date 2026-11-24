import { describe, expect, test } from 'vitest'

import {
  COLLAB_DISCOVERY_APP,
  COLLAB_DISCOVERY_KIND,
  COLLAB_DISCOVERY_RECORD_KEY,
  buildCollabDiscoveryEvent,
  buildCollabDiscoveryFilters,
  isCollabDiscoveryPayload,
  parseCollabDiscoveryContent,
} from './collabDiscovery'
import { MeshDescriptorV1 } from './mesh'

const sampleMesh = (): MeshDescriptorV1 => ({
  v: 1,
  relays: ['wss://relay.example/buzz'],
  query: 'https://headstash.example',
  embeds: {
    buzz: 'https://buzz.example/embed',
    hermes: 'https://hermes.example',
  },
})

describe('collabDiscovery', () => {
  test('kind and record key locked', () => {
    expect(COLLAB_DISCOVERY_KIND).toBe(30078)
    expect(COLLAB_DISCOVERY_RECORD_KEY).toBe('mesh.v1')
    expect(COLLAB_DISCOVERY_APP).toBe('terp-collab-ops/v1')
  })

  test('buildCollabDiscoveryEvent content is mesh.v1 JSON', () => {
    const draft = buildCollabDiscoveryEvent({
      mesh: sampleMesh(),
      dao: 'terp1dao',
      chainId: '120u-1',
      createdAt: 1_700_000_000,
    })
    expect(draft.kind).toBe(30078)
    expect(draft.created_at).toBe(1_700_000_000)
    const mesh = parseCollabDiscoveryContent(draft.content)
    expect(mesh.embeds?.buzz).toBe('https://buzz.example/embed')
    expect(mesh.embeds?.hermes).toBe('https://hermes.example')
    expect(mesh.relays).toContain('wss://relay.example/buzz')
    expect(draft.tags.some((t) => t[0] === 'dao' && t[1] === 'terp1dao')).toBe(
      true
    )
    expect(
      draft.tags.some((t) => t[0] === 'chain_id' && t[1] === '120u-1')
    ).toBe(true)
    expect(draft.tags.some((t) => t[0] === 'plane' && t[1] === 'public:buzz')).toBe(
      true
    )
    expect(
      draft.tags.some((t) => t[0] === 'plane' && t[1] === 'private:hermes')
    ).toBe(true)
  })

  test('round-trip content is valid discovery payload', () => {
    const draft = buildCollabDiscoveryEvent({ mesh: sampleMesh() })
    expect(isCollabDiscoveryPayload(draft.content)).toBe(true)
    expect(isCollabDiscoveryPayload('{not json')).toBe(false)
    expect(isCollabDiscoveryPayload('{}')).toBe(false)
  })

  test('filters target kind 30078 + app tags', () => {
    const f = buildCollabDiscoveryFilters({ dao: 'terp1dao', limit: 5 })
    expect(f).toHaveLength(1)
    expect(f[0].kinds).toEqual([30078])
    expect(f[0].limit).toBe(5)
    expect(f[0]['#d']).toEqual([COLLAB_DISCOVERY_APP])
    expect(f[0]['#t']).toContain('mesh.v1')
    expect(f[0]['#t']).toContain('terp1dao')
  })
})
