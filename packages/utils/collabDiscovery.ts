/**
 * CollabOps discovery — mesh.v1 as Nostr-compatible event payload.
 *
 * DAO discovery for Buzz (public) + Hermes (private) stays on **one key**:
 * `mesh.v1` (storage and/or billboard text record). Identity planes are not
 * merged: Nostr session ≠ ADR-36 ≠ Headscale ≠ Hermes profile.
 *
 * EN-F2 / t_8365ea2e · mesh policy:
 * docs/superpowers/reviews/2026-08-06-text-record-mesh-endpoint-policy.md
 *
 * Kind 30078 = NIP-78 application-specific data (parameterized replaceable).
 * Content is mesh.v1 JSON; tags identify DAO + app namespace for progressive REQ.
 */

import {
  MeshDescriptorV1,
  MESH_STORAGE_KEY,
  parseMeshDescriptor,
  serializeMeshDescriptor,
} from './mesh'

/** NIP-78 application-specific data (parameterized replaceable). */
export const COLLAB_DISCOVERY_KIND = 30078 as const

/** App id for #d / #t tags — progressive discovery only. */
export const COLLAB_DISCOVERY_APP = 'terp-collab-ops/v1' as const

export type CollabDiscoveryNostrEventDraft = {
  kind: typeof COLLAB_DISCOVERY_KIND
  /** mesh.v1 JSON (same bytes as DAO storage / text record). */
  content: string
  tags: string[][]
  /** Optional; callers set when publishing. */
  created_at?: number
}

export type CollabDiscoveryNostrFilter = {
  kinds: number[]
  limit?: number
  '#t'?: string[]
  '#d'?: string[]
  authors?: string[]
}

/**
 * Build a Nostr event *draft* whose content is mesh.v1 JSON.
 * Does not sign; does not invent relays or embeds.
 */
export const buildCollabDiscoveryEvent = ({
  mesh,
  dao,
  chainId,
  createdAt,
}: {
  mesh: MeshDescriptorV1
  dao?: string
  chainId?: string
  createdAt?: number
}): CollabDiscoveryNostrEventDraft => {
  const content = serializeMeshDescriptor(mesh)
  const tags: string[][] = [
    ['d', COLLAB_DISCOVERY_APP],
    ['t', 'mesh.v1'],
    ['t', 'collab-ops'],
    ['t', COLLAB_DISCOVERY_APP],
  ]
  if (dao?.trim()) {
    tags.push(['t', dao.trim()])
    tags.push(['dao', dao.trim()])
  }
  if (chainId?.trim()) {
    tags.push(['chain_id', chainId.trim()])
  }
  // Hint planes without merging identity roots.
  tags.push(['plane', 'public:buzz'])
  tags.push(['plane', 'private:hermes'])

  return {
    kind: COLLAB_DISCOVERY_KIND,
    content,
    tags,
    ...(typeof createdAt === 'number' ? { created_at: createdAt } : {}),
  }
}

/**
 * Parse discovery event content (or raw mesh.v1 text record) → descriptor.
 * Throws if JSON is not a valid mesh.v1 (same rules as parseMeshDescriptor).
 */
export const parseCollabDiscoveryContent = (
  content: string
): MeshDescriptorV1 => parseMeshDescriptor(content)

/**
 * Progressive REQ filters for collab mesh discovery (subscribe-only).
 * Never used as an identity plane or membership proof.
 */
export const buildCollabDiscoveryFilters = ({
  dao,
  limit = 20,
}: {
  dao?: string
  limit?: number
} = {}): CollabDiscoveryNostrFilter[] => {
  const tags = ['mesh.v1', 'collab-ops', COLLAB_DISCOVERY_APP]
  if (dao?.trim()) tags.push(dao.trim())
  return [
    {
      kinds: [COLLAB_DISCOVERY_KIND],
      '#t': tags,
      '#d': [COLLAB_DISCOVERY_APP],
      limit,
    },
  ]
}

/** True when content looks like publishable mesh.v1 for collab discovery. */
export const isCollabDiscoveryPayload = (content: string): boolean => {
  try {
    parseMeshDescriptor(content)
    return true
  } catch {
    return false
  }
}

/** Storage / text-record key — same SoT as mesh.v1. */
export const COLLAB_DISCOVERY_RECORD_KEY = MESH_STORAGE_KEY
