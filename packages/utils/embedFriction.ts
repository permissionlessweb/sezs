/**
 * Shared embed / mesh friction taxonomy for multi-surface shells (Event Hub, etc.).
 *
 * Codes align with F0 inventory:
 * docs/superpowers/orch/community-collab-stabilize-2026-07-20/STATUS-F0-INVENTORY.md
 *
 * Pure helpers only — no hosts invented, no React.
 */

export type EmbedFrictionCode =
  | 'EMBED_MISSING'
  | 'MESH_RESOLVE_FAILED'
  | 'HOST_UNREACHABLE'
  | 'ORIGIN_MISMATCH'
  | 'DEEP_LINK_ONLY'
  | 'LAB_ONLY'
  /** Configured base is a Nostr/NIP-11 relay root, not a terp-buzz/v1 embed shell. */
  | 'RELAY_NOT_EMBED'

/** Surface slot that needs an embed base (Work / Collab / Ops). */
export type EmbedFrictionSurface = 'bounties' | 'buzz' | 'hermes'

export type EmbedFrictionDescription = {
  /** Stable F0 taxonomy code shown in product chrome. */
  code: EmbedFrictionCode
  /**
   * Stable message key for i18n / unit tests (not necessarily a locale file entry).
   * Format: `friction.<code>` or `friction.<code>.<surface>`.
   */
  messageKey: string
  /** Default English copy for defaultValue / tests. */
  defaultMessage: string
  /** Optional surface when code is surface-scoped. */
  surface?: EmbedFrictionSurface
}

const SURFACE_LABEL: Record<EmbedFrictionSurface, string> = {
  bounties: 'bounties',
  buzz: 'buzz',
  hermes: 'hermes',
}

const SURFACE_MESH_FIELD: Record<EmbedFrictionSurface, string> = {
  bounties: 'embeds.bounties',
  buzz: 'embeds.buzz',
  hermes: 'embeds.hermes',
}

/**
 * Describe friction for a taxonomy code so UI and tests share copy keys.
 *
 * Does not invent embed hosts — only returns operator-facing copy.
 */
export const describeEmbedFriction = (
  code: EmbedFrictionCode,
  options?: {
    surface?: EmbedFrictionSurface
    /** Appended after the base message when present (e.g. MeshResolveError.message). */
    detail?: string
  }
): EmbedFrictionDescription => {
  const surface = options?.surface
  const detail = options?.detail?.trim()

  switch (code) {
    case 'EMBED_MISSING': {
      if (surface) {
        return {
          code,
          surface,
          messageKey: `friction.EMBED_MISSING.${surface}`,
          defaultMessage: `No ${SURFACE_LABEL[surface]} embed base URL — set the module field or mesh.v1 ${SURFACE_MESH_FIELD[surface]}.`,
        }
      }
      return {
        code,
        messageKey: 'friction.EMBED_MISSING',
        defaultMessage:
          'No embed base URL — set module field or mesh.v1 embeds',
      }
    }
    case 'MESH_RESOLVE_FAILED': {
      const base =
        'Could not resolve mesh.v1. Check DAO storage item mesh.v1, module mesh JSON, or chain headstash defaults.'
      return {
        code,
        messageKey: 'friction.MESH_RESOLVE_FAILED',
        defaultMessage: detail ? `${base} ${detail}` : base,
      }
    }
    case 'HOST_UNREACHABLE':
      return {
        code,
        surface,
        messageKey: surface
          ? `friction.HOST_UNREACHABLE.${surface}`
          : 'friction.HOST_UNREACHABLE',
        defaultMessage:
          'Embed host never sent ready (timeout). Confirm the surface is deployed and origin allows postMessage.',
      }
    case 'ORIGIN_MISMATCH':
      return {
        code,
        surface,
        messageKey: surface
          ? `friction.ORIGIN_MISMATCH.${surface}`
          : 'friction.ORIGIN_MISMATCH',
        defaultMessage:
          'postMessage origin mismatch — iframe origin must match the configured embed base.',
      }
    case 'DEEP_LINK_ONLY':
      return {
        code,
        surface: surface ?? 'hermes',
        messageKey: 'friction.DEEP_LINK_ONLY',
        defaultMessage:
          'Ops is deep-link only for this DAO — no iframe embed is mounted.',
      }
    case 'LAB_ONLY':
      return {
        code,
        messageKey: 'friction.LAB_ONLY',
        defaultMessage:
          'Lab / staging surface only — not a public multi-tenant claim.',
      }
    case 'RELAY_NOT_EMBED':
      return {
        code,
        surface: surface ?? 'buzz',
        messageKey: surface
          ? `friction.RELAY_NOT_EMBED.${surface}`
          : 'friction.RELAY_NOT_EMBED',
        defaultMessage: detail
          ? `Collab embed is pending: configured host is a Nostr/NIP-11 relay root, not a terp-buzz/v1 embed shell. Set module buzz embed or mesh.embeds.buzz to the embed UI base (lab: NEXT_PUBLIC_BUZZ_EMBED / :3001). Got: ${detail}`
          : 'Collab embed is pending: configured host is a Nostr/NIP-11 relay root, not a terp-buzz/v1 embed shell. Set module buzz embed or mesh.embeds.buzz to the embed UI base (lab: NEXT_PUBLIC_BUZZ_EMBED / :3001).',
      }
    default: {
      // Exhaustiveness: unknown codes still return a stable shape.
      const _exhaustive: never = code
      return {
        code: _exhaustive,
        messageKey: `friction.${String(code)}`,
        defaultMessage: String(code),
      }
    }
  }
}

/**
 * True when a configured embed base string is non-empty after trim.
 * Does not validate URL shape or invent defaults.
 */
export const hasEmbedBase = (embedBase?: string | null): boolean =>
  typeof embedBase === 'string' && embedBase.trim().length > 0

/**
 * Lab Nostr / Buzz dual **relay** HTTP origin (NIP-11 + ws) on deploy-host.
 * This is NOT the iframe embed shell — never use as `iframe src` base.
 * Lab embed shell: LAB_BUZZ_DUAL_HTTP / resolveLabBuzzEmbedShell() in labTopology.ts.
 */
export const LAB_BUZZ_RELAY_HTTP_ORIGIN = 'http://localhost:3000'

/**
 * Normalize a http(s) or ws(s) URL to its http(s) origin for host comparison.
 * Returns empty string if unparseable.
 */
export const httpOriginFromMaybeWsUrl = (raw?: string | null): string => {
  if (!raw || typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const u = new URL(trimmed)
    if (u.protocol === 'ws:') u.protocol = 'http:'
    else if (u.protocol === 'wss:') u.protocol = 'https:'
    return u.origin
  } catch {
    return ''
  }
}

/**
 * True when `embedBase` is a known Nostr/NIP-11 **relay root**, not an embed shell.
 *
 * Does not invent hosts. Uses:
 * - lab dual-relay origin localhost:3000
 * - optional `knownRelayOrigins` (e.g. from NEXT_PUBLIC_BUZZ_WSS / headstashWss)
 */
export const isNostrRelayRootAsEmbedBase = (
  embedBase?: string | null,
  options?: {
    /** Extra http(s) or ws(s) origins that are relays, not embed shells. */
    knownRelayOrigins?: Array<string | null | undefined>
  }
): boolean => {
  if (!hasEmbedBase(embedBase)) return false
  const origin = httpOriginFromMaybeWsUrl(embedBase)
  if (!origin) return false

  const known = new Set<string>([LAB_BUZZ_RELAY_HTTP_ORIGIN])
  for (const extra of options?.knownRelayOrigins ?? []) {
    const o = httpOriginFromMaybeWsUrl(extra)
    if (o) known.add(o)
  }
  return known.has(origin)
}

/**
 * Pick first non-empty embed base that is **not** a Nostr relay root.
 * Candidates are tried in order (module → mesh → chain). Does not invent hosts.
 */
export const pickBuzzEmbedShellBase = (
  candidates: Array<string | null | undefined>,
  options?: {
    knownRelayOrigins?: Array<string | null | undefined>
  }
): string | undefined => {
  for (const c of candidates) {
    if (!hasEmbedBase(c)) continue
    if (isNostrRelayRootAsEmbedBase(c, options)) continue
    return c!.trim().replace(/\/$/, '')
  }
  return undefined
}

/**
 * True when at least one candidate is non-empty but every non-empty candidate
 * is a known relay root (soft-pending / RELAY_NOT_EMBED case).
 */
export const onlyBuzzRelayConfigured = (
  candidates: Array<string | null | undefined>,
  options?: {
    knownRelayOrigins?: Array<string | null | undefined>
  }
): boolean => {
  const nonEmpty = candidates.filter((c) => hasEmbedBase(c))
  if (nonEmpty.length === 0) return false
  return nonEmpty.every((c) => isNostrRelayRootAsEmbedBase(c, options))
}
