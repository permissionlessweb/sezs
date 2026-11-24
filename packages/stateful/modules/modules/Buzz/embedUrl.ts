/**
 * Pure embed URL helpers for Buzz (no React). Safe for unit tests.
 */

export const buildBuzzEmbedUrl = ({
  embedBase,
  daoAddress,
  chainId,
  defaultView,
}: {
  embedBase: string
  daoAddress: string
  chainId: string
  defaultView: 'public' | 'event' | 'admin'
}): string => {
  const base = embedBase.replace(/\/$/, '')
  const url = new URL(`${base}/embed`)
  url.searchParams.set('dao', daoAddress)
  url.searchParams.set('chain', chainId)
  url.searchParams.set('view', defaultView)
  url.searchParams.set('parent', 'daodao')
  url.searchParams.set('auth', 'nostr')
  return url.toString()
}
