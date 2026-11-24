/**
 * Multi bounty boards (EN-F6) — mesh.v1.bounties.boards registry + embed tabs.
 *
 * Canonical storage/text-record key remains **mesh.v1** (never a parallel key).
 * Board scope for zec-bounties is still `daoAddress` + `chainId`; `eventId` is
 * a deep-link filter on the embed (`?eventId=`), matching Event Hub Work slot.
 *
 * EN-B1 API path (register/apply/submit) is unchanged:
 *   POST /api/bounties/apply · POST /api/bounties/:id/submit · auth=adr36
 */

import {
  ChainMeshServices,
  MeshBountiesV1,
  MeshBountyBoardV1,
  MeshDescriptorV1,
  buildDefaultMeshDescriptor,
  mergeMeshBounties,
  parseMeshDescriptor,
  serializeMeshDescriptor,
} from './mesh'

/** Sentinel tab id for the DAO-wide (no eventId) board. */
export const BOUNTY_BOARD_DAO_DEFAULT_ID = '__dao__' as const

export type BountyBoardTab = {
  /** Tab key: BOUNTY_BOARD_DAO_DEFAULT_ID or mesh board eventId. */
  id: string
  label: string
  /** When set, embed gets ?eventId= */
  eventId?: string
  slug?: string
  source: 'dao' | 'mesh'
}

/**
 * Slugify a title for provisional event/board keys when calendar id is unknown.
 */
export const slugifyBountyBoardKey = (title: string): string => {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return s || 'event'
}

/**
 * Upsert one board into mesh.v1.bounties.boards (read-merge-write safe).
 */
export const upsertMeshBountyBoard = (
  mesh: MeshDescriptorV1,
  board: MeshBountyBoardV1
): MeshDescriptorV1 => {
  const eventId = board.eventId?.trim()
  if (!eventId) return mesh
  const nextBoard: MeshBountyBoardV1 = {
    eventId,
    ...(board.title?.trim() ? { title: board.title.trim() } : {}),
    ...(board.slug?.trim() ? { slug: board.slug.trim() } : {}),
    ...(board.createdAt?.trim()
      ? { createdAt: board.createdAt.trim() }
      : { createdAt: new Date().toISOString() }),
  }
  const bounties: MeshBountiesV1 = mergeMeshBounties(mesh.bounties, {
    boards: [nextBoard],
  }) || { boards: [nextBoard] }
  return {
    ...mesh,
    bounties,
  }
}

/**
 * Curate mesh.v1 JSON with a bounty board upsert for set_item / text-record.
 * Prefer existing mesh JSON; else chain defaults; else minimal empty query mesh
 * so board registration never invents relays/hosts.
 */
export const curateMeshBountyBoardRecord = ({
  chainServices,
  board,
  meshJson,
}: {
  chainServices: ChainMeshServices
  board: MeshBountyBoardV1
  meshJson?: string | null
}): string => {
  if (meshJson?.trim()) {
    try {
      const parsed = parseMeshDescriptor(meshJson)
      return serializeMeshDescriptor(upsertMeshBountyBoard(parsed, board))
    } catch {
      /* fall through */
    }
  }
  try {
    const base = buildDefaultMeshDescriptor(chainServices)
    return serializeMeshDescriptor(upsertMeshBountyBoard(base, board))
  } catch {
    const minimal: MeshDescriptorV1 = {
      v: 1,
      relays: [],
      query: '',
    }
    return serializeMeshDescriptor(upsertMeshBountyBoard(minimal, board))
  }
}

/**
 * Build tab list: always DAO default first, then mesh boards (stable order).
 */
export const listBountyBoardTabs = (
  boards?: MeshBountyBoardV1[] | null,
  opts?: { daoLabel?: string }
): BountyBoardTab[] => {
  const tabs: BountyBoardTab[] = [
    {
      id: BOUNTY_BOARD_DAO_DEFAULT_ID,
      label: opts?.daoLabel?.trim() || 'All DAO',
      source: 'dao',
    },
  ]
  for (const b of boards ?? []) {
    if (!b.eventId?.trim()) continue
    if (b.eventId === BOUNTY_BOARD_DAO_DEFAULT_ID) continue
    tabs.push({
      id: b.eventId,
      label: b.title?.trim() || b.slug?.trim() || b.eventId,
      eventId: b.eventId,
      slug: b.slug,
      source: 'mesh',
    })
  }
  return tabs
}

/**
 * Build embed URL for a selected board tab.
 * Base shape (EN-B1 / design B3):
 * `{embedBase}/embed?dao=&chain=&view=&parent=daodao&auth=adr36[&eventId=][&event=]`
 * Registration soft-gate (EH-REG / t_21a7b53c):
 * optional `ceremony`, `sessionId`, `registrationMapped=0|1` for child boards.
 */
export const buildBountiesBoardEmbedUrl = ({
  embedBase,
  daoAddress,
  chainId,
  defaultView,
  eventId,
  eventSlug,
  ceremonyContract,
  sessionId,
  registrationMapped,
}: {
  embedBase: string
  daoAddress: string
  chainId: string
  defaultView: 'public' | 'members'
  eventId?: string | null
  eventSlug?: string | null
  /** cw-vote-ceremony (or lab registration) contract when mapped. */
  ceremonyContract?: string | null
  /** OD-session-map session_id when resolved. */
  sessionId?: string | null
  /**
   * Explicit mapped flag. When omitted, derived as true only if ceremony is
   * non-empty (soft-gate allowOpenRegistrationBounty).
   */
  registrationMapped?: boolean | null
}): string => {
  const base = embedBase.replace(/\/$/, '')
  const url = new URL(`${base}/embed`)
  url.searchParams.set('dao', daoAddress)
  url.searchParams.set('chain', chainId)
  url.searchParams.set('view', defaultView)
  url.searchParams.set('parent', 'daodao')
  url.searchParams.set('auth', 'adr36')
  const eid = eventId?.trim()
  if (eid && eid !== BOUNTY_BOARD_DAO_DEFAULT_ID) {
    url.searchParams.set('eventId', eid)
  }
  const slug = eventSlug?.trim()
  if (slug) {
    url.searchParams.set('event', slug)
  }
  const ceremony = ceremonyContract?.trim()
  if (ceremony) {
    url.searchParams.set('ceremony', ceremony)
  }
  const session = sessionId?.trim()
  if (session) {
    url.searchParams.set('sessionId', session)
  }
  const mapped =
    registrationMapped === true ||
    registrationMapped === false
      ? registrationMapped
      : !!ceremony
  url.searchParams.set('registrationMapped', mapped ? '1' : '0')
  return url.toString()
}

/**
 * Resolve which tab is selected; fall back to DAO default if id missing.
 */
export const resolveSelectedBountyBoardTab = (
  tabs: BountyBoardTab[],
  selectedId?: string | null
): BountyBoardTab => {
  if (selectedId) {
    const hit = tabs.find((t) => t.id === selectedId)
    if (hit) return hit
  }
  return tabs[0]
}
