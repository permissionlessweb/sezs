/**
 * Wire types for vote-sdk privacy cast ElGamal (V-UI-0 freeze) + cast UX types (V-UI-3).
 *
 * Ciphertext: 64 bytes = compress(C1) || compress(C2) Pallas points.
 * ea_pk: 32-byte compressed Pallas (SpendAuthG base; non-identity).
 */

/** Compressed Pallas public key size (ea_pk). */
export const PUBLIC_KEY_SIZE = 32 as const

/** Alias used by cast payload builders (same as PUBLIC_KEY_SIZE). */
export const COMPRESSED_POINT_SIZE = PUBLIC_KEY_SIZE

/** ElGamal ciphertext size (C1 || C2). */
export const CIPHERTEXT_SIZE = 64 as const

/**
 * Orchard SpendAuthG compressed (LE). Matches Go elgamal.PallasGenerator().
 * NOT the standard pasta_curves generator.
 */
export const SPEND_AUTH_G_HEX =
  '63c975b884721a8d0ca1707be30c7f0c5f445f3e7c188d3b06d6f128b32355b7'

export type EaPublicKeyBytes = Uint8Array
export type ElgamalCiphertextBytes = Uint8Array
export type PallasScalarBytes = Uint8Array

export type EncryptVoteOptions = {
  /**
   * Optional 32-byte little-endian Pallas scalar (non-zero).
   * **Tests / ZKP witness only.** Production omits this and uses CSPRNG.
   */
  r?: PallasScalarBytes
}

export class ShieldedVoteCryptoError extends Error {
  readonly code:
    | 'bad_ea_pk_len'
    | 'bad_ea_pk'
    | 'identity_ea_pk'
    | 'bad_r_len'
    | 'bad_r'
    | 'wasm_unavailable'
    | 'encrypt_failed'
    | 'bad_ciphertext_len'
    | 'invalid_vote_value'
    | 'encrypt_unavailable'

  constructor(
    code: ShieldedVoteCryptoError['code'],
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'ShieldedVoteCryptoError'
    this.code = code
  }
}

/**
 * Discrete vote choice shown in UI. Numeric value is the ElGamal plaintext
 * domain (uint64) for encrypt — never put on the wire as cleartext.
 */
export type ShieldedVoteChoice = {
  /** Stable id for UI (e.g. "yes" | "no" | "abstain" | custom). */
  id: string
  /** Human label (safe to display). */
  label: string
  /**
   * Plaintext domain value for ElGamal encrypt (vote-sdk `v: uint64`).
   * Client-only; must not appear in cast submit bodies.
   */
  value: number
}

/**
 * Cast submit payload for CosmWasm / Terp (V-UI-4).
 * **Must not** include plaintext vote value / choice id that encodes the vote.
 * Safe fields only: round, ea_pk, ciphertext, optional proof / nullifier.
 */
export type ShieldedCastSubmitBody = {
  /** Protocol tag for submit surface. */
  protocol: 'terp-shielded-vote/v1'
  /** Round / session id (ceremony or vote round). */
  roundId: string
  /** Optional proposal id within the round. */
  proposalId?: string
  /** 32-byte compressed EA public key, lowercase hex. */
  eaPkHex: string
  /** 64-byte MarshalCiphertext, lowercase hex. */
  ciphertextHex: string
  /**
   * Optional cast ZKP #2 proof bytes (V-UI-2), lowercase hex when present.
   * Lab path: lab_mock_prove_v1 envelope (not Halo2).
   */
  proofHex?: string
  /** Optional nullifier hex (P5 uniqueness; V-UI-4 gate). */
  nullifierHex?: string
  /** 288-byte public input wire hex (V-UI-0 / V-UI-2). */
  publicInputsHex?: string
  /** Proof mode tag e.g. lab_mock_prove_v1 | halo2 (future). */
  proofMode?: string
  /**
   * Safe UI-only summary: never the numeric vote plaintext.
   * e.g. "encrypted" | "encrypted+proof" | "lab_proof".
   */
  statusSummary: string
}

/**
 * In-memory cast prep after encrypt (before chain submit).
 * Holds ciphertext only — plaintext discarded after encrypt.
 */
export type ShieldedCastPrepared = {
  roundId: string
  proposalId?: string
  eaPkHex: string
  ciphertextHex: string
  /** Choice id for local UX only; never serialized into submit body. */
  localChoiceId?: string
  proofHex?: string
  nullifierHex?: string
  publicInputsHex?: string
  proofMode?: string
  engine: string
}
