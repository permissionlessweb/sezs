import { describe, expect, test } from 'vitest'

import {
  DAO_COLLAB_DISCOVERY_KIND,
  DAO_MESH_RECORD_KEY,
  DAO_NIP15_KIND_TABLE,
  curateMarketplaceWasmMsg,
  curateMeshCollabRecord,
  curateMeshMarketplaceRecord,
  curateNip15FilterHeuristic,
  daoRecordActionCollab,
  daoRecordActionMesh,
} from './daoNipRecords'
import { parseMeshDescriptor } from './mesh'

const services = {
  headstashServer: 'https://headstash.terp.network',
  headstashWss: 'wss://headstash.terp.network',
  merkleServer: 'https://hash.terp.network',
}

describe('daoNipRecords / mesh curator', () => {
  test('record key is mesh.v1', () => {
    expect(DAO_MESH_RECORD_KEY).toBe('mesh.v1')
  })

  test('curateMeshMarketplaceRecord produces parseable mesh.v1', () => {
    const raw = curateMeshMarketplaceRecord({
      chainServices: services,
      fixedPrice: 'terp1fp',
      auction: 'terp1auc',
      acceptedDenom: 'uterp',
      minBufferBlocks: 7,
    })
    const m = parseMeshDescriptor(raw)
    expect(m.query).toBe('https://headstash.terp.network')
    expect(m.marketplace?.fixedPrice).toBe('terp1fp')
    expect(m.marketplace?.auction).toBe('terp1auc')
    expect(m.marketplace?.minBufferBlocks).toBe(7)
  })

  test('daoRecordActionMesh returns key+value+filters', () => {
    const rec = daoRecordActionMesh({
      chainServices: services,
      fixedPrice: 'terp1fp',
      dao: 'terp1dao',
    })
    expect(rec.key).toBe('mesh.v1')
    expect(rec.value.length).toBeGreaterThan(10)
    expect(rec.nostrFilters?.length).toBeGreaterThan(0)
  })

  test('NIP-15 kinds locked', () => {
    expect(DAO_NIP15_KIND_TABLE.product).toBe(30018)
    expect(DAO_NIP15_KIND_TABLE.auctionProduct).toBe(30020)
    expect(DAO_NIP15_KIND_TABLE.bid).toBe(1021)
  })

  test('wasm msg heuristics', () => {
    expect(curateMarketplaceWasmMsg({ type: 'place_bid', auctionId: 3 })).toEqual({
      place_bid: { auction_id: '3' },
    })
    expect(
      curateMarketplaceWasmMsg({ type: 'purchase', sku: 'GL-LTD-001', qty: 2 })
    ).toEqual({ purchase: { sku: 'GL-LTD-001', qty: 2 } })
  })

  test('nip15 filter heuristic auction', () => {
    const f = curateNip15FilterHeuristic({ mode: 'auction', dao: 'terp1dao' })
    expect(f[0].kinds).toContain(30020)
  })

  test('calendar-only curator sets calendar via same mesh.v1 path', () => {
    const raw = curateMeshMarketplaceRecord({
      chainServices: services,
      calendar: 'terp1calendar',
    })
    const m = parseMeshDescriptor(raw)
    expect(m.calendar).toBe('terp1calendar')
    expect(m.query).toBe('https://headstash.terp.network')
    // Chain defaults may seed contentBase marketplace; curator must not force
    // empty fixedPrice/auction contracts on calendar-only enable.
    expect(m.marketplace?.fixedPrice).toBeUndefined()
    expect(m.marketplace?.auction).toBeUndefined()
  })

  test('curateMeshCollabRecord merges embeds into mesh.v1', () => {
    const raw = curateMeshCollabRecord({
      chainServices: services,
      embedBuzz: 'https://buzz.example/embed',
      embedHermes: 'https://hermes.example',
    })
    const m = parseMeshDescriptor(raw)
    expect(m.embeds?.buzz).toBe('https://buzz.example/embed')
    expect(m.embeds?.hermes).toBe('https://hermes.example')
    expect(m.query).toBe('https://headstash.terp.network')
  })

  test('daoRecordActionCollab returns mesh.v1 + discovery filters', () => {
    const rec = daoRecordActionCollab({
      chainServices: services,
      embedBuzz: 'https://buzz.example',
      dao: 'terp1dao',
    })
    expect(rec.key).toBe('mesh.v1')
    expect(DAO_COLLAB_DISCOVERY_KIND).toBe(30078)
    expect(rec.nostrFilters?.[0]?.kinds).toContain(30078)
  })
})
