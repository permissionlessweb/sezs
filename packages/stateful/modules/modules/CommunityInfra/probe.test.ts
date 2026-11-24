import { describe, expect, it } from 'vitest'

import {
  DEFAULT_COMMUNITY_INFRA_VALUES,
  LAB_IMAGE_DIGEST_CATALOG,
} from './constants'
import {
  buildComponentRows,
  buildResolvedInstances,
  resolveInstances,
} from './probe'

describe('CommunityInfra buildComponentRows', () => {
  it('seeds at least 4 roles from ENDPOINTS-SSOT lab defaults', () => {
    const rows = buildComponentRows(DEFAULT_COMMUNITY_INFRA_VALUES)
    expect(rows.length).toBeGreaterThanOrEqual(4)
    const roles = new Set(rows.map((r) => r.role))
    expect(roles.has('chain_rpc')).toBe(true)
    expect(roles.has('chain_lcd')).toBe(true)
    expect(roles.has('faucet')).toBe(true)
    // buzz lives on collab-mesh instance; buzz_dual on lab-local
    expect(roles.has('buzz') || roles.has('buzz_dual')).toBe(true)
    expect(roles.has('hermes_board')).toBe(true)
  })

  it('applies buzz override and keeps hermes board canary without HTTP invent', () => {
    const rows = buildComponentRows({
      ...DEFAULT_COMMUNITY_INFRA_VALUES,
      buzzCanonicalUrl: 'http://example.test:3000',
      hermesDeepLinkUrl: 'https://ops.example/dao',
    })
    const buzz = rows.find((r) => r.role === 'buzz')
    expect(buzz?.url).toBe('http://example.test:3000')
    const hermes = rows.find((r) => r.role === 'hermes_board')
    expect(hermes?.health).toBe('canary')
    expect(hermes?.url).toContain('ops.example')
  })

  it('does not invent secrets in row urls', () => {
    const rows = buildComponentRows(DEFAULT_COMMUNITY_INFRA_VALUES)
    for (const r of rows) {
      expect(r.url.toLowerCase()).not.toMatch(/token|secret|password|apikey/)
    }
  })
})

describe('CommunityInfra M2 multi-instance + digests', () => {
  it('resolves default multi-instance lab-local + collab-mesh', () => {
    const instances = resolveInstances(DEFAULT_COMMUNITY_INFRA_VALUES)
    expect(instances.length).toBe(2)
    expect(instances.map((i) => i.id).sort()).toEqual([
      'collab-mesh',
      'lab-local',
    ])
    expect(instances.find((i) => i.id === 'lab-local')?.location).toBe('local')
    expect(instances.find((i) => i.id === 'collab-mesh')?.location).toBe(
      'mesh'
    )
  })

  it('buildResolvedInstances tags location and instance ids on rows', () => {
    const resolved = buildResolvedInstances(DEFAULT_COMMUNITY_INFRA_VALUES)
    expect(resolved.length).toBe(2)
    for (const inst of resolved) {
      expect(inst.location === 'local' || inst.location === 'mesh').toBe(true)
      for (const row of inst.rows) {
        expect(row.instanceId).toBe(inst.id)
        expect(row.instanceLabel).toBe(inst.label)
      }
    }
    const localRoles = new Set(
      resolved.find((i) => i.id === 'lab-local')!.rows.map((r) => r.role)
    )
    expect(localRoles.has('chain_rpc')).toBe(true)
    expect(localRoles.has('buzz_dual')).toBe(true)
    const meshRoles = new Set(
      resolved.find((i) => i.id === 'collab-mesh')!.rows.map((r) => r.role)
    )
    expect(meshRoles.has('buzz')).toBe(true)
  })

  it('attaches LAB-IMAGE-DIGESTS pins when useLabImageDigests is true', () => {
    const rows = buildComponentRows({
      ...DEFAULT_COMMUNITY_INFRA_VALUES,
      useLabImageDigests: true,
    })
    const chain = rows.find((r) => r.role === 'chain_rpc')
    expect(chain?.digest?.path).toBe('lab/localterp')
    expect(chain?.digest?.digest).toBe(
      LAB_IMAGE_DIGEST_CATALOG.localterp.digest
    )
    const buzz = rows.find((r) => r.role === 'buzz' || r.role === 'buzz_dual')
    expect(buzz?.digest?.path).toBe('lab/buzz-lab')
    expect(buzz?.digest?.source).toBe('LAB-IMAGE-DIGESTS')
  })

  it('omits digests when useLabImageDigests is false', () => {
    const rows = buildComponentRows({
      ...DEFAULT_COMMUNITY_INFRA_VALUES,
      useLabImageDigests: false,
    })
    const chain = rows.find((r) => r.role === 'chain_rpc')
    expect(chain?.digest).toBeUndefined()
  })

  it('honors explicit instances array', () => {
    const rows = buildComponentRows({
      ...DEFAULT_COMMUNITY_INFRA_VALUES,
      instances: [
        {
          id: 'akash-a',
          label: 'scheduled akash residual',
          location: 'akash',
          seedProfile: 'custom',
          useEndpointsSsotDefaults: false,
          buzzCanonicalUrl: 'https://example.akash/buzz',
        },
      ],
    })
    expect(rows.every((r) => r.instanceId === 'akash-a')).toBe(true)
    const buzz = rows.find((r) => r.role === 'buzz')
    expect(buzz?.url).toBe('https://example.akash/buzz')
    expect(buzz?.location).toBe('akash')
  })
})
