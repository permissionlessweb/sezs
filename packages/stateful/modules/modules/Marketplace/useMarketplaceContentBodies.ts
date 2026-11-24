import { useEffect, useMemo, useState } from 'react'

import {
  NormalizedMarketplaceListing,
  enrichListingFromContentBody,
  parseCid,
  parseMarketplaceContentBody,
  resolveOffchainBody,
} from '@dao-dao/utils'

export type ListingContentStatus = 'idle' | 'loading' | 'ready' | 'error' | 'skipped'

export type ListingContentMeta = {
  status: ListingContentStatus
  /** True when body came from content plane successfully */
  fromContentPlane: boolean
  error?: string
}

/**
 * M6: Progressive content_cid resolve.
 * Catalog rows render immediately from chain/demo; media/title enrich async.
 * Failures never remove or block listings.
 */
export function useMarketplaceContentBodies({
  listings,
  contentBase,
  enabled = true,
}: {
  listings: NormalizedMarketplaceListing[]
  contentBase?: string
  enabled?: boolean
}): {
  listings: NormalizedMarketplaceListing[]
  metaById: Record<string, ListingContentMeta>
  resolving: number
} {
  const [enriched, setEnriched] = useState<
    Record<string, NormalizedMarketplaceListing>
  >({})
  const [metaById, setMetaById] = useState<Record<string, ListingContentMeta>>(
    {}
  )

  const targets = useMemo(() => {
    if (!enabled || !contentBase) return []
    return listings.filter((l) => !!l.contentCid && !!l.id)
  }, [listings, contentBase, enabled])

  const targetKey = targets.map((t) => `${t.id}:${t.contentCid}`).join('|')

  useEffect(() => {
    if (!enabled || !contentBase || !targets.length) {
      return
    }

    const ac = new AbortController()
    let cancelled = false

    // Mark loading without clearing prior good enrichments for same id
    setMetaById((prev) => {
      const next = { ...prev }
      for (const t of targets) {
        if (next[t.id]?.status === 'ready' && next[t.id]?.fromContentPlane) {
          continue
        }
        next[t.id] = { status: 'loading', fromContentPlane: false }
      }
      return next
    })

    ;(async () => {
      await Promise.all(
        targets.map(async (listing) => {
          const cid = listing.contentCid!
          try {
            // Demo / placeholder cids (e.g. budsha256:aaa) fail parse — skip quietly
            try {
              parseCid(cid)
            } catch (parseErr) {
              setMetaById((prev) => ({
                ...prev,
                [listing.id]: {
                  status: 'skipped',
                  fromContentPlane: false,
                  error:
                    parseErr instanceof Error
                      ? parseErr.message
                      : String(parseErr),
                },
              }))
              return
            }
            const { text } = await resolveOffchainBody({
              cid,
              contentBase,
              signal: ac.signal,
            })
            if (cancelled) return
            let body: unknown = text
            try {
              body = JSON.parse(text)
            } catch {
              /* keep text */
            }
            const parsed = parseMarketplaceContentBody(body)
            if (parsed) {
              const row = enrichListingFromContentBody(listing, parsed, {
                contentBase,
              })
              setEnriched((prev) => ({ ...prev, [listing.id]: row }))
              setMetaById((prev) => ({
                ...prev,
                [listing.id]: { status: 'ready', fromContentPlane: true },
              }))
            } else {
              setMetaById((prev) => ({
                ...prev,
                [listing.id]: {
                  status: 'ready',
                  fromContentPlane: false,
                },
              }))
            }
          } catch (err) {
            if (cancelled || (err instanceof Error && err.name === 'AbortError')) {
              return
            }
            setMetaById((prev) => ({
              ...prev,
              [listing.id]: {
                status: 'error',
                fromContentPlane: false,
                error: err instanceof Error ? err.message : String(err),
              },
            }))
          }
        })
      )
    })()

    return () => {
      cancelled = true
      ac.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey captures listing/cid set
  }, [targetKey, contentBase, enabled])

  const merged = useMemo(() => {
    return listings.map((l) => enriched[l.id] ?? l)
  }, [listings, enriched])

  const resolving = Object.values(metaById).filter(
    (m) => m.status === 'loading'
  ).length

  return { listings: merged, metaById, resolving }
}
