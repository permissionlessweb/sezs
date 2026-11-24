import { describe, expect, test } from 'vitest'

import {
  MESH_STORAGE_KEY,
  buildDefaultMeshDescriptor,
  createMeshQueryClient,
  httpsToWss,
  mergeMeshEmbeds,
  mergeMeshLayers,
  mergeMeshMarketplace,
  normalizeEmbedsBounties,
  parseMeshDescriptor,
  parseMeshEmbeds,
  parseMeshEventDefaults,
  parseMeshMarketplace,
  resolveMesh,
  serializeMeshDescriptor,
  MeshResolveError,
} from './mesh'

describe('mesh.v1 defaults + parse', () => {
  test('MESH_STORAGE_KEY is mesh.v1', () => {
    expect(MESH_STORAGE_KEY).toBe('mesh.v1')
  })

  test('httpsToWss converts origin', () => {
    expect(httpsToWss('https://headstash.terp.network')).toBe(
      'wss://headstash.terp.network'
    )
  })

  test('buildDefaultMeshDescriptor requires headstashServer', () => {
    expect(() => buildDefaultMeshDescriptor({})).toThrow(MeshResolveError)
  })

  test('buildDefaultMeshDescriptor fills relays + query + auth', () => {
    const d = buildDefaultMeshDescriptor({
      headstashServer: 'https://headstash.terp.network',
      headstashWss: 'wss://headstash.terp.network',
    })
    expect(d.v).toBe(1)
    expect(d.query).toBe('https://headstash.terp.network')
    expect(d.relays).toEqual(['wss://headstash.terp.network'])
    expect(d.auth?.default).toBe('pfpk')
  })

  test('parseMeshDescriptor round-trip', () => {
    const raw = serializeMeshDescriptor(
      buildDefaultMeshDescriptor(
        { headstashServer: 'https://headstash.terp.network' },
        { calendar: 'terp1calendar' }
      )
    )
    const p = parseMeshDescriptor(raw)
    expect(p.calendar).toBe('terp1calendar')
    expect(p.query).toBe('https://headstash.terp.network')
  })

  test('serializeMeshDescriptor preserves marketplace block', () => {
    const raw = serializeMeshDescriptor(
      buildDefaultMeshDescriptor(
        {
          headstashServer: 'https://headstash.terp.network',
          merkleServer: 'https://hash.terp.network',
        },
        {
          marketplace: {
            fixedPrice: 'terp1fp',
            auction: 'terp1auc',
            acceptedDenom: 'uterp',
            minBufferBlocks: 7,
            modes: ['fixed', 'auction'],
          },
        }
      )
    )
    const p = parseMeshDescriptor(raw)
    expect(p.marketplace?.fixedPrice).toBe('terp1fp')
    expect(p.marketplace?.auction).toBe('terp1auc')
    expect(p.marketplace?.contentBase).toBe('https://hash.terp.network')
    expect(p.marketplace?.acceptedDenom).toBe('uterp')
  })

  test('parse allows missing/empty query as chain-only soft empty', () => {
    // MVP open-lab: mesh.v1.query may be "" — schedule uses dao-calendar CW721 only.
    const missing = parseMeshDescriptor({ v: 1, relays: [] })
    expect(missing.query).toBe('')
    expect(missing.calendarAccess).toBe('chain')

    const empty = parseMeshDescriptor({ v: 1, relays: [], query: '' })
    expect(empty.query).toBe('')
    expect(empty.calendarAccess).toBe('chain')
  })

  test('parseMeshMarketplace + merge', () => {
    const m = parseMeshMarketplace({
      fixedPrice: 'terp1fixed',
      auction: 'terp1auction',
      contentBase: 'https://hash.terp.network/',
      minBufferBlocks: 7,
      modes: ['fixed', 'auction', 'buy_now', 'invalid'],
    })
    expect(m?.fixedPrice).toBe('terp1fixed')
    expect(m?.contentBase).toBe('https://hash.terp.network')
    expect(m?.modes).toEqual(['fixed', 'auction', 'buy_now'])

    const merged = mergeMeshMarketplace(m, { auction: 'terp1new', acceptedDenom: 'uterp' })
    expect(merged?.auction).toBe('terp1new')
    expect(merged?.fixedPrice).toBe('terp1fixed')
    expect(merged?.acceptedDenom).toBe('uterp')
  })

  test('parseMeshMarketplace nftCollections array + snake_case + merge union', () => {
    const m = parseMeshMarketplace({
      auction: 'terp1auc',
      nftCollections: ['terp1nftA', 'terp1nftB', 'terp1nftA'],
    })
    expect(m?.nftCollections).toEqual(['terp1nftA', 'terp1nftB'])

    const snake = parseMeshMarketplace({
      auction: 'terp1auc',
      nft_collections: 'terp1nftC, terp1nftA',
    })
    expect(snake?.nftCollections).toEqual(['terp1nftC', 'terp1nftA'])

    const merged = mergeMeshMarketplace(m, snake)
    expect(merged?.nftCollections).toEqual(['terp1nftC', 'terp1nftA', 'terp1nftB'])
  })

  test('parseMeshDescriptor keeps marketplace block', () => {
    const p = parseMeshDescriptor({
      v: 1,
      query: 'https://headstash.terp.network',
      relays: [],
      marketplace: {
        fixedPrice: 'terp1fp',
        contentBase: 'https://hash.terp.network',
        modes: ['fixed'],
      },
    })
    expect(p.marketplace?.fixedPrice).toBe('terp1fp')
    expect(p.marketplace?.modes).toEqual(['fixed'])
  })

  test('buildDefaultMeshDescriptor seeds marketplace contentBase from merkleServer', () => {
    const d = buildDefaultMeshDescriptor({
      headstashServer: 'https://headstash.terp.network',
      merkleServer: 'https://hash.terp.network',
    })
    expect(d.marketplace?.contentBase).toBe('https://hash.terp.network')
    expect(d.marketplace?.minBufferBlocks).toBe(7)
  })
})

describe('mergeMeshLayers', () => {
  test('higher layer wins calendar; relays union unless strict', () => {
    const base = buildDefaultMeshDescriptor({
      headstashServer: 'https://headstash.terp.network',
    })
    const dao = parseMeshDescriptor({
      v: 1,
      query: 'https://headstash.terp.network',
      relays: ['wss://custom.example'],
      calendar: 'terp1dao-cal',
      marketplace: { fixedPrice: 'terp1fp', modes: ['fixed'] },
    })
    const m = mergeMeshLayers(base, dao)
    expect(m.calendar).toBe('terp1dao-cal')
    expect(m.marketplace?.fixedPrice).toBe('terp1fp')
    expect(m.relays).toContain('wss://headstash.terp.network')
    expect(m.relays).toContain('wss://custom.example')
  })

  test('strictRelays replaces pool', () => {
    const base = buildDefaultMeshDescriptor({
      headstashServer: 'https://headstash.terp.network',
    })
    const m = mergeMeshLayers(base, {
      relays: ['wss://only.example'],
      strictRelays: true,
    })
    expect(m.relays).toEqual(['wss://only.example'])
  })
})

describe('resolveMesh', () => {
  const services = {
    headstashServer: 'https://headstash.terp.network',
    headstashWss: 'wss://headstash.terp.network',
  }

  test('falls back to chain default', async () => {
    const mesh = await resolveMesh({
      chainId: 'morocco-1',
      chainServices: services,
    })
    expect(mesh.source).toBe('chain_default')
    expect(mesh.query).toBe('https://headstash.terp.network')
    expect(mesh.warnings.some((w) => w.includes('calendar'))).toBe(true)
  })

  test('DAO storage wins over chain default', async () => {
    const mesh = await resolveMesh({
      chainId: 'morocco-1',
      chainServices: services,
      loaders: {
        getDaoStorageItem: async (key) => {
          expect(key).toBe(MESH_STORAGE_KEY)
          return serializeMeshDescriptor({
            v: 1,
            query: 'https://headstash.terp.network',
            relays: ['wss://headstash.terp.network'],
            calendar: 'terp1from-dao',
          })
        },
      },
    })
    expect(mesh.source).toBe('dao_storage')
    expect(mesh.calendar).toBe('terp1from-dao')
  })

  test('module calendarContract completes mesh from chain default', async () => {
    const mesh = await resolveMesh({
      chainId: 'morocco-1',
      chainServices: services,
      loaders: {
        getModuleValues: async () => ({
          calendarContract: 'terp1from-module',
        }),
      },
    })
    expect(mesh.calendar).toBe('terp1from-module')
    expect(mesh.query).toBe('https://headstash.terp.network')
  })

  test('module marketplace contracts merge into mesh.marketplace', async () => {
    const mesh = await resolveMesh({
      chainId: 'morocco-1',
      chainServices: {
        ...services,
        merkleServer: 'https://hash.terp.network',
      },
      loaders: {
        getModuleValues: async () => ({
          marketplaceFixedPrice: 'terp1fixed',
          marketplaceAuction: 'terp1auction',
          marketplaceAcceptedDenom: 'uterp',
          marketplaceMinBufferBlocks: 7,
        }),
      },
    })
    expect(mesh.marketplace?.fixedPrice).toBe('terp1fixed')
    expect(mesh.marketplace?.auction).toBe('terp1auction')
    expect(mesh.marketplace?.acceptedDenom).toBe('uterp')
    expect(mesh.marketplace?.contentBase).toBe('https://hash.terp.network')
    expect(mesh.marketplace?.modes).toEqual(['fixed', 'auction', 'buy_now'])
  })

  test('overrides win', async () => {
    const mesh = await resolveMesh({
      chainId: 'morocco-1',
      chainServices: services,
      overrides: {
        calendar: 'terp1override',
        query: 'https://other.example',
      },
    })
    expect(mesh.source).toBe('override')
    expect(mesh.calendar).toBe('terp1override')
    expect(mesh.query).toBe('https://other.example')
  })

  test('fails closed without layers or defaults', async () => {
    await expect(
      resolveMesh({
        chainId: 'unknown-chain',
        chainServices: {},
      })
    ).rejects.toBeInstanceOf(MeshResolveError)
  })
})

describe('createMeshQueryClient', () => {
  test('listEvents hits query plane path', async () => {
    const mesh = buildDefaultMeshDescriptor(
      { headstashServer: 'https://headstash.terp.network' },
      { calendar: 'terp1cal' }
    )
    let hit = ''
    const client = createMeshQueryClient(mesh, (async (url: RequestInfo) => {
      hit = String(url)
      return {
        ok: true,
        json: async () => ({ events: [] }),
      } as Response
    }) as typeof fetch)

    await client.listEvents({ limit: 5 })
    expect(hit).toContain(
      'https://headstash.terp.network/api/v1/calendar/events'
    )
    expect(hit).toContain('calendar=terp1cal')
    expect(await client.getCalendarAddress()).toBe('terp1cal')
  })
})

describe('U1 mesh.v1 Event Hub embeds + ceremony + eventDefaults', () => {
  const services = {
    headstashServer: 'https://headstash.terp.network',
    headstashWss: 'wss://headstash.terp.network',
  }

  test('P1: parse full Event Hub mesh', () => {
    const p = parseMeshDescriptor({
      v: 1,
      query: 'https://headstash.terp.network',
      relays: ['wss://headstash.terp.network'],
      ceremony: 'terp1ceremony',
      embeds: {
        bounties: 'https://bounties.example/embed',
        buzz: 'https://buzz.example/embed',
        hermes: 'https://ops.example/hermes/embed',
      },
      eventDefaults: {
        requireRegistration: true,
        buzzGate: 'dao-member',
        hermesVisibility: 'only-members',
        bountyView: 'event',
      },
    })
    expect(p.ceremony).toBe('terp1ceremony')
    expect(p.embeds?.bounties).toBe('https://bounties.example/embed')
    expect(p.embeds?.buzz).toBe('https://buzz.example/embed')
    expect(p.embeds?.hermes).toBe('https://ops.example/hermes/embed')
    expect(p.eventDefaults?.requireRegistration).toBe(true)
    expect(p.eventDefaults?.buzzGate).toBe('dao-member')
    expect(p.eventDefaults?.hermesVisibility).toBe('only-members')
    expect(p.eventDefaults?.bountyView).toBe('event')
  })

  test('P2: parse ignores empty embeds object', () => {
    const p = parseMeshDescriptor({
      v: 1,
      query: 'https://headstash.terp.network',
      relays: [],
      embeds: {},
    })
    expect(p.embeds).toBeUndefined()
  })

  test('P3: serialize omits empty ceremony/embeds', () => {
    const raw = serializeMeshDescriptor(
      buildDefaultMeshDescriptor(services, { calendar: 'terp1cal' })
    )
    const obj = JSON.parse(raw)
    expect(obj.ceremony).toBeUndefined()
    expect(obj.embeds).toBeUndefined()
    expect(obj.eventDefaults).toBeUndefined()
  })

  test('P4: parse v:"1" still ok', () => {
    const p = parseMeshDescriptor({
      v: '1',
      query: 'https://headstash.terp.network',
      relays: [],
      ceremony: 'terp1c',
    })
    expect(p.v).toBe(1)
    expect(p.ceremony).toBe('terp1c')
  })

  test('P5: invalid embed non-string drops key', () => {
    const embeds = parseMeshEmbeds({
      bounties: 123,
      buzz: 'https://buzz.example',
    })
    expect(embeds?.bounties).toBeUndefined()
    expect(embeds?.buzz).toBe('https://buzz.example')
  })

  test('P6: unknown buzzGate dropped', () => {
    const ed = parseMeshEventDefaults({
      buzzGate: 'not-a-gate',
      requireRegistration: true,
    })
    expect(ed?.buzzGate).toBeUndefined()
    expect(ed?.requireRegistration).toBe(true)
  })

  test('P7: legacy bounties.embedBase normalizes to embeds.bounties', () => {
    const p = parseMeshDescriptor({
      v: 1,
      query: 'https://headstash.terp.network',
      relays: [],
      bounties: { embedBase: 'https://bounties.legacy/embed', auth: 'adr36' },
    })
    expect(p.bounties?.embedBase).toBe('https://bounties.legacy/embed')
    expect(p.embeds?.bounties).toBe('https://bounties.legacy/embed')
  })

  test('M1–M4: ceremony + embeds resolve without inventing relays', async () => {
    const mesh = await resolveMesh({
      chainId: 'morocco-1',
      chainServices: {
        ...services,
        buzzEmbed: 'https://buzz.terp.network/embed',
      },
      loaders: {
        getDaoStorageItem: async () =>
          JSON.stringify({
            v: 1,
            query: 'https://headstash.terp.network',
            relays: ['wss://headstash.terp.network'],
            ceremony: 'terp1ceremony',
            embeds: {
              bounties: 'https://bounties.example/embed',
              hermes: 'https://ops.example/hermes/embed',
            },
            eventDefaults: {
              requireRegistration: true,
              buzzGate: 'dao-member',
              hermesVisibility: 'only-members',
            },
          }),
      },
    })
    expect(mesh.ceremony).toBe('terp1ceremony')
    expect(mesh.embeds?.bounties).toContain('bounties.example')
    expect(mesh.embeds?.buzz).toBe('https://buzz.terp.network/embed')
    expect(mesh.embeds?.hermes).toContain('ops.example')
    expect(mesh.relays).toEqual(['wss://headstash.terp.network'])
    expect(mesh.eventDefaults?.buzzGate).toBe('dao-member')
  })

  test('M5: bounties.embedBase without embeds.bounties normalizes', () => {
    const n = normalizeEmbedsBounties(undefined, {
      embedBase: 'https://bounties.only',
    })
    expect(n.embeds?.bounties).toBe('https://bounties.only')
  })

  test('M6: embeds.bounties fills bounties.embedBase reverse', () => {
    const n = normalizeEmbedsBounties(
      { bounties: 'https://bounties.from-embeds' },
      undefined
    )
    expect(n.bounties?.embedBase).toBe('https://bounties.from-embeds')
    expect(n.bounties?.apiBase).toBeUndefined()
  })

  test('M7: merge preserves marketplace when patching embeds', () => {
    const base = parseMeshDescriptor({
      v: 1,
      query: 'https://headstash.terp.network',
      relays: ['wss://headstash.terp.network'],
      marketplace: { fixedPrice: 'terp1fp', modes: ['fixed'] },
    })
    const merged = mergeMeshLayers(base, {
      embeds: { buzz: 'https://buzz.example/embed' },
      ceremony: 'terp1cer',
    })
    expect(merged.marketplace?.fixedPrice).toBe('terp1fp')
    expect(merged.ceremony).toBe('terp1cer')
    expect(merged.embeds?.buzz).toBe('https://buzz.example/embed')
  })

  test('M8: calendar re-serialize must not drop ceremony', () => {
    const full = parseMeshDescriptor({
      v: 1,
      query: 'https://headstash.terp.network',
      relays: ['wss://headstash.terp.network'],
      calendar: 'terp1cal',
      ceremony: 'terp1cer',
      embeds: { buzz: 'https://buzz.example' },
      marketplace: { fixedPrice: 'terp1fp' },
    })
    // Simulate calendar writer patching only calendar via merge
    const patched = mergeMeshLayers(full, { calendar: 'terp1cal-new' })
    const round = parseMeshDescriptor(serializeMeshDescriptor(patched))
    expect(round.calendar).toBe('terp1cal-new')
    expect(round.ceremony).toBe('terp1cer')
    expect(round.embeds?.buzz).toBe('https://buzz.example')
    expect(round.marketplace?.fixedPrice).toBe('terp1fp')
  })

  test('M9: requireRegistration without ceremony warns but resolves', async () => {
    const mesh = await resolveMesh({
      chainId: 'morocco-1',
      chainServices: services,
      loaders: {
        getDaoStorageItem: async () =>
          JSON.stringify({
            v: 1,
            query: 'https://headstash.terp.network',
            relays: ['wss://headstash.terp.network'],
            eventDefaults: { requireRegistration: true },
          }),
      },
    })
    expect(mesh.eventDefaults?.requireRegistration).toBe(true)
    expect(
      mesh.warnings.some((w) => w.includes('ceremony address missing'))
    ).toBe(true)
  })

  test('M10: chain buzzEmbed does not overwrite DAO embeds.buzz', async () => {
    const mesh = await resolveMesh({
      chainId: 'morocco-1',
      chainServices: {
        ...services,
        buzzEmbed: 'https://chain-buzz.example/embed',
      },
      loaders: {
        getDaoStorageItem: async () =>
          JSON.stringify({
            v: 1,
            query: 'https://headstash.terp.network',
            relays: ['wss://headstash.terp.network'],
            embeds: { buzz: 'https://dao-buzz.example/embed' },
          }),
      },
    })
    expect(mesh.embeds?.buzz).toBe('https://dao-buzz.example/embed')
  })

  test('M11: empty relays + custom query derives WSS from that query only', async () => {
    const mesh = await resolveMesh({
      chainId: 'morocco-1',
      chainServices: {},
      overrides: {
        v: 1,
        query: 'https://custom-query.example',
        relays: [],
      },
    })
    expect(mesh.relays).toEqual(['wss://custom-query.example'])
    expect(mesh.relays).not.toContain('wss://headstash.terp.network')
  })

  test('M12: fail closed with no layers', async () => {
    await expect(
      resolveMesh({ chainId: 'unknown', chainServices: {} })
    ).rejects.toBeInstanceOf(MeshResolveError)
  })

  test('module ceremonyContract + embed bases complete mesh', async () => {
    const mesh = await resolveMesh({
      chainId: 'morocco-1',
      chainServices: services,
      loaders: {
        getModuleValues: async () => ({
          ceremonyContract: 'terp1from-module-cer',
          embedBuzz: 'https://buzz.from-module',
          embedBounties: 'https://bounties.from-module',
        }),
      },
    })
    expect(mesh.ceremony).toBe('terp1from-module-cer')
    expect(mesh.embeds?.buzz).toBe('https://buzz.from-module')
    expect(mesh.embeds?.bounties).toBe('https://bounties.from-module')
    expect(mesh.relays).toEqual(['wss://headstash.terp.network'])
  })

  test('mergeMeshEmbeds later wins per key', () => {
    expect(
      mergeMeshEmbeds(
        { bounties: 'https://a', buzz: 'https://b' },
        { buzz: 'https://c' }
      )
    ).toEqual({ bounties: 'https://a', buzz: 'https://c', hermes: undefined })
  })

  test('serialize + parse ceremony/embeds/eventDefaults round-trip', () => {
    const raw = serializeMeshDescriptor({
      v: 1,
      query: 'https://headstash.terp.network',
      relays: ['wss://headstash.terp.network'],
      ceremony: 'terp1cer',
      embeds: { hermes: 'https://ops.example' },
      eventDefaults: { buzzGate: 'public' },
    })
    const p = parseMeshDescriptor(raw)
    expect(p.ceremony).toBe('terp1cer')
    expect(p.embeds?.hermes).toBe('https://ops.example')
    expect(p.eventDefaults?.buzzGate).toBe('public')
  })
})
