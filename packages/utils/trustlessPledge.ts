import { sha256 } from '@cosmjs/crypto'
import { toBase64, toHex, toUtf8 } from '@cosmjs/encoding'
import { blake2b } from '@noble/hashes/blake2b'
import { blake3 } from '@noble/hashes/blake3'

/**
 * Trustlessness Pledge — ADR-032-style digests + authenticated mint helpers.
 *
 * ## Sign-doc preimage (null-byte field separators)
 *
 * ```
 * domain || 0x00 || chain_id || 0x00 || account || 0x00
 *   || authenticator_id || 0x00 || manifesto_cid || 0x00
 *   || project_id || 0x00 || commitments_canonical
 * ```
 *
 * - `authenticator_id` defaults to `"pledge"`.
 * - `project_id` may be empty (`""`) for a global / unscoped pledge.
 * - `commitments_canonical` is empty when there are no extra destinations, else
 *   sorted lines `kind|ref|digest_hex` joined by `\n` (see
 *   {@link canonicalizePledgeCommitments}).
 *
 * Digest algs: blake2b256 (zkpallas default), blake3, sha256.
 *
 * ## Contract authentication (required before mint)
 *
 * cw721_svg mint requires `ext: CosmosArbitrary` (ADR-36). Auth message:
 *
 * - **v1:** `{CW721SVG_DST}{nonce}`
 * - **v2 (content-bound):** `{CW721SVG_DST}{nonce}|{digest_hex}` where
 *   `digest_hex` is the 64-char ADR-032 digest without `0x`.
 *
 * Wallet signs that UTF-8 string via `signArbitrary`; the mint msg embeds
 * pubkey / signature / message / hrp. Contract verifies secp256k1, consumes
 * the one-time nonce, and requires recovered address == tx sender.
 *
 * Spec: docs/superpowers/specs/2026-07-22-trustless-pledge-nft-module.md
 */

export const PLEDGE_DEFAULT_DOMAIN = 'terp-adr032/v1' as const
export const PLEDGE_AUTHENTICATOR_ID = 'pledge' as const
export const PLEDGE_DIGEST_LEN = 32

/**
 * Must match `cw_svg::CW721SVG_DST` on-chain.
 * Format: `DST_cw721svg_{chain-or-network-tag}` — mainnet default.
 */
export const CW721SVG_DST = 'DST_cw721svg_morocco-1' as const

/**
 * Max bytes after DST in auth message (matches `cw_svg::AUTH_MSG_MAX_EXTRA`).
 */
export const AUTH_MSG_MAX_EXTRA = 128

export type PledgeDigestAlg = 'blake2b256' | 'blake3' | 'sha256'

/**
 * A destination / data commitment bound into the pledge digest.
 *
 * Use for project-scoped pledges to external systems (boards, proposals,
 * IPFS payloads, grant milestones, etc.). `digestHex` is the commitment
 * payload hash (with or without `0x`); it is normalized to lowercase hex
 * without prefix in the canonical form.
 *
 * Examples:
 * - `{ kind: 'ipfs', ref: 'bafy…', digestHex: '0x…' }`
 * - `{ kind: 'dao_proposal', ref: 'morocco-1:42', digestHex: '…' }`
 * - `{ kind: 'hermes_card', ref: 't_pledge_epic', digestHex: '…' }`
 */
export type PledgeDataCommitment = {
  /** Destination class (e.g. `ipfs`, `dao_proposal`, `grant_milestone`). */
  kind: string
  /** Stable identifier within that class. */
  ref: string
  /** Hex digest of the committed payload (optional `0x` prefix). */
  digestHex: string
}

export type BuildPledgeSignDocParams = {
  domain: string
  chainId: string
  account: string
  /**
   * Defaults to {@link PLEDGE_AUTHENTICATOR_ID}.
   */
  authenticatorId?: string
  /**
   * Manifesto CID (or other canonical content identifier). UTF-8 encoded as body field.
   */
  manifestoCid: string
  /**
   * Optional project scope (DAO id, grant id, product slug). Empty string if unscoped.
   */
  projectId?: string
  /**
   * Optional multi-destination data commitments (sorted canonically before hashing).
   */
  commitments?: PledgeDataCommitment[]
}

/**
 * Normalize a hex digest: strip `0x`, lowercase. Empty → empty.
 */
export const normalizeDigestHex = (hex: string): string => {
  const t = (hex || '').trim()
  if (!t) {
    return ''
  }
  return (t.startsWith('0x') || t.startsWith('0X') ? t.slice(2) : t).toLowerCase()
}

/**
 * Canonical commitment encoding for the ADR-032 preimage field.
 *
 * Each commitment becomes `kind|ref|digest_hex` (digest without `0x`, lowercased).
 * Lines are sorted lexicographically (UTF-8) and joined with `\n`.
 * Empty list → empty string.
 *
 * Sorting makes field order irrelevant so two wallets hashing the same set
 * produce the same sign-doc regardless of UI order.
 */
export const canonicalizePledgeCommitments = (
  commitments: PledgeDataCommitment[] | undefined
): string => {
  if (!commitments?.length) {
    return ''
  }
  const lines = commitments.map((c) => {
    const kind = (c.kind || '').trim()
    const ref = (c.ref || '').trim()
    const digest = normalizeDigestHex(c.digestHex || '')
    if (!kind || !ref || !digest) {
      throw new Error(
        'Each pledge commitment requires non-empty kind, ref, and digestHex'
      )
    }
    if (kind.includes('|') || ref.includes('|') || kind.includes('\n') || ref.includes('\n')) {
      throw new Error('Commitment kind/ref must not contain "|" or newlines')
    }
    if (!/^[0-9a-f]+$/.test(digest) || digest.length % 2 !== 0) {
      throw new Error(`Invalid commitment digestHex: ${c.digestHex}`)
    }
    return `${kind}|${ref}|${digest}`
  })
  lines.sort()
  return lines.join('\n')
}

/**
 * Join fields with 0x00 separators (ADR-032 style domain separation).
 */
export const joinNullSeparated = (parts: Uint8Array[]): Uint8Array => {
  if (parts.length === 0) {
    return new Uint8Array()
  }
  const sep = 1
  const total =
    parts.reduce((n, p) => n + p.length, 0) + sep * (parts.length - 1)
  const out = new Uint8Array(total)
  let offset = 0
  parts.forEach((part, i) => {
    out.set(part, offset)
    offset += part.length
    if (i < parts.length - 1) {
      out[offset] = 0
      offset += 1
    }
  })
  return out
}

/**
 * Build ADR-032 preimage bytes (domain-separated with 0x00 field separators).
 *
 * Field order is fixed — do not reorder without bumping domain version.
 */
export const buildPledgeSignDoc = ({
  domain,
  chainId,
  account,
  authenticatorId = PLEDGE_AUTHENTICATOR_ID,
  manifestoCid,
  projectId = '',
  commitments,
}: BuildPledgeSignDocParams): Uint8Array => {
  const commitmentsCanonical = canonicalizePledgeCommitments(commitments)
  return joinNullSeparated([
    toUtf8(domain),
    toUtf8(chainId),
    toUtf8(account),
    toUtf8(authenticatorId),
    toUtf8(manifestoCid),
    toUtf8(projectId ?? ''),
    toUtf8(commitmentsCanonical),
  ])
}

/**
 * Hash ADR-032 sign-doc → 32-byte digest.
 * - blake2b256: BLAKE2b-512 truncated to first 32 bytes (zkpallas default)
 * - blake3: BLAKE3 32-byte output
 * - sha256: SHA-256 (fallback when wallet tooling prefers CosmJS hashes)
 */
export const digestPledgeSignDoc = (
  alg: PledgeDigestAlg,
  signDoc: Uint8Array
): Uint8Array => {
  switch (alg) {
    case 'blake2b256': {
      // noble blake2b default is 64-byte BLAKE2b-512; take first 32.
      const full = blake2b(signDoc)
      return full.slice(0, PLEDGE_DIGEST_LEN)
    }
    case 'blake3':
      return blake3(signDoc, { dkLen: PLEDGE_DIGEST_LEN })
    case 'sha256':
      return sha256(signDoc)
    default: {
      const _exhaustive: never = alg
      throw new Error(`Unsupported digest alg: ${_exhaustive}`)
    }
  }
}

export type SignPledgeDigestParams = BuildPledgeSignDocParams & {
  digestAlg?: PledgeDigestAlg
}

export type PledgeDigestResult = {
  domain: string
  chainId: string
  account: string
  authenticatorId: string
  manifestoCid: string
  projectId: string
  /** Canonical multi-dst commitment field (may be empty). */
  commitmentsCanonical: string
  commitments: PledgeDataCommitment[]
  digestAlg: PledgeDigestAlg
  /** Raw preimage bytes. */
  signDoc: Uint8Array
  /** 32-byte digest. */
  digest: Uint8Array
  /** `0x`-prefixed hex digest. */
  digestHex: string
  /** Digest hex without `0x` (for auth message v2 binding). */
  digestHexBare: string
  /**
   * Human-readable payload for optional display / archival ADR-36 envelope.
   * Contract mint auth uses {@link buildPledgeAuthMessage}, not this string.
   */
  signMessage: string
}

/**
 * Compute ADR-032 digest over manifesto CID (+ optional project + commitments).
 */
export const signPledgeDigest = ({
  domain,
  chainId,
  account,
  authenticatorId = PLEDGE_AUTHENTICATOR_ID,
  manifestoCid,
  projectId = '',
  commitments,
  digestAlg = 'blake2b256',
}: SignPledgeDigestParams): PledgeDigestResult => {
  if (!manifestoCid?.trim()) {
    throw new Error('manifestoCid is required for pledge digest')
  }
  if (!account?.trim()) {
    throw new Error('account is required for pledge digest')
  }

  const project = (projectId ?? '').trim()
  const cmtList = commitments ?? []
  const commitmentsCanonical = canonicalizePledgeCommitments(cmtList)

  const signDoc = buildPledgeSignDoc({
    domain,
    chainId,
    account,
    authenticatorId,
    manifestoCid: manifestoCid.trim(),
    projectId: project,
    commitments: cmtList,
  })
  const digest = digestPledgeSignDoc(digestAlg, signDoc)
  const digestHexBare = toHex(digest)
  const digestHex = `0x${digestHexBare}`

  const signMessage = [
    'Trustlessness Pledge',
    domain,
    `chain_id=${chainId}`,
    `account=${account}`,
    `authenticator_id=${authenticatorId}`,
    `manifesto_cid=${manifestoCid.trim()}`,
    `project_id=${project || '(none)'}`,
    `commitments=${commitmentsCanonical ? commitmentsCanonical.replace(/\n/g, ';') : '(none)'}`,
    `digest_alg=${digestAlg}`,
    `adr032_digest=${digestHex}`,
  ].join('\n')

  return {
    domain,
    chainId,
    account,
    authenticatorId,
    manifestoCid: manifestoCid.trim(),
    projectId: project,
    commitmentsCanonical,
    commitments: cmtList,
    digestAlg,
    signDoc,
    digest,
    digestHex,
    digestHexBare,
    signMessage,
  }
}

/**
 * Build the UTF-8 string signed for on-chain mint auth (CosmosArbitrary message).
 *
 * v1: `{dst}{nonce}`
 * v2: `{dst}{nonce}|{digestHexBare}` — binds ADR-032 digest into the signed auth.
 */
export const buildPledgeAuthMessage = ({
  nonce,
  digestHexBare,
  dst = CW721SVG_DST,
}: {
  /** One-time decimal nonce (string of digits recommended). */
  nonce: string | number | bigint
  /** Optional 64-char hex ADR-032 digest (no 0x) for v2 content binding. */
  digestHexBare?: string
  dst?: string
}): string => {
  const n = String(nonce).trim()
  if (!n || !/^\d+$/.test(n)) {
    throw new Error('auth nonce must be a non-empty decimal integer string')
  }
  let msg = `${dst}${n}`
  if (digestHexBare) {
    const bare = normalizeDigestHex(digestHexBare)
    if (!/^[0-9a-f]{64}$/.test(bare)) {
      throw new Error(
        'digestHexBare must be 64 lowercase hex chars (32-byte digest)'
      )
    }
    msg = `${msg}|${bare}`
  }
  const max = dst.length + AUTH_MSG_MAX_EXTRA
  if (msg.length > max) {
    throw new Error(
      `auth message length ${msg.length} exceeds max ${max} (DST + ${AUTH_MSG_MAX_EXTRA})`
    )
  }
  return msg
}

/**
 * Generate a decimal nonce suitable for mint auth (ms timestamp + random suffix).
 */
export const generatePledgeAuthNonce = (): string => {
  const ms = Date.now()
  const rand = Math.floor(Math.random() * 1_000_000)
  return `${ms}${rand.toString().padStart(6, '0')}`
}

export type CosmosArbitraryExt = {
  pubkey: string
  signature: string
  message: string
  hrp: string
}

/**
 * Build `ext` for MintMsg from wallet signArbitrary result + auth message.
 *
 * Binary fields are base64 (CosmWasm JSON convention).
 * `message` is base64 of the UTF-8 auth string bytes.
 */
export const buildCosmosArbitraryExt = ({
  authMessage,
  signatureBase64,
  pubkeyBase64,
  hrp = 'terp',
}: {
  authMessage: string
  /** Compact secp256k1 signature from Keplr/CosmJS signArbitrary (base64). */
  signatureBase64: string
  /** Compressed or uncompressed secp256k1 pubkey (base64). */
  pubkeyBase64: string
  hrp?: string
}): CosmosArbitraryExt => {
  if (!signatureBase64?.trim() || !pubkeyBase64?.trim()) {
    throw new Error('signature and pubkey are required for mint auth')
  }
  if (!authMessage?.trim()) {
    throw new Error('authMessage is required for mint auth')
  }
  return {
    pubkey: pubkeyBase64.trim(),
    signature: signatureBase64.trim(),
    // CosmWasm Binary JSON = base64 of raw message bytes
    message: toBase64(toUtf8(authMessage)),
    hrp,
  }
}

export type PledgeMetadataAttribute = {
  trait_type: string
  value: string
}

export type BuildPledgeMetadataParams = {
  manifestoCid: string
  digestAlg: PledgeDigestAlg
  digestHex: string
  signature: string
  pubkey: string
  /** Prefer public site URL for NFT external_url; Fileverse as fallback. */
  pledgeDocUrl: string
  projectId?: string
  commitments?: PledgeDataCommitment[]
  authMessage?: string
  authNonce?: string
  /**
   * Optional image (ipfs://… or https://…).
   */
  image?: string
  name?: string
  description?: string
}

/**
 * Token metadata JSON with pledge attestation attributes (for token_uri / off-chain record).
 */
export const buildPledgeTokenMetadata = ({
  manifestoCid,
  digestAlg,
  digestHex,
  signature,
  pubkey,
  pledgeDocUrl,
  projectId,
  commitments,
  authMessage,
  authNonce,
  image,
  name = 'Trustlessness Pledge',
  description = 'Team-first integrity pledge. Mint requires on-chain ADR-36 auth (DST+nonce|digest). ADR-032 digest binds manifesto CID, optional project_id, and multi-destination data commitments. Public home: https://permissionless.money/pledge',
}: BuildPledgeMetadataParams): {
  name: string
  description: string
  image?: string
  external_url: string
  attributes: PledgeMetadataAttribute[]
} => {
  const attributes: PledgeMetadataAttribute[] = [
    { trait_type: 'manifesto_cid', value: manifestoCid },
    { trait_type: 'digest_alg', value: digestAlg },
    { trait_type: 'adr032_digest', value: digestHex },
    { trait_type: 'signature', value: signature },
    { trait_type: 'pubkey', value: pubkey },
  ]
  if (projectId) {
    attributes.push({ trait_type: 'project_id', value: projectId })
  }
  const cmt = canonicalizePledgeCommitments(commitments)
  if (cmt) {
    attributes.push({ trait_type: 'commitments', value: cmt })
  }
  if (authMessage) {
    attributes.push({ trait_type: 'auth_message', value: authMessage })
  }
  if (authNonce) {
    attributes.push({ trait_type: 'auth_nonce', value: authNonce })
  }
  // Prefer the public marketing site when the doc URL is still a Fileverse deep link.
  const external =
    pledgeDocUrl.includes('fileverse.io') &&
    !pledgeDocUrl.includes('permissionless.money')
      ? 'https://permissionless.money/pledge'
      : pledgeDocUrl || 'https://permissionless.money/pledge'
  return {
    name,
    description,
    ...(image ? { image } : {}),
    external_url: external,
    attributes,
  }
}

/**
 * Encode metadata as a data URI suitable for token_uri when the minter accepts it.
 */
export const pledgeMetadataDataUri = (
  metadata: ReturnType<typeof buildPledgeTokenMetadata>
): string =>
  `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`

/**
 * Parse module-config commitments (array or JSON string) into structured list.
 */
export const parseModuleCommitments = (
  raw: PledgeDataCommitment[] | string | undefined | null
): PledgeDataCommitment[] => {
  if (raw == null || raw === '') {
    return []
  }
  if (Array.isArray(raw)) {
    return raw
  }
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) {
      return []
    }
    const parsed = JSON.parse(t) as unknown
    if (!Array.isArray(parsed)) {
      throw new Error('commitments must be a JSON array of {kind,ref,digestHex}')
    }
    return parsed as PledgeDataCommitment[]
  }
  throw new Error('invalid commitments config')
}

export type BuildPledgeMintExecuteMsgParams = {
  amount?: number
  allocation?: number
  proofHashes?: string[]
  /**
   * Required CosmosArbitrary auth (from {@link buildCosmosArbitraryExt}).
   * Contract rejects mint without valid one-time auth.
   */
  ext: CosmosArbitraryExt
}

/**
 * cw721_svg mint execute msg with **required** ADR-36 auth.
 *
 * Wire format matches `cw_svg::MintMsg` field names: `amnt`, `alloc`,
 * `proof_hashes`, `ext`.
 */
export const buildPledgeMintExecuteMsg = (
  opts: BuildPledgeMintExecuteMsgParams
): Record<string, unknown> => {
  if (!opts?.ext?.signature || !opts.ext.pubkey || !opts.ext.message) {
    throw new Error(
      'buildPledgeMintExecuteMsg requires ext (CosmosArbitrary auth) before mint'
    )
  }
  return {
    mint: {
      amnt: opts.amount ?? 1,
      alloc: opts.allocation ?? 0,
      proof_hashes: opts.proofHashes ?? [],
      ext: {
        pubkey: opts.ext.pubkey,
        signature: opts.ext.signature,
        message: opts.ext.message,
        hrp: opts.ext.hrp || 'terp',
      },
    },
  }
}

/**
 * DAO core storage / text-record key for TrustlessPledge discovery (TP-BOOT-3).
 * Same pattern as {@link MESH_STORAGE_KEY} (`mesh.v1`).
 */
export const PLEDGE_STORAGE_KEY = 'trustless_pledge.v1' as const

/**
 * Parsed shape of the on-chain `trustless_pledge.v1` item (JSON string value).
 * Empty strings mean unset — never invent ETH addresses.
 */
export type TrustlessPledgeStorageRecord = {
  collection?: string
  minter?: string
  ethContract?: string
  documentTokenId?: string
  teamTokenId?: string
  manifestoCid?: string
  teamCid?: string
  ipfsGateway?: string
}

export type ResolvedTrustlessPledgeDiscovery = {
  collection: string
  minter: string
  manifestoCid: string
  teamCid: string
  ethContract: string
  ethDocumentTokenId: string
  ethTeamTokenId: string
  ipfsGateway: string
  /** Where non-empty fields were primarily resolved from. */
  source: 'module' | 'dao_storage' | 'merged' | 'empty'
  /** Raw storage JSON if present (for DevOps). */
  storageRaw: string | null
}

const trimStr = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()

/**
 * Parse a DAO storage item value for `trustless_pledge.v1`.
 * Returns null if missing/invalid — never throws on bad JSON for resolve path.
 */
export const parseTrustlessPledgeStorage = (
  raw: string | null | undefined
): TrustlessPledgeStorageRecord | null => {
  if (raw == null) {
    return null
  }
  const t = String(raw).trim()
  if (!t) {
    return null
  }
  try {
    const parsed = JSON.parse(t) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const o = parsed as Record<string, unknown>
    return {
      collection: trimStr(o.collection) || undefined,
      minter: trimStr(o.minter) || undefined,
      ethContract: trimStr(o.ethContract) || undefined,
      documentTokenId: trimStr(o.documentTokenId) || undefined,
      teamTokenId: trimStr(o.teamTokenId) || undefined,
      manifestoCid: trimStr(o.manifestoCid) || undefined,
      teamCid: trimStr(o.teamCid) || undefined,
      ipfsGateway: trimStr(o.ipfsGateway) || undefined,
    }
  } catch {
    return null
  }
}

/**
 * Resolve pledge discovery fields: **module editor values win**, then
 * `trustless_pledge.v1` DAO storage, then empty (caller may apply chain defaults).
 *
 * This lets lab/testnet DAOs point at a non-mainnet collection without hardcoding
 * only SvgNfts mainnet addresses in the FE.
 */
export const resolveTrustlessPledgeDiscovery = ({
  module,
  storageRaw,
}: {
  module?: {
    collection?: string
    minter?: string
    manifestoCid?: string
    teamCid?: string
    ethContract?: string
    ethDocumentTokenId?: string
    ethTeamTokenId?: string
    ipfsGateway?: string
  } | null
  storageRaw?: string | null
}): ResolvedTrustlessPledgeDiscovery => {
  const fromStore = parseTrustlessPledgeStorage(storageRaw)
  const m = module || {}

  const pick = (modVal?: string, storeVal?: string): string => {
    const a = trimStr(modVal)
    if (a) return a
    return trimStr(storeVal)
  }

  const collection = pick(m.collection, fromStore?.collection)
  const minter = pick(m.minter, fromStore?.minter)
  const manifestoCid = pick(m.manifestoCid, fromStore?.manifestoCid)
  const teamCid = pick(m.teamCid, fromStore?.teamCid)
  const ethContract = pick(m.ethContract, fromStore?.ethContract)
  const ethDocumentTokenId = pick(
    m.ethDocumentTokenId,
    fromStore?.documentTokenId
  )
  const ethTeamTokenId = pick(m.ethTeamTokenId, fromStore?.teamTokenId)
  const ipfsGateway = pick(m.ipfsGateway, fromStore?.ipfsGateway)

  const modHas =
    !!trimStr(m.collection) ||
    !!trimStr(m.manifestoCid) ||
    !!trimStr(m.minter) ||
    !!trimStr(m.ipfsGateway)
  const storeHas = !!fromStore

  let source: ResolvedTrustlessPledgeDiscovery['source'] = 'empty'
  if (modHas && storeHas) {
    // Prefer labeling merged when both contribute; pure module if store unused.
    const storeUsed =
      (!trimStr(m.collection) && !!fromStore?.collection) ||
      (!trimStr(m.manifestoCid) && !!fromStore?.manifestoCid) ||
      (!trimStr(m.minter) && !!fromStore?.minter) ||
      (!trimStr(m.ipfsGateway) && !!fromStore?.ipfsGateway)
    source = storeUsed ? 'merged' : 'module'
  } else if (modHas) {
    source = 'module'
  } else if (storeHas) {
    source = 'dao_storage'
  }

  return {
    collection,
    minter,
    manifestoCid,
    teamCid,
    ethContract,
    ethDocumentTokenId,
    ethTeamTokenId,
    ipfsGateway,
    source,
    storageRaw:
      storageRaw != null && String(storageRaw).trim()
        ? String(storageRaw)
        : null,
  }
}

/**
 * Serialize a storage record for `set_item` / initial_items (compact JSON).
 * Omits undefined; keeps empty strings when explicitly provided.
 */
export const serializeTrustlessPledgeStorage = (
  record: TrustlessPledgeStorageRecord
): string =>
  JSON.stringify({
    collection: record.collection ?? '',
    minter: record.minter ?? '',
    ethContract: record.ethContract ?? '',
    documentTokenId: record.documentTokenId ?? '',
    teamTokenId: record.teamTokenId ?? '',
    manifestoCid: record.manifestoCid ?? '',
    teamCid: record.teamCid ?? '',
    ipfsGateway: record.ipfsGateway ?? '',
  })
