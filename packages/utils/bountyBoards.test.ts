import { describe, expect, test } from 'vitest'

import {
  BOUNTY_BOARD_DAO_DEFAULT_ID,
  buildBountiesBoardEmbedUrl,
  curateMeshBountyBoardRecord,
  listBountyBoardTabs,
  resolveSelectedBountyBoardTab,
  slugifyBountyBoardKey,
  upsertMeshBountyBoard,
} from './bountyBoards'
import {
  MeshDescriptorV1,
  parseMeshBounties,
  parseMeshDescriptor,
  serializeMeshDescriptor,
} from './mesh'

const baseMesh = (): MeshDescriptorV1 =>
  parseMeshDescriptor({
    v: 1,
    relays: ['wss://relay.example'],
    query: 'https://query.example',
  })

describe('bountyBoards (EN-F6)', () => {
  test('slugifyBountyBoardKey', () => {
    expect(slugifyBountyBoardKey('Hack Night 2026!')).toBe('hack-night-2026')
    expect(slugifyBountyBoardKey('   ')).toBe('event')
  })

  test('parseMeshBounties keeps boards[]', () => {
    const b = parseMeshBounties({
      embedBase: 'https://bounties.example',
      boards: [
        { eventId: 'e1', title: 'Hack' },
        { event_id: 'e2', title: 'Alt' },
        { eventId: '' },
        { eventId: 'e1', title: 'dup ignored' },
      ],
    })
    expect(b?.boards).toHaveLength(2)
    expect(b?.boards?.[0]).toMatchObject({ eventId: 'e1', title: 'Hack' })
    expect(b?.boards?.[1]?.eventId).toBe('e2')
  })

  test('upsertMeshBountyBoard merges by eventId', () => {
    let mesh = upsertMeshBountyBoard(baseMesh(), {
      eventId: '42',
      title: 'First',
    })
    mesh = upsertMeshBountyBoard(mesh, {
      eventId: '42',
      title: 'Updated',
      slug: 'first',
    })
    mesh = upsertMeshBountyBoard(mesh, {
      eventId: '99',
      title: 'Other',
    })
    expect(mesh.bounties?.boards).toHaveLength(2)
    expect(mesh.bounties?.boards?.find((x) => x.eventId === '42')?.title).toBe(
      'Updated'
    )
    const round = parseMeshDescriptor(serializeMeshDescriptor(mesh))
    expect(round.bounties?.boards).toHaveLength(2)
  })

  test('listBountyBoardTabs always leads with DAO default', () => {
    const tabs = listBountyBoardTabs(
      [
        { eventId: 'e1', title: 'Night' },
        { eventId: 'e2' },
      ],
      { daoLabel: 'All boards' }
    )
    expect(tabs[0]).toMatchObject({
      id: BOUNTY_BOARD_DAO_DEFAULT_ID,
      label: 'All boards',
      source: 'dao',
    })
    expect(tabs).toHaveLength(3)
    expect(tabs[1].eventId).toBe('e1')
    expect(tabs[2].label).toBe('e2')
  })

  test('buildBountiesBoardEmbedUrl cites EN-B1 query shape', () => {
    const url = buildBountiesBoardEmbedUrl({
      embedBase: 'https://bounties.terp.network/',
      daoAddress: 'terp1dao',
      chainId: 'morocco-1',
      defaultView: 'members',
      eventId: 'evt-9',
      eventSlug: 'hack',
    })
    const u = new URL(url)
    expect(u.pathname).toBe('/embed')
    expect(u.searchParams.get('dao')).toBe('terp1dao')
    expect(u.searchParams.get('chain')).toBe('morocco-1')
    expect(u.searchParams.get('view')).toBe('members')
    expect(u.searchParams.get('parent')).toBe('daodao')
    expect(u.searchParams.get('auth')).toBe('adr36')
    expect(u.searchParams.get('eventId')).toBe('evt-9')
    expect(u.searchParams.get('event')).toBe('hack')
    // Soft-gate: unmapped ceremony → registrationMapped=0
    expect(u.searchParams.get('registrationMapped')).toBe('0')
    expect(u.searchParams.get('ceremony')).toBeNull()
  })

  test('buildBountiesBoardEmbedUrl maps ceremony + registrationMapped', () => {
    const url = buildBountiesBoardEmbedUrl({
      embedBase: 'https://bounties.example',
      daoAddress: 'terp1dao',
      chainId: '120u-1',
      defaultView: 'public',
      eventId: 'lab-demo',
      ceremonyContract: 'terp1ceremonylab',
      sessionId: 'lab-demo',
      registrationMapped: true,
    })
    const u = new URL(url)
    expect(u.searchParams.get('ceremony')).toBe('terp1ceremonylab')
    expect(u.searchParams.get('sessionId')).toBe('lab-demo')
    expect(u.searchParams.get('registrationMapped')).toBe('1')
  })

  /**
   * EH-REG-4 matrix: event board deep-links must carry ceremony params when
   * mapped; unmapped event boards stay registrationMapped=0 (no orphan OPEN).
   */
  test('event board matrix: unmapped vs mapped registration params', () => {
    const base = {
      embedBase: 'https://bounties.example',
      daoAddress: 'terp1dao',
      chainId: '120u-1',
      defaultView: 'members' as const,
    }

    // Unmapped event board (registration path pending)
    const unmapped = new URL(
      buildBountiesBoardEmbedUrl({
        ...base,
        eventId: 'lab-demo',
        eventSlug: 'lab-demo',
        ceremonyContract: '',
        registrationMapped: false,
      })
    )
    expect(unmapped.searchParams.get('eventId')).toBe('lab-demo')
    expect(unmapped.searchParams.get('registrationMapped')).toBe('0')
    expect(unmapped.searchParams.get('ceremony')).toBeNull()
    expect(unmapped.searchParams.get('sessionId')).toBeNull()

    // Mapped event board (OPEN registration path + capacity params)
    const mapped = new URL(
      buildBountiesBoardEmbedUrl({
        ...base,
        eventId: 'lab-demo',
        ceremonyContract: 'terp1ceremonylab',
        sessionId: 'lab-demo',
        registrationMapped: true,
      })
    )
    expect(mapped.searchParams.get('eventId')).toBe('lab-demo')
    expect(mapped.searchParams.get('ceremony')).toBe('terp1ceremonylab')
    expect(mapped.searchParams.get('sessionId')).toBe('lab-demo')
    expect(mapped.searchParams.get('registrationMapped')).toBe('1')

    // Explicit registrationMapped=false even if ceremony string present
    // (gate closed for other reasons — never invent OPEN)
    const forced = new URL(
      buildBountiesBoardEmbedUrl({
        ...base,
        eventId: 'evt-x',
        ceremonyContract: 'terp1cer',
        registrationMapped: false,
      })
    )
    expect(forced.searchParams.get('registrationMapped')).toBe('0')
    expect(forced.searchParams.get('ceremony')).toBe('terp1cer')
  })

  test('DAO default tab omits eventId query', () => {
    const url = buildBountiesBoardEmbedUrl({
      embedBase: 'https://bounties.example',
      daoAddress: 'terp1dao',
      chainId: '120u-1',
      defaultView: 'public',
      eventId: BOUNTY_BOARD_DAO_DEFAULT_ID,
    })
    expect(new URL(url).searchParams.get('eventId')).toBeNull()
  })

  test('resolveSelectedBountyBoardTab falls back', () => {
    const tabs = listBountyBoardTabs([{ eventId: 'a', title: 'A' }])
    expect(resolveSelectedBountyBoardTab(tabs, 'a').id).toBe('a')
    expect(resolveSelectedBountyBoardTab(tabs, 'missing').id).toBe(
      BOUNTY_BOARD_DAO_DEFAULT_ID
    )
  })

  test('curateMeshBountyBoardRecord preserves siblings', () => {
    const existing = serializeMeshDescriptor({
      ...baseMesh(),
      embeds: { buzz: 'https://buzz.example' },
      marketplace: { fixedPrice: 'terp1mkt' },
    })
    const raw = curateMeshBountyBoardRecord({
      chainServices: {},
      board: { eventId: 'new-evt', title: 'New' },
      meshJson: existing,
    })
    const p = parseMeshDescriptor(raw)
    expect(p.embeds?.buzz).toBe('https://buzz.example')
    expect(p.marketplace?.fixedPrice).toBe('terp1mkt')
    expect(p.bounties?.boards?.[0]?.eventId).toBe('new-evt')
  })
})
