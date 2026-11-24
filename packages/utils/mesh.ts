/**
 * DAO off-chain mesh (mesh.v1) — resolve + defaults.
 *
 * Design: docs/superpowers/specs/2026-07-20-dao-mesh-calendar-nostr-design.md
 *
 * Bias: headstash server is the default Nostr + HTTP query plane. Frontends
 * never invent relay lists — they resolve mesh once.
 */

import { getSupportedChainConfig } from './chain'

/** DAO core storage item key for the versioned mesh descriptor. */
export const MESH_STORAGE_KEY = 'mesh.v1'

/** Billboard / account text-record key (same JSON as DAO storage). */
export const MESH_TEXT_RECORD_KEY = 'mesh.v1'

/** Mesh descriptor schema version. */
export const MESH_DESCRIPTOR_VERSION = 1 as const

export type MeshAuthHint = {
  /** Auth planes this DAO expects (hints only — enforcement is host/contract). */
  planes: string[]
  default?: string
}

/** Listing modes a DAO marketplace surface supports. */
export type MeshMarketplaceMode = 'fixed' | 'auction' | 'buy_now'

/**
 * mesh.v1.marketplace — fixed-price + auction discovery (M0 handoff).
 * Handoff: docs/superpowers/specs/2026-07-20-dao-marketplace-nostr-ui-handoff.md
 */
export type MeshMarketplaceV1 = {
  /** marketplace-mirror contract (SKU / fixed-price inventory). */
  fixedPrice?: string
  /** revenue/auction contract (NFT auctions + buy-now). */
  auction?: string
  /**
   * CW721 collection addresses used to list auctions via `auction_by_contract`.
   * TerpAuction list queries require an nft_contract filter (no global list).
   */
  nftCollections?: string[]
  /** Content plane base (bare sha256 cid → GET /content/{sha}). */
  contentBase?: string
  /** Native denom accepted for purchases (e.g. uterp, uthiol). */
  acceptedDenom?: string
  /** Fixed-price buffer escrow blocks (chain default often 7). */
  minBufferBlocks?: number
  /** Which purchase modes this DAO exposes. */
  modes?: MeshMarketplaceMode[]
}

/**
 * Embed base URLs for Event Hub iframe slots (HTTPS origins / embed paths).
 * Design: docs/research/dao-event-ui-orch/STATUS-U1.md
 */
export type MeshEmbedsV1 = {
  /** Bounties board iframe base (terp-bounties/v1). */
  bounties?: string
  /** Buzz collab iframe base (terp-buzz/v1). */
  buzz?: string
  /** Hermes ops iframe / deep-link base (terp-hermes-ops/v1). */
  hermes?: string
}

/**
 * One event-scoped bounty board registered on mesh.v1 (text-record / storage).
 * EN-F6: new event → board entry; Bounties UI tabs over this list.
 * eventId is the stable tab key (calendar id, slug, or operator label).
 */
export type MeshBountyBoardV1 = {
  /** Stable board key (calendar event id, slug, or freeform). */
  eventId: string
  title?: string
  slug?: string
  /** ISO-8601 or unix seconds string (display only). */
  createdAt?: string
}

/**
 * Optional richer bounties discovery (operator guide B3.1).
 * Prefer merge: embeds.bounties ↔ bounties.embedBase when both present.
 * `boards` = multi-board registry (DAO-wide default is implicit, not listed).
 */
export type MeshBountiesV1 = {
  embedBase?: string
  apiBase?: string
  auth?: string
  mode?: 'public' | 'members'
  defaultDisclosure?: string
  /** Event-scoped boards for tab switcher (EN-F6). */
  boards?: MeshBountyBoardV1[]
}

/** Default Buzz room policy for events spun from Hub. */
export type MeshBuzzGate = 'public' | 'dao-member' | 'registered'

/** Hermes slot visibility policy hint (tab still OnlyMembers at module level). */
export type MeshHermesVisibility = 'only-members' | 'admins' | 'hidden'

/**
 * Event Hub curator defaults (hints; not enforcers / not identity plane).
 */
export type MeshEventDefaultsV1 = {
  /** Require ceremony/calendar registration before full participation chips. */
  requireRegistration?: boolean
  /** Default Buzz room policy for events. */
  buzzGate?: MeshBuzzGate
  /** Hermes slot visibility policy hint. */
  hermesVisibility?: MeshHermesVisibility
  /** Default bounty child view when eventId present. */
  bountyView?: 'event' | 'board' | 'public'
}

/**
 * Calendar access planes (Nostr-calendar / dao-calendar compatible).
 * - `chain` / empty: LCD + CW721 (dao-calendar tokens) — always public-readable.
 * - `public`: optional HTTP index for public events (listEvents).
 * - `private`: members-only index (auth gate is host/JWT; not invent here).
 */
export type MeshCalendarAccessPlane = 'chain' | 'public' | 'private'

export type MeshQueryPlanesV1 = {
  /** Public HTTP query base (listEvents). Optional when chain CW721 is enough. */
  public?: string
  /** Private / members-only HTTP query base. */
  private?: string
}

export type MeshDescriptorV1 = {
  v: typeof MESH_DESCRIPTOR_VERSION
  /** Nostr WSS endpoints; default includes chain headstash WSS. */
  relays: string[]
  /**
   * HTTPS query plane base (legacy single plane).
   * Empty string / omitted → chain-only (dao-calendar CW721 via LCD).
   * Prefer `queryPlanes` when public + private indexes both exist.
   */
  query: string
  /** Dual public/private HTTP indexes (optional). */
  queryPlanes?: MeshQueryPlanesV1
  /** Default access plane for UI (default: chain if no query, else public). */
  calendarAccess?: MeshCalendarAccessPlane
  /** dao-calendar contract address when known. */
  calendar?: string
  /** Ceremony module contract (DAO member / cw-vote-ceremony). Nullifier SSOT stays on contract. */
  ceremony?: string
  /** Marketplace fixed-price + auction contracts and content plane. */
  marketplace?: MeshMarketplaceV1
  /** Unified embed bases for Event Hub compose. */
  embeds?: MeshEmbedsV1
  /** Richer bounties discovery (legacy-compatible with operator guide). */
  bounties?: MeshBountiesV1
  auth?: MeshAuthHint
  /** Event Hub curator policy hints. */
  eventDefaults?: MeshEventDefaultsV1
  /** If true, do not auto-merge chain default relays into `relays`. */
  strictRelays?: boolean
  notes?: string
}

export type MeshResolveSource =
  | 'override'
  | 'dao_storage'
  | 'module'
  | 'text_record'
  | 'chain_default'

export type ResolvedMesh = MeshDescriptorV1 & {
  /** Where the winning non-override layer came from (after merge). */
  source: MeshResolveSource
  /** Soft product signals for FE friction mapping. */
  warnings: string[]
  chainId: string
}

export type ChainMeshServices = {
  headstashServer?: string
  headstashWss?: string
  merkleServer?: string
  /** Content plane / hash host (marketplace media). */
  hashContentBase?: string
  /** Optional Event Hub / multi-surface embed defaults (ops-published, not invented relays). */
  bountiesEmbed?: string
  bountiesApi?: string
  buzzEmbed?: string
  hermesEmbed?: string
}

export type MeshModuleValues = {
  calendarContract?: string
  /** Optional raw mesh.v1 JSON stored on the Calendar / Marketplace / Event Hub module. */
  meshJson?: string
  /** Marketplace module contracts + content plane (merge into mesh.marketplace). */
  marketplaceFixedPrice?: string
  marketplaceAuction?: string
  /** Comma-separated or string[] of CW721 collections for auction_by_contract. */
  marketplaceNftCollections?: string | string[]
  marketplaceContentBase?: string
  marketplaceAcceptedDenom?: string
  marketplaceMinBufferBlocks?: number
  /** Ceremony module address from Event Hub / ceremony module vars. */
  ceremonyContract?: string
  /** Embed bases from Event Hub / surface modules (merge into mesh.embeds). */
  embedBounties?: string
  embedBuzz?: string
  embedHermes?: string
  /** Optional raw partial MeshEventDefaultsV1 JSON. */
  eventDefaultsJson?: string
}

/**
 * Injectable loaders so resolveMesh stays testable and framework-agnostic.
 * All loaders are optional — missing layers are skipped.
 */
export type MeshResolveLoaders = {
  /** DAO core `get_item({ key: mesh.v1 })` → item value string. */
  getDaoStorageItem?: (key: string) => Promise<string | null | undefined>
  /** Calendar module variables (calendarContract + optional meshJson). */
  getModuleValues?: () => Promise<MeshModuleValues | null | undefined>
  /** Billboard text record value for a key (mesh.v1 or legacy). */
  getTextRecord?: (key: string) => Promise<string | null | undefined>
}

export type ResolveMeshOptions = {
  chainId: string
  daoAddress?: string
  /** Billboard account name for text-record path (docs Connect). */
  accountName?: string
  overrides?: Partial<MeshDescriptorV1>
  /** Explicit chain services; defaults to supported-chain config when omitted. */
  chainServices?: ChainMeshServices
  loaders?: MeshResolveLoaders
}

export class MeshResolveError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NO_MESH'
      | 'INVALID_JSON'
      | 'INVALID_DESCRIPTOR'
      | 'CHAIN_DEFAULT_MISSING'
  ) {
    super(message)
    this.name = 'MeshResolveError'
  }
}

/** Derive wss:// from https:// origin when WSS not configured. */
export const httpsToWss = (httpsUrl: string): string => {
  try {
    const u = new URL(httpsUrl)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    // Drop trailing slash for cleaner relay URLs
    return u.toString().replace(/\/$/, '')
  } catch {
    return httpsUrl.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:')
  }
}

/**
 * Build default mesh descriptor from chain service endpoints.
 * Used when DAO has not published mesh.v1.
 */
export const buildDefaultMeshDescriptor = (
  services: ChainMeshServices,
  extras?: Partial<
    Pick<
      MeshDescriptorV1,
      | 'calendar'
      | 'ceremony'
      | 'marketplace'
      | 'embeds'
      | 'bounties'
      | 'eventDefaults'
      | 'auth'
      | 'notes'
    >
  >
): MeshDescriptorV1 => {
  const query = (services.headstashServer || '').replace(/\/$/, '')
  if (!query) {
    throw new MeshResolveError(
      'Chain default headstashServer is empty — set services.headstashServer on the chain config (C0).',
      'CHAIN_DEFAULT_MISSING'
    )
  }
  const wss =
    (services.headstashWss || '').replace(/\/$/, '') || httpsToWss(query)
  const contentBase = (
    services.hashContentBase ||
    services.merkleServer ||
    ''
  ).replace(/\/$/, '')
  const defaultMarketplace: MeshMarketplaceV1 | undefined = contentBase
    ? {
        contentBase,
        minBufferBlocks: 7,
        modes: ['fixed', 'auction', 'buy_now'],
      }
    : undefined
  // Module/DAO marketplace wins per field, but keep chain contentBase seed.
  const marketplace = mergeMeshMarketplace(
    defaultMarketplace,
    extras?.marketplace
  )
  // Ops-published embed seeds only — never invent hostnames here beyond chain services.
  const chainEmbeds = parseMeshEmbeds({
    bounties: services.bountiesEmbed,
    buzz: services.buzzEmbed,
    hermes: services.hermesEmbed,
  })
  const chainBounties = parseMeshBounties({
    embedBase: services.bountiesEmbed,
    apiBase: services.bountiesApi,
  })
  const embeds = normalizeEmbedsBounties(
    mergeMeshEmbeds(chainEmbeds, extras?.embeds),
    mergeMeshBounties(chainBounties, extras?.bounties)
  )
  return {
    v: MESH_DESCRIPTOR_VERSION,
    relays: [wss],
    query,
    calendar: extras?.calendar,
    ceremony: extras?.ceremony,
    marketplace,
    embeds: embeds.embeds,
    bounties: embeds.bounties,
    eventDefaults: extras?.eventDefaults,
    auth: extras?.auth ?? {
      planes: ['pfpk', 'smartaccount', 'nostr'],
      default: 'pfpk',
    },
    notes: extras?.notes,
  }
}

const MARKETPLACE_MODES: MeshMarketplaceMode[] = [
  'fixed',
  'auction',
  'buy_now',
]

/** Normalize nftCollections from mesh JSON (array or comma-separated string). */
export const parseNftCollections = (raw: unknown): string[] | undefined => {
  if (Array.isArray(raw)) {
    const list = raw
      .filter((x): x is string => typeof x === 'string' && !!x.trim())
      .map((s) => s.trim())
    return list.length ? Array.from(new Set(list)) : undefined
  }
  if (typeof raw === 'string' && raw.trim()) {
    const list = raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    return list.length ? Array.from(new Set(list)) : undefined
  }
  return undefined
}

/** Union collection lists (layer first, then base; de-duped). */
export const mergeNftCollections = (
  base?: string[],
  layer?: string[]
): string[] | undefined => {
  if (!base?.length && !layer?.length) return undefined
  if (!layer?.length) return base
  if (!base?.length) return layer
  return Array.from(new Set([...layer, ...base]))
}

/** Parse optional mesh.v1.marketplace block. */
export const parseMeshMarketplace = (
  raw: unknown
): MeshMarketplaceV1 | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const m = raw as Record<string, unknown>
  const modes = Array.isArray(m.modes)
    ? m.modes.filter((x): x is MeshMarketplaceMode =>
        MARKETPLACE_MODES.includes(x as MeshMarketplaceMode)
      )
    : undefined
  // Accept camelCase (TS) and snake_case (ops JSON).
  const nftCollections = parseNftCollections(
    m.nftCollections ?? m.nft_collections
  )
  const out: MeshMarketplaceV1 = {
    fixedPrice:
      typeof m.fixedPrice === 'string' && m.fixedPrice
        ? m.fixedPrice
        : undefined,
    auction:
      typeof m.auction === 'string' && m.auction ? m.auction : undefined,
    nftCollections,
    contentBase:
      typeof m.contentBase === 'string' && m.contentBase
        ? m.contentBase.replace(/\/$/, '')
        : undefined,
    acceptedDenom:
      typeof m.acceptedDenom === 'string' && m.acceptedDenom
        ? m.acceptedDenom
        : undefined,
    minBufferBlocks:
      typeof m.minBufferBlocks === 'number' && Number.isFinite(m.minBufferBlocks)
        ? m.minBufferBlocks
        : undefined,
    modes: modes?.length ? modes : undefined,
  }
  // Drop empty object
  if (
    !out.fixedPrice &&
    !out.auction &&
    !out.nftCollections?.length &&
    !out.contentBase &&
    !out.acceptedDenom &&
    out.minBufferBlocks === undefined &&
    !out.modes
  ) {
    return undefined
  }
  return out
}

/** Merge marketplace blocks (later wins per field; nftCollections union). */
export const mergeMeshMarketplace = (
  base?: MeshMarketplaceV1,
  layer?: MeshMarketplaceV1 | null
): MeshMarketplaceV1 | undefined => {
  if (!base && !layer) return undefined
  if (!layer) return base
  if (!base) return layer
  return {
    fixedPrice: layer.fixedPrice ?? base.fixedPrice,
    auction: layer.auction ?? base.auction,
    nftCollections: mergeNftCollections(base.nftCollections, layer.nftCollections),
    contentBase: layer.contentBase ?? base.contentBase,
    acceptedDenom: layer.acceptedDenom ?? base.acceptedDenom,
    minBufferBlocks: layer.minBufferBlocks ?? base.minBufferBlocks,
    modes: layer.modes ?? base.modes,
  }
}

const stripTrailingSlash = (s: string): string => s.replace(/\/$/, '')

/** Parse optional mesh.v1.embeds block. */
export const parseMeshEmbeds = (raw: unknown): MeshEmbedsV1 | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const m = raw as Record<string, unknown>
  const out: MeshEmbedsV1 = {
    bounties:
      typeof m.bounties === 'string' && m.bounties
        ? stripTrailingSlash(m.bounties)
        : undefined,
    buzz:
      typeof m.buzz === 'string' && m.buzz
        ? stripTrailingSlash(m.buzz)
        : undefined,
    hermes:
      typeof m.hermes === 'string' && m.hermes
        ? stripTrailingSlash(m.hermes)
        : undefined,
  }
  if (!out.bounties && !out.buzz && !out.hermes) return undefined
  return out
}

/** Merge embeds (later wins per key). */
export const mergeMeshEmbeds = (
  base?: MeshEmbedsV1,
  layer?: MeshEmbedsV1 | null
): MeshEmbedsV1 | undefined => {
  if (!base && !layer) return undefined
  if (!layer) return base
  if (!base) return layer
  const out: MeshEmbedsV1 = {
    bounties: layer.bounties ?? base.bounties,
    buzz: layer.buzz ?? base.buzz,
    hermes: layer.hermes ?? base.hermes,
  }
  if (!out.bounties && !out.buzz && !out.hermes) return undefined
  return out
}

/** Parse a single board entry (requires non-empty eventId). */
export const parseMeshBountyBoard = (
  raw: unknown
): MeshBountyBoardV1 | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const m = raw as Record<string, unknown>
  const eventId =
    typeof m.eventId === 'string'
      ? m.eventId.trim()
      : typeof m.event_id === 'string'
        ? m.event_id.trim()
        : typeof m.id === 'string'
          ? m.id.trim()
          : ''
  if (!eventId) return undefined
  const out: MeshBountyBoardV1 = { eventId }
  if (typeof m.title === 'string' && m.title.trim()) {
    out.title = m.title.trim()
  }
  if (typeof m.slug === 'string' && m.slug.trim()) {
    out.slug = m.slug.trim()
  }
  if (typeof m.createdAt === 'string' && m.createdAt.trim()) {
    out.createdAt = m.createdAt.trim()
  } else if (typeof m.created_at === 'string' && m.created_at.trim()) {
    out.createdAt = m.created_at.trim()
  }
  return out
}

/** Parse boards array; drops invalid rows; de-dupes by eventId (first wins). */
export const parseMeshBountyBoards = (
  raw: unknown
): MeshBountyBoardV1[] | undefined => {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const boards: MeshBountyBoardV1[] = []
  for (const row of raw) {
    const b = parseMeshBountyBoard(row)
    if (!b || seen.has(b.eventId)) continue
    seen.add(b.eventId)
    boards.push(b)
  }
  return boards.length ? boards : undefined
}

/**
 * Merge board lists by eventId. Later layer wins per key; order = base then
 * new layer-only entries.
 */
export const mergeMeshBountyBoards = (
  base?: MeshBountyBoardV1[],
  layer?: MeshBountyBoardV1[] | null
): MeshBountyBoardV1[] | undefined => {
  if (!base?.length && !layer?.length) return undefined
  if (!layer?.length) return base?.length ? base : undefined
  if (!base?.length) return layer
  const map = new Map<string, MeshBountyBoardV1>()
  for (const b of base) map.set(b.eventId, b)
  for (const b of layer) {
    const prev = map.get(b.eventId)
    map.set(b.eventId, prev ? { ...prev, ...b, eventId: b.eventId } : b)
  }
  return Array.from(map.values())
}

/** Parse optional mesh.v1.bounties discovery block. */
export const parseMeshBounties = (raw: unknown): MeshBountiesV1 | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const m = raw as Record<string, unknown>
  const mode =
    m.mode === 'public' || m.mode === 'members' ? m.mode : undefined
  const boards = parseMeshBountyBoards(m.boards)
  const out: MeshBountiesV1 = {
    embedBase:
      typeof m.embedBase === 'string' && m.embedBase
        ? stripTrailingSlash(m.embedBase)
        : undefined,
    apiBase:
      typeof m.apiBase === 'string' && m.apiBase
        ? stripTrailingSlash(m.apiBase)
        : undefined,
    auth: typeof m.auth === 'string' && m.auth ? m.auth : undefined,
    mode,
    defaultDisclosure:
      typeof m.defaultDisclosure === 'string' && m.defaultDisclosure
        ? m.defaultDisclosure
        : undefined,
    boards,
  }
  if (
    !out.embedBase &&
    !out.apiBase &&
    !out.auth &&
    !out.mode &&
    !out.defaultDisclosure &&
    !out.boards?.length
  ) {
    return undefined
  }
  return out
}

/** Merge bounties discovery (later wins per key; boards merge by eventId). */
export const mergeMeshBounties = (
  base?: MeshBountiesV1,
  layer?: MeshBountiesV1 | null
): MeshBountiesV1 | undefined => {
  if (!base && !layer) return undefined
  if (!layer) return base
  if (!base) return layer
  const out: MeshBountiesV1 = {
    embedBase: layer.embedBase ?? base.embedBase,
    apiBase: layer.apiBase ?? base.apiBase,
    auth: layer.auth ?? base.auth,
    mode: layer.mode ?? base.mode,
    defaultDisclosure: layer.defaultDisclosure ?? base.defaultDisclosure,
    boards: mergeMeshBountyBoards(base.boards, layer.boards),
  }
  if (
    !out.embedBase &&
    !out.apiBase &&
    !out.auth &&
    !out.mode &&
    !out.defaultDisclosure &&
    !out.boards?.length
  ) {
    return undefined
  }
  return out
}

const BUZZ_GATES: MeshBuzzGate[] = ['public', 'dao-member', 'registered']
const HERMES_VIS: MeshHermesVisibility[] = [
  'only-members',
  'admins',
  'hidden',
]
const BOUNTY_VIEWS = ['event', 'board', 'public'] as const

/** Parse optional mesh.v1.eventDefaults. Invalid enums are dropped (not thrown). */
export const parseMeshEventDefaults = (
  raw: unknown
): MeshEventDefaultsV1 | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const m = raw as Record<string, unknown>
  const buzzGate = BUZZ_GATES.includes(m.buzzGate as MeshBuzzGate)
    ? (m.buzzGate as MeshBuzzGate)
    : undefined
  const hermesVisibility = HERMES_VIS.includes(
    m.hermesVisibility as MeshHermesVisibility
  )
    ? (m.hermesVisibility as MeshHermesVisibility)
    : undefined
  const bountyView = BOUNTY_VIEWS.includes(
    m.bountyView as (typeof BOUNTY_VIEWS)[number]
  )
    ? (m.bountyView as MeshEventDefaultsV1['bountyView'])
    : undefined
  const out: MeshEventDefaultsV1 = {
    requireRegistration:
      typeof m.requireRegistration === 'boolean'
        ? m.requireRegistration
        : undefined,
    buzzGate,
    hermesVisibility,
    bountyView,
  }
  if (
    out.requireRegistration === undefined &&
    !out.buzzGate &&
    !out.hermesVisibility &&
    !out.bountyView
  ) {
    return undefined
  }
  return out
}

/** Merge eventDefaults (later wins per key). */
export const mergeMeshEventDefaults = (
  base?: MeshEventDefaultsV1,
  layer?: MeshEventDefaultsV1 | null
): MeshEventDefaultsV1 | undefined => {
  if (!base && !layer) return undefined
  if (!layer) return base
  if (!base) return layer
  const out: MeshEventDefaultsV1 = {
    requireRegistration:
      layer.requireRegistration ?? base.requireRegistration,
    buzzGate: layer.buzzGate ?? base.buzzGate,
    hermesVisibility: layer.hermesVisibility ?? base.hermesVisibility,
    bountyView: layer.bountyView ?? base.bountyView,
  }
  if (
    out.requireRegistration === undefined &&
    !out.buzzGate &&
    !out.hermesVisibility &&
    !out.bountyView
  ) {
    return undefined
  }
  return out
}

/**
 * Cross-link embeds.bounties ↔ bounties.embedBase without inventing hosts.
 */
export const normalizeEmbedsBounties = (
  embeds?: MeshEmbedsV1,
  bounties?: MeshBountiesV1
): { embeds?: MeshEmbedsV1; bounties?: MeshBountiesV1 } => {
  let nextEmbeds = embeds
  let nextBounties = bounties
  if (!nextEmbeds?.bounties && nextBounties?.embedBase) {
    nextEmbeds = mergeMeshEmbeds(nextEmbeds, {
      bounties: nextBounties.embedBase,
    })
  }
  if (nextEmbeds?.bounties && !nextBounties?.embedBase) {
    nextBounties = mergeMeshBounties(nextBounties, {
      embedBase: nextEmbeds.bounties,
    })
  }
  return { embeds: nextEmbeds, bounties: nextBounties }
}

/** Read chain services from SupportedChainConfig when available. */
export const getChainMeshServices = (
  chainId: string
): ChainMeshServices | undefined => {
  const config = getSupportedChainConfig(chainId)
  return config?.services
}

/**
 * Parse and lightly validate a mesh.v1 JSON string or object.
 */
export const parseMeshDescriptor = (
  raw: string | MeshDescriptorV1 | Record<string, unknown>
): MeshDescriptorV1 => {
  let obj: unknown
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      throw new MeshResolveError('mesh.v1 is not valid JSON', 'INVALID_JSON')
    }
  } else {
    obj = raw
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new MeshResolveError('mesh.v1 must be an object', 'INVALID_DESCRIPTOR')
  }

  const m = obj as Record<string, unknown>
  const v = m.v
  if (v !== 1 && v !== '1') {
    throw new MeshResolveError(
      `Unsupported mesh descriptor version: ${String(v)}`,
      'INVALID_DESCRIPTOR'
    )
  }

  // Empty query is valid: chain-only / CW721 public plane (dao-calendar).
  const rawQuery = typeof m.query === 'string' ? m.query.replace(/\/$/, '') : ''

  let queryPlanes: MeshQueryPlanesV1 | undefined
  if (m.queryPlanes && typeof m.queryPlanes === 'object' && !Array.isArray(m.queryPlanes)) {
    const qp = m.queryPlanes as Record<string, unknown>
    const pub =
      typeof qp.public === 'string' ? qp.public.replace(/\/$/, '') : undefined
    const priv =
      typeof qp.private === 'string' ? qp.private.replace(/\/$/, '') : undefined
    if (pub || priv) {
      queryPlanes = { public: pub, private: priv }
    }
  }

  // Prefer dual planes when set; fall back to legacy single query.
  const query =
    rawQuery ||
    queryPlanes?.public ||
    queryPlanes?.private ||
    ''

  let relays: string[] = []
  if (Array.isArray(m.relays)) {
    relays = m.relays.filter((r): r is string => typeof r === 'string' && !!r)
  }

  const calendar =
    typeof m.calendar === 'string' && m.calendar ? m.calendar : undefined

  const ceremony =
    typeof m.ceremony === 'string' && m.ceremony ? m.ceremony : undefined

  let auth: MeshAuthHint | undefined
  if (m.auth && typeof m.auth === 'object' && !Array.isArray(m.auth)) {
    const a = m.auth as Record<string, unknown>
    const planes = Array.isArray(a.planes)
      ? a.planes.filter((p): p is string => typeof p === 'string')
      : []
    if (planes.length) {
      auth = {
        planes,
        default: typeof a.default === 'string' ? a.default : undefined,
      }
    }
  }

  const marketplace = parseMeshMarketplace(m.marketplace)
  const embeds = parseMeshEmbeds(m.embeds)
  const bounties = parseMeshBounties(m.bounties)
  const eventDefaults = parseMeshEventDefaults(m.eventDefaults)
  const normalized = normalizeEmbedsBounties(embeds, bounties)

  const calendarAccessRaw =
    typeof m.calendarAccess === 'string' ? m.calendarAccess : undefined
  const calendarAccess: MeshCalendarAccessPlane | undefined =
    calendarAccessRaw === 'chain' ||
    calendarAccessRaw === 'public' ||
    calendarAccessRaw === 'private'
      ? calendarAccessRaw
      : !query
        ? 'chain'
        : 'public'

  return {
    v: MESH_DESCRIPTOR_VERSION,
    relays,
    query,
    queryPlanes,
    calendarAccess,
    calendar,
    ceremony,
    marketplace,
    embeds: normalized.embeds,
    bounties: normalized.bounties,
    eventDefaults,
    auth,
    strictRelays: m.strictRelays === true,
    notes: typeof m.notes === 'string' ? m.notes : undefined,
  }
}

/**
 * Merge partial/layer descriptors. Later args win for scalar fields;
 * relays are concatenated unique unless strictRelays on the winner.
 */
export const mergeMeshLayers = (
  base: MeshDescriptorV1,
  ...layers: Array<Partial<MeshDescriptorV1> | null | undefined>
): MeshDescriptorV1 => {
  let out: MeshDescriptorV1 = { ...base, relays: [...base.relays] }
  for (const layer of layers) {
    if (!layer) continue
    const nextRelays = layer.relays?.length
      ? layer.strictRelays
        ? [...layer.relays]
        : uniqueStrings([...out.relays, ...layer.relays])
      : out.relays
    const mergedEmbeds = mergeMeshEmbeds(out.embeds, layer.embeds)
    const mergedBounties = mergeMeshBounties(out.bounties, layer.bounties)
    const normalized = normalizeEmbedsBounties(mergedEmbeds, mergedBounties)
    out = {
      v: MESH_DESCRIPTOR_VERSION,
      relays: nextRelays,
      // Preserve intentional empty query (chain-only); only fill from layer when set.
      query:
        layer.query !== undefined && layer.query !== null
          ? String(layer.query).replace(/\/$/, '')
          : out.query,
      queryPlanes: layer.queryPlanes ?? out.queryPlanes,
      calendarAccess: layer.calendarAccess ?? out.calendarAccess,
      calendar: layer.calendar ?? out.calendar,
      ceremony: layer.ceremony ?? out.ceremony,
      marketplace: mergeMeshMarketplace(out.marketplace, layer.marketplace),
      embeds: normalized.embeds,
      bounties: normalized.bounties,
      eventDefaults: mergeMeshEventDefaults(
        out.eventDefaults,
        layer.eventDefaults
      ),
      auth: layer.auth ?? out.auth,
      strictRelays: layer.strictRelays ?? out.strictRelays,
      notes: layer.notes ?? out.notes,
    }
  }
  return out
}

const uniqueStrings = (xs: string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x)
      out.push(x)
    }
  }
  return out
}

const tryParse = (
  raw: string | null | undefined
): MeshDescriptorV1 | undefined => {
  if (raw == null || raw === '') return undefined
  try {
    return parseMeshDescriptor(raw)
  } catch {
    return undefined
  }
}

/**
 * Resolve mesh for a DAO / account.
 *
 * Order: overrides → DAO storage mesh.v1 → Calendar module → text records →
 * chain headstash defaults → fail closed.
 */
export const resolveMesh = async (
  opts: ResolveMeshOptions
): Promise<ResolvedMesh> => {
  const { chainId, overrides, loaders } = opts
  const warnings: string[] = []

  const services: ChainMeshServices =
    opts.chainServices ?? getChainMeshServices(chainId) ?? {}

  let chainDefault: MeshDescriptorV1 | undefined
  try {
    if (services.headstashServer) {
      chainDefault = buildDefaultMeshDescriptor(services)
    }
  } catch {
    chainDefault = undefined
  }

  // Layer candidates (low → high priority before overrides)
  let fromText: MeshDescriptorV1 | undefined
  if (loaders?.getTextRecord) {
    fromText = tryParse(await loaders.getTextRecord(MESH_TEXT_RECORD_KEY))
    // Legacy: some billboards only have calendar-ish discovery via subdao;
    // mesh JSON is preferred — no auto-calendar probe here (that's C3).
  }

  let fromModule: MeshDescriptorV1 | undefined
  let moduleCalendar: string | undefined
  if (loaders?.getModuleValues) {
    const mod = await loaders.getModuleValues()
    moduleCalendar = mod?.calendarContract || undefined
    const moduleCeremony = mod?.ceremonyContract || undefined
    const modMarketplace = parseMeshMarketplace({
      fixedPrice: mod?.marketplaceFixedPrice,
      auction: mod?.marketplaceAuction,
      nftCollections: mod?.marketplaceNftCollections,
      contentBase: mod?.marketplaceContentBase,
      acceptedDenom: mod?.marketplaceAcceptedDenom,
      minBufferBlocks: mod?.marketplaceMinBufferBlocks,
      modes:
        mod?.marketplaceFixedPrice || mod?.marketplaceAuction
          ? (['fixed', 'auction', 'buy_now'] as MeshMarketplaceMode[])
          : undefined,
    })
    const modEmbeds = parseMeshEmbeds({
      bounties: mod?.embedBounties,
      buzz: mod?.embedBuzz,
      hermes: mod?.embedHermes,
    })
    let modEventDefaults: MeshEventDefaultsV1 | undefined
    if (mod?.eventDefaultsJson) {
      try {
        modEventDefaults = parseMeshEventDefaults(
          JSON.parse(mod.eventDefaultsJson)
        )
      } catch {
        modEventDefaults = undefined
      }
    }
    if (mod?.meshJson) {
      fromModule = tryParse(mod.meshJson)
    }
    const hasModuleExtras = !!(
      moduleCalendar ||
      moduleCeremony ||
      modMarketplace ||
      modEmbeds ||
      modEventDefaults
    )
    if (!fromModule && hasModuleExtras) {
      // Module has contracts/embeds only — complete from chain default
      fromModule = chainDefault
        ? {
            ...chainDefault,
            calendar: moduleCalendar ?? chainDefault.calendar,
            ceremony: moduleCeremony ?? chainDefault.ceremony,
            marketplace: mergeMeshMarketplace(
              chainDefault.marketplace,
              modMarketplace
            ),
            embeds: mergeMeshEmbeds(chainDefault.embeds, modEmbeds),
            eventDefaults: mergeMeshEventDefaults(
              chainDefault.eventDefaults,
              modEventDefaults
            ),
          }
        : undefined
      if (!fromModule) {
        warnings.push(
          'Module has contracts but no chain headstash default to complete mesh'
        )
      } else {
        const n = normalizeEmbedsBounties(
          fromModule.embeds,
          fromModule.bounties
        )
        fromModule = { ...fromModule, embeds: n.embeds, bounties: n.bounties }
      }
    } else if (fromModule) {
      if (moduleCalendar && !fromModule.calendar) {
        fromModule = { ...fromModule, calendar: moduleCalendar }
      }
      if (moduleCeremony && !fromModule.ceremony) {
        fromModule = { ...fromModule, ceremony: moduleCeremony }
      }
      if (modMarketplace) {
        fromModule = {
          ...fromModule,
          marketplace: mergeMeshMarketplace(
            fromModule.marketplace,
            modMarketplace
          ),
        }
      }
      if (modEmbeds) {
        const n = normalizeEmbedsBounties(
          mergeMeshEmbeds(fromModule.embeds, modEmbeds),
          fromModule.bounties
        )
        fromModule = {
          ...fromModule,
          embeds: n.embeds,
          bounties: n.bounties,
        }
      }
      if (modEventDefaults) {
        fromModule = {
          ...fromModule,
          eventDefaults: mergeMeshEventDefaults(
            fromModule.eventDefaults,
            modEventDefaults
          ),
        }
      }
    }
  }

  let fromDao: MeshDescriptorV1 | undefined
  if (loaders?.getDaoStorageItem) {
    fromDao = tryParse(await loaders.getDaoStorageItem(MESH_STORAGE_KEY))
  }

  // Determine base source (highest configured layer below overrides)
  type Layer = { mesh: MeshDescriptorV1; source: MeshResolveSource }
  const layers: Layer[] = []
  if (chainDefault) layers.push({ mesh: chainDefault, source: 'chain_default' })
  if (fromText) layers.push({ mesh: fromText, source: 'text_record' })
  if (fromModule) layers.push({ mesh: fromModule, source: 'module' })
  if (fromDao) layers.push({ mesh: fromDao, source: 'dao_storage' })

  if (!layers.length && !overrides?.query && !overrides?.relays?.length) {
    throw new MeshResolveError(
      'DAO has no mesh descriptor and chain default headstashServer is missing. Ops: set services.headstashServer (C0) or publish mesh.v1.',
      'NO_MESH'
    )
  }

  const base = layers[0]?.mesh
  if (!base && overrides) {
    // Overrides alone must still form a valid descriptor
    if (!overrides.query) {
      throw new MeshResolveError(
        'overrides.query required when no mesh layers exist',
        'NO_MESH'
      )
    }
  }

  let merged = layers.length
    ? layers.slice(1).reduce(
        (acc, L) => mergeMeshLayers(acc, L.mesh),
        layers[0].mesh
      )
    : buildDefaultMeshDescriptor({
        headstashServer: overrides!.query,
        headstashWss: overrides!.relays?.[0],
      })

  // Ensure chain default relays remain in pool unless strict
  if (chainDefault && !merged.strictRelays) {
    merged = mergeMeshLayers(chainDefault, merged)
  }

  let source: MeshResolveSource = layers.length
    ? layers[layers.length - 1].source
    : 'chain_default'

  if (overrides && Object.keys(overrides).length) {
    merged = mergeMeshLayers(merged, overrides)
    source = 'override'
  }

  // Always ensure at least one relay when query exists
  if (!merged.relays.length && merged.query) {
    merged = {
      ...merged,
      relays: [httpsToWss(merged.query)],
    }
    warnings.push('relays empty — derived WSS from query origin')
  }

  if (!merged.calendar) {
    warnings.push(
      'mesh has no calendar address — DAO half-enabled until calendar is set'
    )
  }

  if (
    merged.marketplace &&
    !merged.marketplace.fixedPrice &&
    !merged.marketplace.auction
  ) {
    warnings.push(
      'mesh.marketplace has no fixedPrice or auction contract — catalog cannot load until contracts are set'
    )
  }

  // Seed embeds from chain services only when mesh omits the key (never overwrite DAO).
  if (services.bountiesEmbed && !merged.embeds?.bounties) {
    const n = normalizeEmbedsBounties(
      mergeMeshEmbeds(merged.embeds, {
        bounties: stripTrailingSlash(services.bountiesEmbed),
      }),
      mergeMeshBounties(merged.bounties, {
        embedBase: stripTrailingSlash(services.bountiesEmbed),
        apiBase: services.bountiesApi
          ? stripTrailingSlash(services.bountiesApi)
          : undefined,
      })
    )
    merged = { ...merged, embeds: n.embeds, bounties: n.bounties }
  }
  if (services.buzzEmbed && !merged.embeds?.buzz) {
    merged = {
      ...merged,
      embeds: mergeMeshEmbeds(merged.embeds, {
        buzz: stripTrailingSlash(services.buzzEmbed),
      }),
    }
  }
  if (services.hermesEmbed && !merged.embeds?.hermes) {
    merged = {
      ...merged,
      embeds: mergeMeshEmbeds(merged.embeds, {
        hermes: stripTrailingSlash(services.hermesEmbed),
      }),
    }
  }

  if (!merged.embeds?.bounties && !merged.bounties?.embedBase) {
    warnings.push(
      'mesh has no bounties embed — work surface CTA disabled'
    )
  }
  if (!merged.embeds?.buzz) {
    warnings.push('mesh has no buzz embed — collab slot empty')
  }
  if (!merged.embeds?.hermes) {
    warnings.push(
      'mesh has no hermes embed — ops slot deep-link only / hidden'
    )
  }
  if (merged.eventDefaults?.requireRegistration && !merged.ceremony) {
    warnings.push(
      'registration required but ceremony address missing'
    )
  }
  // Orphan OPEN registration path: work surface present without ceremony map.
  if (
    (merged.embeds?.bounties || merged.bounties?.embedBase) &&
    !merged.ceremony
  ) {
    warnings.push(
      'bounties embed without ceremony — registration bounty stays pending until ceremony is mapped'
    )
  }
  if (merged.ceremony && !merged.calendar) {
    warnings.push(
      'ceremony set without calendar — schedule vs ceremony window may diverge'
    )
  }

  return {
    ...merged,
    source,
    warnings,
    chainId,
  }
}

// ── Query plane client (HTTP) ───────────────────────────────────────────────

export type MeshEventListFilter = {
  from?: string | number
  to?: string | number
  group?: string
  limit?: number
}

export type MeshQueryClient = {
  mesh: ResolvedMesh | MeshDescriptorV1
  /** List events via headstash (or mesh.query) HTTP API. */
  listEvents: (filter?: MeshEventListFilter) => Promise<unknown>
  /** Prefer mesh.calendar; else ask query plane to resolve. */
  getCalendarAddress: () => Promise<string | undefined>
  queryBase: string
}

/**
 * Create a thin HTTP query-plane client. Paths are stable conventions:
 * - GET {query}/api/v1/calendar/events
 * - GET {query}/api/v1/calendar/resolve?dao=…
 *
 * If the server is not deployed yet, callers get HTTP errors — FE friction map:
 * query 5xx → headstash availability.
 */
export const createMeshQueryClient = (
  mesh: ResolvedMesh | MeshDescriptorV1,
  fetchImpl: typeof fetch = fetch,
  options?: { plane?: MeshCalendarAccessPlane }
): MeshQueryClient => {
  const planes = 'queryPlanes' in mesh ? mesh.queryPlanes : undefined
  const access =
    options?.plane ||
    ('calendarAccess' in mesh ? mesh.calendarAccess : undefined) ||
    'public'

  // Resolve which HTTP base (if any) for this access plane.
  let queryBase = ''
  if (access === 'private') {
    queryBase = (planes?.private || mesh.query || '').replace(/\/$/, '')
  } else if (access === 'public') {
    queryBase = (planes?.public || mesh.query || '').replace(/\/$/, '')
  } else {
    // chain plane — no HTTP index
    queryBase = ''
  }

  return {
    mesh,
    queryBase,
    async listEvents(filter = {}) {
      if (!queryBase) {
        // Callers should fall back to on-chain dao-calendar (CW721).
        throw new Error(
          'mesh query plane unset — use on-chain dao-calendar (calendarAccess=chain)'
        )
      }
      const params = new URLSearchParams()
      if (filter.from != null) params.set('from', String(filter.from))
      if (filter.to != null) params.set('to', String(filter.to))
      if (filter.group) params.set('group', filter.group)
      if (filter.limit != null) params.set('limit', String(filter.limit))
      if ('calendar' in mesh && mesh.calendar) {
        params.set('calendar', mesh.calendar)
      }
      if (access === 'private') params.set('access', 'private')
      else if (access === 'public') params.set('access', 'public')
      const qs = params.toString()
      const url = `${queryBase}/api/v1/calendar/events${qs ? `?${qs}` : ''}`
      const res = await fetchImpl(url)
      if (!res.ok) {
        throw new Error(`mesh query listEvents failed: HTTP ${res.status}`)
      }
      return res.json()
    },
    async getCalendarAddress() {
      if ('calendar' in mesh && mesh.calendar) return mesh.calendar
      if (!queryBase) return undefined
      const res = await fetchImpl(`${queryBase}/api/v1/calendar/resolve`)
      if (!res.ok) return undefined
      const body = (await res.json()) as { calendar?: string }
      return body.calendar
    },
  }
}

/**
 * Serialize mesh for DAO storage / text records.
 */
export const serializeMeshDescriptor = (mesh: MeshDescriptorV1): string =>
  JSON.stringify({
    v: MESH_DESCRIPTOR_VERSION,
    relays: mesh.relays,
    query: mesh.query,
    ...(mesh.calendar ? { calendar: mesh.calendar } : {}),
    ...(mesh.ceremony ? { ceremony: mesh.ceremony } : {}),
    ...(mesh.marketplace ? { marketplace: mesh.marketplace } : {}),
    ...(mesh.embeds ? { embeds: mesh.embeds } : {}),
    ...(mesh.bounties ? { bounties: mesh.bounties } : {}),
    ...(mesh.eventDefaults ? { eventDefaults: mesh.eventDefaults } : {}),
    ...(mesh.auth ? { auth: mesh.auth } : {}),
    ...(mesh.strictRelays ? { strictRelays: true } : {}),
    ...(mesh.notes ? { notes: mesh.notes } : {}),
  })
