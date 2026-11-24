/**
 * Content-plane resolve for off-chain listing / calendar bodies (M6).
 *
 * HTTP-first progressive path:
 * 1. Chain / query returns summary + optional content_cid (bare sha256)
 * 2. Resolve body via dual-index content plane (BUD sha256 primary)
 * 3. Nostr subscribe remains optional live enhancement — never required for catalog
 *
 * cid encoding (frozen with hash-market content::cid):
 * | Prefer | Form                 | Resolve                         |
 * |--------|----------------------|---------------------------------|
 * | Yes    | bare 64-hex          | GET {base}/content/{sha256}     |
 * | Opt    | bud: / sha256:       | strip → same                    |
 * | Opt    | budsha256: (demo)    | strip → same                    |
 * | Sec.   | ipfs: / ipfs://      | GET {base}/content/by-ipfs/{cid}|
 */

export type CidKind = 'bud_sha256' | 'ipfs'

export type ParsedCid = {
  kind: CidKind
  value: string
}

export type ContentPlaneUrls = {
  /** Public bud / hash-market base, e.g. https://hash.terp.network */
  contentBase: string
  /** Optional IPFS gateway prefix if dual-index miss */
  ipfsGateway?: string
}

const SHA256_HEX = /^[0-9a-fA-F]{64}$/

export function parseCid(raw: string): ParsedCid {
  const s = raw.trim()
  if (!s) throw new Error('empty cid')

  const lower = s.toLowerCase()
  if (
    lower.startsWith('bud:') ||
    lower.startsWith('sha256:') ||
    lower.startsWith('budsha256:')
  ) {
    const rest = s.slice(s.indexOf(':') + 1).replace(/^0x/i, '')
    if (!SHA256_HEX.test(rest)) {
      throw new Error(`invalid sha256 hex: ${rest}`)
    }
    return { kind: 'bud_sha256', value: rest.toLowerCase() }
  }
  if (lower.startsWith('ipfs://') || lower.startsWith('ipfs:')) {
    const rest = s
      .replace(/^ipfs:\/\//i, '')
      .replace(/^ipfs:/i, '')
      .replace(/^\//, '')
    if (!rest) throw new Error('empty ipfs cid')
    return { kind: 'ipfs', value: rest }
  }
  if (SHA256_HEX.test(s)) {
    return { kind: 'bud_sha256', value: s.toLowerCase() }
  }
  if (
    s.startsWith('Qm') ||
    s.startsWith('bafy') ||
    s.startsWith('bafk') ||
    s.startsWith('bafz')
  ) {
    return { kind: 'ipfs', value: s }
  }
  throw new Error(`unrecognized cid: ${s}`)
}

/** Relative path on content plane. */
export function contentPath(parsed: ParsedCid): string {
  if (parsed.kind === 'bud_sha256') return `/content/${parsed.value}`
  return `/content/by-ipfs/${parsed.value}`
}

/** Absolute resolve URL for fetch. */
export function contentResolveUrl(base: string, cid: string): string {
  const parsed = parseCid(cid)
  const b = base.replace(/\/$/, '')
  return `${b}${contentPath(parsed)}`
}

/**
 * Turn a listing media field into a browser-loadable URL.
 * - http(s) / data / blob → unchanged
 * - bud / sha256 / ipfs cid → content plane (or optional IPFS gateway for ipfs)
 * - unrecognized → original string (caller may still try as URL)
 */
export function resolveMediaUrl(
  raw: string | undefined | null,
  opts?: { contentBase?: string; ipfsGateway?: string }
): string | undefined {
  if (raw == null) return undefined
  const s = raw.trim()
  if (!s) return undefined

  const lower = s.toLowerCase()
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:')
  ) {
    return s
  }

  try {
    const parsed = parseCid(s)
    if (parsed.kind === 'ipfs' && opts?.ipfsGateway) {
      const gw = opts.ipfsGateway.replace(/\/$/, '')
      return `${gw}/${parsed.value}`
    }
    if (opts?.contentBase) {
      return contentResolveUrl(opts.contentBase, s)
    }
  } catch {
    /* not a cid — fall through */
  }
  return s
}

export type ResolveOffchainOptions = ContentPlaneUrls & {
  cid: string
  /** fetch impl (tests / SSR) */
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

/**
 * Fetch off-chain body bytes/text from the dual-index content plane.
 * Throws on HTTP error; callers should fall back to chain summary only.
 */
export async function resolveOffchainBody(
  opts: ResolveOffchainOptions
): Promise<{
  bytes: ArrayBuffer
  text: string
  url: string
  parsed: ParsedCid
}> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  if (!fetchImpl) {
    throw new Error('fetch not available')
  }
  const parsed = parseCid(opts.cid)
  const url = contentResolveUrl(opts.contentBase, opts.cid)
  const res = await fetchImpl(url, { signal: opts.signal })
  if (!res.ok) {
    if (parsed.kind === 'ipfs' && opts.ipfsGateway) {
      const gw = opts.ipfsGateway.replace(/\/$/, '')
      const alt = `${gw}/${parsed.value}`
      const res2 = await fetchImpl(alt, { signal: opts.signal })
      if (!res2.ok) {
        throw new Error(
          `content plane ${res.status}; ipfs gateway ${res2.status}`
        )
      }
      const bytes = await res2.arrayBuffer()
      return {
        bytes,
        text: new TextDecoder().decode(bytes),
        url: alt,
        parsed,
      }
    }
    throw new Error(`content plane HTTP ${res.status} for ${url}`)
  }
  const bytes = await res.arrayBuffer()
  return {
    bytes,
    text: new TextDecoder().decode(bytes),
    url,
    parsed,
  }
}

/**
 * Progressive body: prefer on-chain fields; if off-chain + cid, resolve via content plane.
 * Never throws for "missing" — returns source none. Network errors rethrow for caller toast.
 */
export async function resolveEventBodyProgressive(opts: {
  on_chain: boolean
  e?: string | Record<string, unknown> | null
  cid?: string | null
  contentBase?: string
  ipfsGateway?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<{
  source: 'on_chain' | 'content_plane' | 'none'
  body: unknown
}> {
  if (opts.on_chain && opts.e != null) {
    if (typeof opts.e === 'string') {
      try {
        return { source: 'on_chain', body: JSON.parse(opts.e) }
      } catch {
        return { source: 'on_chain', body: opts.e }
      }
    }
    return { source: 'on_chain', body: opts.e }
  }
  if (!opts.on_chain && opts.cid && opts.contentBase) {
    const { text } = await resolveOffchainBody({
      cid: opts.cid,
      contentBase: opts.contentBase,
      ipfsGateway: opts.ipfsGateway,
      fetchImpl: opts.fetchImpl,
      signal: opts.signal,
    })
    try {
      return { source: 'content_plane', body: JSON.parse(text) }
    } catch {
      return { source: 'content_plane', body: text }
    }
  }
  return { source: 'none', body: null }
}

/** Fields we enrich from content-plane listing JSON (hash-market / NIP-15-ish). */
export type MarketplaceContentBody = {
  title?: string
  name?: string
  description?: string
  image?: string
  image_url?: string
  images?: string[]
}

export const parseMarketplaceContentBody = (
  body: unknown
): MarketplaceContentBody | undefined => {
  if (!body || typeof body !== 'object') return undefined
  const o = body as Record<string, unknown>
  const out: MarketplaceContentBody = {}
  if (typeof o.title === 'string') out.title = o.title
  if (typeof o.name === 'string') out.name = o.name
  if (typeof o.description === 'string') out.description = o.description
  if (typeof o.image === 'string') out.image = o.image
  if (typeof o.image_url === 'string') out.image_url = o.image_url
  if (Array.isArray(o.images)) {
    out.images = o.images.filter((x): x is string => typeof x === 'string')
  }
  if (
    !out.title &&
    !out.name &&
    !out.description &&
    !out.image &&
    !out.image_url &&
    !(out.images && out.images.length)
  ) {
    return undefined
  }
  return out
}

/**
 * Merge content-plane body into a catalog row without clobbering chain money fields.
 * Title: prefer content title/name when chain title is still the sku default.
 * Images: resolve bud/ipfs cids via content plane when `contentBase` is set.
 */
export function enrichListingFromContentBody<
  T extends {
    title: string
    description?: string
    imageUrl?: string
    sku?: string
    contentCid?: string
  },
>(
  listing: T,
  body: MarketplaceContentBody,
  mediaOpts?: { contentBase?: string; ipfsGateway?: string }
): T {
  const contentTitle = body.title?.trim() || body.name?.trim()
  const rawImage =
    body.image_url?.trim() ||
    body.image?.trim() ||
    body.images?.find((u) => !!u?.trim())?.trim()

  const image = resolveMediaUrl(rawImage, mediaOpts) || rawImage

  const titleIsSkuDefault =
    !!listing.sku && listing.title === listing.sku

  return {
    ...listing,
    title:
      contentTitle && (titleIsSkuDefault || !listing.title)
        ? contentTitle
        : listing.title,
    description:
      body.description?.trim() || listing.description,
    imageUrl: image || listing.imageUrl,
  }
}
