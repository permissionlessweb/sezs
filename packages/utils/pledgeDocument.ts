/**
 * TrustlessPledge document resolution helpers.
 *
 * Resolve manifesto / team-variant content from CID or URI via an IPFS gateway,
 * classify HTML vs Markdown, and keep ETH contractURI/tokenURI wiring pure so
 * the module can render static body without Fileverse-only UX.
 *
 * Spec epic: ETH URI → static HTML/MD in SDA (TP-HTML-2 / TP-ETH-1).
 */

/** Default public gateway used when module/env does not override. */
export const PLEDGE_DEFAULT_IPFS_GATEWAY = 'https://ipfs.terp.network/ipfs/'

export type PledgeDocKind = 'html' | 'markdown' | 'unknown'

export type ResolvedPledgeDocUrl = {
  /** HTTPS (or gateway) URL ready for fetch / link */
  url: string
  /** Normalized CID if known (no scheme) */
  cid?: string
  /** Original input after trim */
  source: string
}

/**
 * Join gateway base + CID (or absolute URI).
 * Accepts:
 * - bare CID (`bafy…`, `Qm…`)
 * - `ipfs://CID[/path]`
 * - `/ipfs/CID[/path]`
 * - already-absolute `https://…`
 */
export const resolvePledgeDocUrl = (
  uriOrCid: string | undefined | null,
  gateway: string | undefined | null = PLEDGE_DEFAULT_IPFS_GATEWAY
): ResolvedPledgeDocUrl | null => {
  const raw = (uriOrCid || '').trim()
  if (!raw) {
    return null
  }

  // Absolute HTTP(S) — use as-is.
  if (/^https?:\/\//i.test(raw)) {
    return { url: raw, source: raw }
  }

  const base = (gateway || PLEDGE_DEFAULT_IPFS_GATEWAY).replace(/\/?$/, '/')

  // ipfs://CID[/path]
  if (raw.toLowerCase().startsWith('ipfs://')) {
    const rest = raw.slice('ipfs://'.length).replace(/^ipfs\//i, '')
    const cid = rest.split('/')[0] || undefined
    return {
      url: `${base}${rest.replace(/^\//, '')}`,
      cid,
      source: raw,
    }
  }

  // /ipfs/CID[/path]
  if (raw.startsWith('/ipfs/')) {
    const rest = raw.slice('/ipfs/'.length)
    const cid = rest.split('/')[0] || undefined
    return {
      url: `${base}${rest}`,
      cid,
      source: raw,
    }
  }

  // Bare CID or CID/path
  const cid = raw.split('/')[0] || undefined
  return {
    url: `${base}${raw.replace(/^\//, '')}`,
    cid,
    source: raw,
  }
}

/**
 * Heuristic content-type from HTTP Content-Type header and/or body sniff.
 */
export const detectPledgeDocKind = (
  body: string,
  contentType?: string | null
): PledgeDocKind => {
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('text/html') || ct.includes('application/xhtml')) {
    return 'html'
  }
  if (
    ct.includes('text/markdown') ||
    ct.includes('text/x-markdown') ||
    ct.includes('text/plain')
  ) {
    // text/plain may still be HTML — sniff below
    if (!ct.includes('text/plain')) {
      return 'markdown'
    }
  }

  const sample = body.slice(0, 512).trimStart().toLowerCase()
  if (
    sample.startsWith('<!doctype html') ||
    sample.startsWith('<html') ||
    /^<[a-z!]/.test(sample)
  ) {
    // Prefer markdown if it looks like MD with occasional tags; common HTML roots win.
    if (
      sample.startsWith('<!doctype') ||
      sample.startsWith('<html') ||
      sample.startsWith('<head') ||
      sample.startsWith('<body') ||
      sample.startsWith('<article') ||
      sample.startsWith('<main') ||
      sample.startsWith('<section') ||
      sample.startsWith('<div') ||
      sample.startsWith('<p')
    ) {
      return 'html'
    }
  }

  // Markdown signals
  if (
    sample.startsWith('#') ||
    sample.startsWith('---') ||
    sample.includes('\n# ') ||
    sample.includes('\n## ')
  ) {
    return 'markdown'
  }

  // Default: treat as markdown (MarkdownRenderer + rehypeSanitize handles light HTML)
  if (body.trim()) {
    return 'markdown'
  }

  return 'unknown'
}

export type FetchedPledgeDoc = {
  kind: PledgeDocKind
  text: string
  url: string
  contentType?: string
}

/**
 * Fetch pledge document text from a resolved URL.
 * Callers should gate on browser / client; throws on network failure.
 */
export const fetchPledgeDocument = async (
  url: string,
  init?: RequestInit
): Promise<FetchedPledgeDoc> => {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'text/html, text/markdown, text/plain, */*',
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch pledge document (${res.status})`)
  }
  const contentType = res.headers.get('content-type') || undefined
  const text = await res.text()
  return {
    kind: detectPledgeDocKind(text, contentType),
    text,
    url,
    contentType,
  }
}

/**
 * Optional ETH SSOT shape for module / DAO text-record discovery.
 * Addresses must come from deploy inventory — never invent.
 */
export type PledgeEthContractSsot = {
  /** EVM chain id (1 = mainnet). Omit when unknown. */
  chainId?: number
  /** ERC-721 (or ERC-1155) contract address — only when verified */
  contract?: string
  /** Prefer tokenURI(tokenId) for document NFT */
  documentTokenId?: string
  /** Prefer tokenURI for team-variant NFT */
  teamTokenId?: string
  /** contractURI when collection-level metadata holds the manifesto */
  useContractUri?: boolean
  /** RPC URL env key name (not the secret itself) */
  rpcEnvKey?: string
  /** Status of inventory */
  status: 'unknown' | 'partial' | 'verified'
  notes?: string
}

/**
 * Known inventory as of 2026-08-07. Do not treat empty contract as deployable.
 * Fileverse workspace `0x421f908d9f6bcac09ed3539fae6261f88dc87fe0` is a **doc host id**,
 * not a proven ERC-721 for tokenURI.
 */
export const PLEDGE_ETH_SSOT: PledgeEthContractSsot = {
  status: 'unknown',
  rpcEnvKey: 'NEXT_PUBLIC_PLEDGE_ETH_RPC',
  notes:
    'No verified ETH NFT contract address in dao-dao-ui / permissionless.money source as of epic kickoff. Fileverse path uses 0x421f… as workspace id. Fill contract + token ids from deploy scripts/ops before wiring eth_call.',
}
