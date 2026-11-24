/**
 * Pure embed URL / deep-link policy helpers for HermesOps (no React).
 * Safe for unit tests.
 */

/**
 * Build Hermes ops embed URL:
 * `{embedBase}/hermes/embed?dao=&chain=&parent=daodao&auth=member-gate&view=`
 */
export const buildHermesOpsEmbedUrl = ({
  embedBase,
  daoAddress,
  chainId,
  defaultView,
  boardSlug,
}: {
  embedBase: string
  daoAddress: string
  chainId: string
  defaultView: 'kanban' | 'gateway' | 'status'
  /** Optional Hermes kanban board label (CommunityInfra / EventHub bridge). */
  boardSlug?: string
}): string => {
  const base = embedBase.replace(/\/$/, '')
  const path = base.endsWith('/hermes')
    ? `${base}/embed`
    : `${base}/hermes/embed`
  const url = new URL(path)
  url.searchParams.set('dao', daoAddress)
  url.searchParams.set('chain', chainId)
  url.searchParams.set('view', defaultView)
  url.searchParams.set('parent', 'daodao')
  url.searchParams.set('auth', 'member-gate')
  if (boardSlug?.trim()) {
    url.searchParams.set('board', boardSlug.trim())
  }
  return url.toString()
}

/**
 * Shell mount policy for Hermes Ops honesty UI.
 * - deep_link_only: module flag says no iframe (default-safe)
 * - embed_missing: iframe requested but no usable embed origin
 * - iframe: mount bridge + iframe
 */
export type HermesShellMode = 'deep_link_only' | 'embed_missing' | 'iframe'

export const resolveHermesShellMode = ({
  deepLinkOnly,
  embedOrigin,
}: {
  deepLinkOnly: boolean
  embedOrigin: string
}): HermesShellMode => {
  if (deepLinkOnly) {
    return 'deep_link_only'
  }
  if (!embedOrigin) {
    return 'embed_missing'
  }
  return 'iframe'
}

/**
 * Whether to skip the iframe (deep-link CTA or missing embed).
 * deepLinkOnly wins; empty/invalid embed origin also skips iframe.
 */
export const shouldUseDeepLinkOnly = ({
  deepLinkOnly,
  embedOrigin,
}: {
  deepLinkOnly: boolean
  embedOrigin: string
}): boolean =>
  resolveHermesShellMode({ deepLinkOnly, embedOrigin }) !== 'iframe'
