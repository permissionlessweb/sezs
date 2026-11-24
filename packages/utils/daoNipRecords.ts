/**
 * DAO text-record / mesh registration helpers for NIP-aligned modules.
 *
 * Mirrors Rust `cw721-nips::dao_record` — one curator path for:
 * - mesh.v1 (relays + query RPC + marketplace contracts)
 * - NIP-15 filter heuristics
 * - CosmWasm execute msg shapes (action library)
 *
 * Spec: docs/superpowers/specs/2026-07-20-dao-record-nip-action-trait.md
 * Guide: docs/superpowers/user-guides/2026-07-20-dao-marketplace-module-setup.md
 */

import {
  MeshDescriptorV1,
  MeshMarketplaceV1,
  MeshBountyBoardV1,
  MESH_STORAGE_KEY,
  buildDefaultMeshDescriptor,
  serializeMeshDescriptor,
  ChainMeshServices,
  mergeMeshMarketplace,
  mergeMeshEmbeds,
  parseMeshDescriptor,
} from './mesh'
import { curateMeshBountyBoardRecord } from './bountyBoards'
import {
  buildCollabDiscoveryFilters,
  COLLAB_DISCOVERY_KIND,
} from './collabDiscovery'
import {
  MARKETPLACE_NOSTR_KINDS,
  MarketplaceNostrFilter,
  buildMarketplaceNostrFilters,
  MarketplaceNostrMode,
} from './marketplaceNostr'
import {
  buildPlaceBidMsg,
  buildPurchaseMsg,
  buildSettleAuctionMsg,
  buildSettleFixedMsg,
} from './marketplaceAuction'

/** Same key as Rust `DAO_MESH_RECORD_KEY` / mesh storage. */
export const DAO_MESH_RECORD_KEY = MESH_STORAGE_KEY // 'mesh.v1'

export type DaoNipRecordKind =
  | 'mesh.v1'
  | 'nip15.fixed'
  | 'nip15.auction'
  | 'nip15.buy_now'
  | 'nip15.all'

/**
 * Curate mesh.v1 JSON for DAO set_item / billboard text record.
 * Prefer this over hand-rolled JSON in Marketplace **and** Calendar enable paths.
 *
 * Marketplace fields are only written when at least one marketplace input is set
 * (contract, content plane, denom, explicit modes, or minBufferBlocks). Calendar-only
 * enable therefore does not invent an empty marketplace block.
 */
export const curateMeshMarketplaceRecord = ({
  chainServices,
  fixedPrice,
  auction,
  nftCollections,
  contentBase,
  acceptedDenom,
  minBufferBlocks,
  modes,
  meshJson,
  calendar,
}: {
  chainServices: ChainMeshServices
  fixedPrice?: string
  auction?: string
  /** CW721 collections for TerpAuction auction_by_contract listing. */
  nftCollections?: string[]
  contentBase?: string
  acceptedDenom?: string
  minBufferBlocks?: number
  modes?: MeshMarketplaceV1['modes']
  /** Advanced: merge into existing mesh JSON */
  meshJson?: string | null
  calendar?: string
}): string => {
  const collections = (nftCollections ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
  const wantsMarketplace = !!(
    fixedPrice?.trim() ||
    auction?.trim() ||
    collections.length ||
    contentBase?.trim() ||
    acceptedDenom?.trim() ||
    modes ||
    typeof minBufferBlocks === 'number'
  )

  const marketplace: MeshMarketplaceV1 | undefined = wantsMarketplace
    ? {
        fixedPrice: fixedPrice?.trim() || undefined,
        auction: auction?.trim() || undefined,
        nftCollections: collections.length ? Array.from(new Set(collections)) : undefined,
        contentBase: contentBase?.trim() || undefined,
        acceptedDenom: acceptedDenom?.trim() || undefined,
        minBufferBlocks:
          typeof minBufferBlocks === 'number' && minBufferBlocks > 0
            ? minBufferBlocks
            : 7,
        modes: modes ?? ['fixed', 'auction', 'buy_now'],
      }
    : undefined

  if (meshJson?.trim()) {
    try {
      const parsed = parseMeshDescriptor(meshJson)
      const mesh: MeshDescriptorV1 = {
        ...parsed,
        // Prefer already-published calendar; fill from module enable when missing.
        calendar: parsed.calendar || calendar?.trim() || undefined,
        marketplace: marketplace
          ? mergeMeshMarketplace(parsed.marketplace, marketplace)
          : parsed.marketplace,
      }
      return serializeMeshDescriptor(mesh)
    } catch {
      /* fall through */
    }
  }

  return serializeMeshDescriptor(
    buildDefaultMeshDescriptor(chainServices, {
      calendar: calendar?.trim() || undefined,
      marketplace,
    })
  )
}

/**
 * Calendar enable path — same curator as marketplace; only sets `mesh.v1.calendar`.
 */
export const curateMeshCalendarRecord = ({
  chainServices,
  calendar,
  meshJson,
}: {
  chainServices: ChainMeshServices
  calendar?: string
  meshJson?: string | null
}): string =>
  curateMeshMarketplaceRecord({
    chainServices,
    calendar,
    meshJson,
  })

/**
 * CollabOps enable path — merge embeds.buzz / embeds.hermes into mesh.v1.
 * Never invents hosts; empty strings are omitted. Same key as storage + text record.
 * EN-F2: publish/read format compatible as Nostr event content (see collabDiscovery).
 */
export const curateMeshCollabRecord = ({
  chainServices,
  embedBuzz,
  embedHermes,
  meshJson,
}: {
  chainServices: ChainMeshServices
  embedBuzz?: string
  embedHermes?: string
  meshJson?: string | null
}): string => {
  const buzz = embedBuzz?.trim() || undefined
  const hermes = embedHermes?.trim() || undefined
  const hasEmbeds = !!(buzz || hermes)

  if (meshJson?.trim()) {
    try {
      const parsed = parseMeshDescriptor(meshJson)
      const mesh: MeshDescriptorV1 = {
        ...parsed,
        embeds: hasEmbeds
          ? mergeMeshEmbeds(parsed.embeds, { buzz, hermes })
          : parsed.embeds,
      }
      return serializeMeshDescriptor(mesh)
    } catch {
      /* fall through */
    }
  }

  return serializeMeshDescriptor(
    buildDefaultMeshDescriptor(chainServices, {
      embeds: hasEmbeds ? { buzz, hermes } : undefined,
    })
  )
}

/** NIP-15 progressive REQ filters (discovery only). */
export const curateNip15FilterHeuristic = (opts: {
  mode?: MarketplaceNostrMode
  dao?: string
  sku?: string
  auctionEventId?: string
  limit?: number
}): MarketplaceNostrFilter[] => buildMarketplaceNostrFilters(opts)

/** Chain msg heuristics for PlaceMarketplaceOrder / wallet. */
export const curateMarketplaceWasmMsg = (
  kind:
    | { type: 'purchase'; sku: string; qty: number }
    | { type: 'place_bid'; auctionId: string | number }
    | { type: 'settle_auction'; auctionId: string | number }
    | { type: 'settle_fixed'; orderId: number }
): Record<string, unknown> => {
  switch (kind.type) {
    case 'purchase':
      return buildPurchaseMsg(kind.sku, kind.qty)
    case 'place_bid':
      return buildPlaceBidMsg(kind.auctionId)
    case 'settle_auction':
      return buildSettleAuctionMsg(kind.auctionId)
    case 'settle_fixed':
      return buildSettleFixedMsg(kind.orderId)
  }
}

/**
 * Single-entry “record action” surface for FE (mirrors Rust DaoRecordAction).
 * Implementations return { key, value } ready for ManageStorageItems.
 */
export type DaoRecordPayload = {
  key: string
  value: string
  /** Optional progressive filters associated with this record */
  nostrFilters?: MarketplaceNostrFilter[]
}

export const daoRecordActionMesh = (params: {
  chainServices: ChainMeshServices
  fixedPrice?: string
  auction?: string
  contentBase?: string
  acceptedDenom?: string
  minBufferBlocks?: number
  dao?: string
}): DaoRecordPayload => {
  const value = curateMeshMarketplaceRecord(params)
  return {
    key: DAO_MESH_RECORD_KEY,
    value,
    nostrFilters: curateNip15FilterHeuristic({
      mode: 'all',
      dao: params.dao,
    }),
  }
}

/** Kind table for docs / UI chips — must match NIP-15 + marketplaceNostr. */
export const DAO_NIP15_KIND_TABLE = {
  stall: MARKETPLACE_NOSTR_KINDS.stall,
  product: MARKETPLACE_NOSTR_KINDS.product,
  auctionProduct: MARKETPLACE_NOSTR_KINDS.auctionProduct,
  bid: MARKETPLACE_NOSTR_KINDS.bid,
  bidConfirmation: MARKETPLACE_NOSTR_KINDS.bidConfirmation,
} as const

/** Collab discovery kind (NIP-78) — mesh.v1 content; not membership. */
export const DAO_COLLAB_DISCOVERY_KIND = COLLAB_DISCOVERY_KIND

/**
 * DaoRecordAction surface for CollabOps embeds → mesh.v1 (+ discovery filters).
 */
export const daoRecordActionCollab = (params: {
  chainServices: ChainMeshServices
  embedBuzz?: string
  embedHermes?: string
  meshJson?: string | null
  dao?: string
}): DaoRecordPayload => {
  const value = curateMeshCollabRecord(params)
  return {
    key: DAO_MESH_RECORD_KEY,
    value,
    nostrFilters: buildCollabDiscoveryFilters({ dao: params.dao }) as MarketplaceNostrFilter[],
  }
}

/**
 * EN-F6: register/upsert an event bounty board on mesh.v1.bounties.boards.
 * Same key as storage + billboard text-record; never invents embed hosts.
 */
export const daoRecordActionBountyBoard = (params: {
  chainServices: ChainMeshServices
  board: MeshBountyBoardV1
  meshJson?: string | null
}): DaoRecordPayload => {
  const value = curateMeshBountyBoardRecord(params)
  return {
    key: DAO_MESH_RECORD_KEY,
    value,
  }
}
