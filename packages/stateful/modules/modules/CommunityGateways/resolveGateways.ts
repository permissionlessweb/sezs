/**
 * Pure resolution of gateway directory rows from module config + mesh.v1.
 */

import { MeshDescriptorV1, parseMeshDescriptor } from '@dao-dao/utils'

import type { CommunityGatewaysModuleData, GatewayEntry } from './types'

const isHttpUrl = (s: string): boolean => {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const isWsUrl = (s: string): boolean => {
  try {
    const u = new URL(s)
    return u.protocol === 'ws:' || u.protocol === 'wss:'
  } catch {
    return false
  }
}

/** Normalize entry; drop invalid URLs. */
export const normalizeGatewayEntry = (
  raw: Partial<GatewayEntry> | null | undefined
): GatewayEntry | null => {
  if (!raw || typeof raw !== 'object') return null
  const url = (raw.url || '').trim()
  if (!url || !isHttpUrl(url)) return null
  const kind = raw.kind === 'hermes' ? 'hermes' : 'buzz'
  const id =
    (raw.id || '').trim() ||
    `${kind}-${url.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 48)}`
  const label =
    (raw.label || '').trim() || (kind === 'buzz' ? 'Buzz' : 'Hermes')
  const visibility =
    raw.visibility === 'registered' ||
    raw.visibility === 'members' ||
    raw.visibility === 'operators'
      ? raw.visibility
      : 'public'
  const relayWss = (raw.relayWss || '').trim()
  return {
    id,
    kind,
    label,
    url: url.replace(/\/$/, ''),
    ...(relayWss && isWsUrl(relayWss) ? { relayWss } : {}),
    visibility,
    ...(raw.note?.trim() ? { note: raw.note.trim() } : {}),
  }
}

/**
 * Derive gateway rows from a mesh descriptor (embeds + relays).
 * Relay-only rows get synthetic https URL when only wss is known (link note).
 */
export const gatewaysFromMesh = (
  mesh: MeshDescriptorV1 | null | undefined
): GatewayEntry[] => {
  if (!mesh) return []
  const out: GatewayEntry[] = []
  const buzzHttp = mesh.embeds?.buzz?.trim()
  if (buzzHttp && isHttpUrl(buzzHttp)) {
    out.push({
      id: 'mesh-buzz-embed',
      kind: 'buzz',
      label: 'DAO mesh · Buzz',
      url: buzzHttp.replace(/\/$/, ''),
      visibility: 'registered',
      note: 'From mesh.v1 embeds.buzz (registered community surface).',
    })
  }
  const hermesHttp = mesh.embeds?.hermes?.trim()
  if (hermesHttp && isHttpUrl(hermesHttp)) {
    out.push({
      id: 'mesh-hermes',
      kind: 'hermes',
      label: 'DAO mesh · Hermes',
      url: hermesHttp.replace(/\/$/, ''),
      visibility: 'operators',
      note: 'From mesh.v1 embeds.hermes — open externally; not embedded in SDA yet.',
    })
  }
  for (let i = 0; i < (mesh.relays || []).length; i++) {
    const wss = (mesh.relays[i] || '').trim()
    if (!wss || !isWsUrl(wss)) continue
    // Prefer http(s) sibling for "open" when relay is wss://host
    let openUrl = ''
    try {
      const u = new URL(wss)
      openUrl = `https://${u.host}`
      if (u.protocol === 'ws:') openUrl = `http://${u.host}`
    } catch {
      continue
    }
    out.push({
      id: `mesh-relay-${i}`,
      kind: 'buzz',
      label: `DAO mesh · Nostr relay ${i + 1}`,
      url: openUrl,
      relayWss: wss,
      visibility: 'registered',
      note: 'Relay plane from mesh.v1 relays — connect clients via WSS; do not iframe the relay root.',
    })
  }
  return out
}

const dedupeKey = (g: GatewayEntry): string =>
  `${g.kind}|${g.url}|${g.relayWss || ''}`

/**
 * Merge curated module entries with optional mesh-derived gateways.
 * Module entries win on id collision; mesh fills gaps.
 */
export const resolveGatewayDirectory = (opts: {
  data: Pick<
    CommunityGatewaysModuleData,
    'gateways' | 'useChainMeshDefault' | 'meshJson'
  >
  /** On-chain / lab-injected mesh JSON string when useChainMeshDefault. */
  chainMeshJson?: string | null
}): GatewayEntry[] => {
  const curated = (opts.data.gateways || [])
    .map((g) => normalizeGatewayEntry(g))
    .filter((g): g is GatewayEntry => !!g)

  let meshRows: GatewayEntry[] = []
  if (opts.data.useChainMeshDefault) {
    const raw = opts.data.meshJson?.trim() || opts.chainMeshJson?.trim() || ''
    if (raw) {
      try {
        meshRows = gatewaysFromMesh(parseMeshDescriptor(raw))
      } catch {
        meshRows = []
      }
    }
  }

  const seen = new Set<string>()
  const out: GatewayEntry[] = []
  for (const g of [...curated, ...meshRows]) {
    const k = dedupeKey(g)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(g)
  }
  return out
}

export const partitionGateways = (
  list: GatewayEntry[]
): { buzz: GatewayEntry[]; hermes: GatewayEntry[] } => ({
  buzz: list.filter((g) => g.kind === 'buzz'),
  hermes: list.filter((g) => g.kind === 'hermes'),
})
