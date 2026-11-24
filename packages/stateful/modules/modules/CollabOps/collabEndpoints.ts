/**
 * Pure CollabOps endpoint cards from resolved mesh + module overrides.
 * Phase-1 info surface — no invented hosts, no live probes.
 */

import type { ResolvedMesh } from '@dao-dao/utils'

export type CollabEndpointKind = 'buzz' | 'hermes' | 'relay'

export type CollabEndpointCard = {
  id: string
  kind: CollabEndpointKind
  /** Human label */
  label: string
  /** Open URL (http/https) when available */
  url?: string
  /** WSS for Nostr relays */
  relayWss?: string
  /** mesh layer that supplied this row (hint only) */
  sourceHint: string
  plane: 'public' | 'private'
}

export type CollabEndpointsSnapshot = {
  publicCards: CollabEndpointCard[]
  privateCards: CollabEndpointCard[]
  /** True when public plane has no buzz embed and no relay */
  publicEmpty: boolean
  /** True when private plane has no hermes URL */
  privateEmpty: boolean
  meshSource?: string
  warnings: string[]
}

const isHttp = (s: string): boolean => {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const isWs = (s: string): boolean => {
  try {
    const u = new URL(s)
    return u.protocol === 'ws:' || u.protocol === 'wss:'
  } catch {
    return false
  }
}

const stripSlash = (s: string) => s.replace(/\/$/, '')

/**
 * Prefer module override → mesh.embeds → (nothing invented).
 */
export const buildCollabEndpoints = ({
  mesh,
  moduleBuzz,
  moduleHermes,
  moduleHermesDeepLink,
}: {
  mesh?: Pick<ResolvedMesh, 'embeds' | 'relays' | 'source' | 'warnings'> | null
  moduleBuzz?: string
  moduleHermes?: string
  moduleHermesDeepLink?: string
}): CollabEndpointsSnapshot => {
  const warnings = mesh?.warnings ? [...mesh.warnings] : []
  const sourceHint = mesh?.source ?? 'none'
  const publicCards: CollabEndpointCard[] = []
  const privateCards: CollabEndpointCard[] = []

  const buzz =
    moduleBuzz?.trim() ||
    mesh?.embeds?.buzz?.trim() ||
    ''
  if (buzz && isHttp(buzz)) {
    publicCards.push({
      id: 'buzz-embed',
      kind: 'buzz',
      label: 'Buzz collab',
      url: stripSlash(buzz),
      sourceHint: moduleBuzz?.trim() ? 'module' : sourceHint,
      plane: 'public',
    })
  }

  for (let i = 0; i < (mesh?.relays || []).length; i++) {
    const wss = (mesh!.relays[i] || '').trim()
    if (!wss || !isWs(wss)) continue
    let openUrl: string | undefined
    try {
      const u = new URL(wss)
      openUrl =
        u.protocol === 'ws:' ? `http://${u.host}` : `https://${u.host}`
    } catch {
      openUrl = undefined
    }
    publicCards.push({
      id: `relay-${i}`,
      kind: 'relay',
      label: `Nostr relay ${i + 1}`,
      url: openUrl,
      relayWss: wss,
      sourceHint,
      plane: 'public',
    })
  }

  const hermes =
    moduleHermes?.trim() ||
    moduleHermesDeepLink?.trim() ||
    mesh?.embeds?.hermes?.trim() ||
    ''
  if (hermes && isHttp(hermes)) {
    privateCards.push({
      id: 'hermes-ops',
      kind: 'hermes',
      label: 'Hermes ops',
      url: stripSlash(hermes),
      sourceHint:
        moduleHermes?.trim() || moduleHermesDeepLink?.trim()
          ? 'module'
          : sourceHint,
      plane: 'private',
    })
  }

  return {
    publicCards,
    privateCards,
    publicEmpty: publicCards.length === 0,
    privateEmpty: privateCards.length === 0,
    meshSource: mesh?.source,
    warnings,
  }
}
