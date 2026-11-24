import { Hmac, Sha256, sha256 } from '@cosmjs/crypto'
import { fromBase64, toHex, toUtf8 } from '@cosmjs/encoding'

/**
 * Bounties identity helpers (ADR-36 Mode A IKM + dao-scoped HKDF).
 *
 * Design: docs/superpowers/specs/2026-07-20-dao-bounties-zec-iframe-design.md §B5–B6
 *
 * Until an Orchard/Pallas curve library is available in the browser bundle,
 * `bountyPk` is a 32-byte hex **identity stub** derived via real HKDF-SHA256
 * (algo `hkdf-sha256-identity-stub-v0`). Never export sk / OKM to the iframe.
 */

export const BOUNTIES_PROTOCOL = 'terp-bounties/v1' as const
export const BOUNTIES_IDENTITY_ALGO = 'hkdf-sha256-identity-stub-v0' as const

export type BuildBountiesLoginMessageParams = {
  chainId: string
  daoAddress: string
  addr: string
  nonce: string
  exp: number
}

export type BuildBountiesDeriveMessageParams = {
  chainId: string
  daoAddress: string
  addr: string
  accountIndex?: number
}

export type DeriveBountyIdentityParams = {
  /**
   * ADR-36 / signArbitrary signature bytes, or standard base64 signature string.
   */
  signature: Uint8Array | string
  chainId: string
  daoAddress: string
  accountIndex?: number
  /**
   * Optional UTF-8 derive message used for transcriptHash (preferred).
   * If omitted, transcriptHash is SHA-256 of the signature bytes only.
   */
  deriveMessage?: string
}

export type BountyIdentity = {
  /** 32-byte hex public identity stub (NOT a real Orchard spend-auth pk yet). */
  bountyPk: string
  algo: typeof BOUNTIES_IDENTITY_ALGO
  transcriptHash: string
}

/**
 * Canonical ADR-36 login payload (UTF-8).
 *
 * ```
 * terp-bounties/v1/login
 * chain_id={chainId}
 * dao={daoAddress}
 * addr={bech32Signer}
 * nonce={nonce}
 * exp={unixExp}
 * ```
 */
export const buildBountiesLoginMessage = ({
  chainId,
  daoAddress,
  addr,
  nonce,
  exp,
}: BuildBountiesLoginMessageParams): string =>
  [
    `${BOUNTIES_PROTOCOL}/login`,
    `chain_id=${chainId}`,
    `dao=${daoAddress}`,
    `addr=${addr}`,
    `nonce=${nonce}`,
    `exp=${exp}`,
  ].join('\n')

/**
 * Canonical Mode A derive payload (UTF-8).
 *
 * ```
 * terp-bounties/v1/derive
 * chain_id=…
 * dao=…
 * addr=…
 * account=0
 * ```
 */
export const buildBountiesDeriveMessage = ({
  chainId,
  daoAddress,
  addr,
  accountIndex = 0,
}: BuildBountiesDeriveMessageParams): string =>
  [
    `${BOUNTIES_PROTOCOL}/derive`,
    `chain_id=${chainId}`,
    `dao=${daoAddress}`,
    `addr=${addr}`,
    `account=${accountIndex}`,
  ].join('\n')

/** Length-prefixed UTF-8 concat for HKDF salt / info domain separation. */
const lp = (s: string): Uint8Array => {
  const bytes = toUtf8(s)
  if (bytes.length > 0xffff) {
    throw new Error('bountiesIdentity: string too long for length-prefix')
  }
  const out = new Uint8Array(2 + bytes.length)
  out[0] = (bytes.length >> 8) & 0xff
  out[1] = bytes.length & 0xff
  out.set(bytes, 2)
  return out
}

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

const hmacSha256 = (key: Uint8Array, data: Uint8Array): Uint8Array =>
  new Hmac(Sha256, key).update(data).digest()

/**
 * HKDF-Extract(salt, IKM) per RFC 5869 (HMAC-SHA256).
 */
export const hkdfExtract = (salt: Uint8Array, ikm: Uint8Array): Uint8Array => {
  // RFC 5869: if salt is not provided, use HashLen zeros. We always pass salt.
  const actualSalt =
    salt.length === 0 ? new Uint8Array(32) /* SHA-256 len */ : salt
  return hmacSha256(actualSalt, ikm)
}

/**
 * HKDF-Expand(PRK, info, L) per RFC 5869 (HMAC-SHA256).
 */
export const hkdfExpand = (
  prk: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array => {
  const hashLen = 32
  if (length > 255 * hashLen) {
    throw new Error('bountiesIdentity: HKDF expand length too large')
  }
  const n = Math.ceil(length / hashLen)
  const okm = new Uint8Array(n * hashLen)
  let t = new Uint8Array(0)
  for (let i = 1; i <= n; i++) {
    t = hmacSha256(prk, concatBytes(t, info, new Uint8Array([i])))
    okm.set(t, (i - 1) * hashLen)
  }
  return okm.slice(0, length)
}

/**
 * Dao-scoped HKDF salt:
 * length-prefixed concat of `terp-bounties/v1` || chainId || daoAddress
 */
export const buildBountiesHkdfSalt = (
  chainId: string,
  daoAddress: string
): Uint8Array =>
  concatBytes(lp(BOUNTIES_PROTOCOL), lp(chainId), lp(daoAddress))

/**
 * Info for spend identity limb: `zcash-compat/spend` || accountIndex (u32 BE)
 */
export const buildBountiesHkdfInfo = (accountIndex = 0): Uint8Array => {
  const label = toUtf8('zcash-compat/spend')
  const idx = new Uint8Array(4)
  const v = accountIndex >>> 0
  idx[0] = (v >>> 24) & 0xff
  idx[1] = (v >>> 16) & 0xff
  idx[2] = (v >>> 8) & 0xff
  idx[3] = v & 0xff
  return concatBytes(label, idx)
}

const resolveSignatureBytes = (signature: Uint8Array | string): Uint8Array => {
  if (typeof signature === 'string') {
    // StdSignature.signature is base64; also accept raw hex if needed later.
    try {
      return fromBase64(signature)
    } catch {
      // fall through — treat as UTF-8 only if not base64 (should not happen)
      return toUtf8(signature)
    }
  }
  return signature
}

/**
 * Mode A: IKM = SHA-256(signature_bytes), then dao-scoped HKDF → 32-byte identity.
 *
 * Returns public identity stub only — never sk/OKM full material beyond the
 * first 32 bytes labeled as bountyPk for P0 application binding.
 */
export const deriveBountyIdentityFromSignature = ({
  signature,
  chainId,
  daoAddress,
  accountIndex = 0,
  deriveMessage,
}: DeriveBountyIdentityParams): BountyIdentity => {
  const sigBytes = resolveSignatureBytes(signature)
  const ikm = sha256(sigBytes)
  const salt = buildBountiesHkdfSalt(chainId, daoAddress)
  const info = buildBountiesHkdfInfo(accountIndex)
  const prk = hkdfExtract(salt, ikm)
  // L=64 as design sketch; only first 32 used as identity stub (no sk export).
  const okm = hkdfExpand(prk, info, 64)
  const bountyPk = toHex(okm.slice(0, 32))

  const transcriptHash = toHex(
    sha256(deriveMessage ? toUtf8(deriveMessage) : sigBytes)
  )

  return {
    bountyPk,
    algo: BOUNTIES_IDENTITY_ALGO,
    transcriptHash,
  }
}
