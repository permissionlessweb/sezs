/**
 * Client-side ElGamal encrypt for vote-sdk privacy cast (P1–P2).
 *
 * **Product path:** encrypt in-browser under ea_pk — never send plaintext vote
 * to a helper server.
 *
 * Wire: 64-byte C1||C2 compressed Pallas (Go MarshalCiphertext parity).
 * Generator: Orchard SpendAuthG (see STATUS-V-UI-0).
 */

import {
  CIPHERTEXT_SIZE,
  EncryptVoteOptions,
  PUBLIC_KEY_SIZE,
  ShieldedVoteCryptoError,
} from './types'

type WasmApi = {
  encryptVote: (ea_pk: Uint8Array, vote_value: bigint) => Uint8Array
  encryptVoteWithRandomness: (
    ea_pk: Uint8Array,
    vote_value: bigint,
    r: Uint8Array
  ) => Uint8Array
  ciphertextSize: () => number
  publicKeySize: () => number
  spendAuthGCompressed: () => Uint8Array
  identityCiphertext: () => Uint8Array
}

let wasmApi: WasmApi | null = null
let loadPromise: Promise<WasmApi> | null = null

/**
 * Load the vote-elgamal-wasm module (nodejs/bundler target under ./pkg).
 * Safe to call multiple times; caches the module.
 */
export async function loadElgamalWasm(): Promise<WasmApi> {
  if (wasmApi) {
    return wasmApi
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        // Built by:
        //   wasm-pack build --target nodejs \
        //     --out-dir websites/dao-dao-ui/packages/utils/shieldedVote/pkg
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = await import('./pkg/vote_elgamal_wasm.js')
        wasmApi = mod as unknown as WasmApi
        return wasmApi
      } catch (cause) {
        throw new ShieldedVoteCryptoError(
          'wasm_unavailable',
          'vote-elgamal-wasm not available; build with wasm-pack (see shieldedVote README)',
          { cause }
        )
      }
    })()
  }
  return loadPromise
}

/** Synchronous accessor after `await loadElgamalWasm()` (or first encrypt). */
export function getElgamalWasmSync(): WasmApi | null {
  return wasmApi
}

function requireEaPk(eaPk: Uint8Array): void {
  if (!(eaPk instanceof Uint8Array) || eaPk.length !== PUBLIC_KEY_SIZE) {
    throw new ShieldedVoteCryptoError(
      'bad_ea_pk_len',
      `ea_pk must be ${PUBLIC_KEY_SIZE} bytes, got ${eaPk?.length ?? 'undefined'}`
    )
  }
  if (eaPk.every((b) => b === 0)) {
    throw new ShieldedVoteCryptoError(
      'identity_ea_pk',
      'ea_pk must not be the identity point'
    )
  }
}

function toVoteU64(voteValue: number | bigint): bigint {
  if (typeof voteValue === 'bigint') {
    if (voteValue < 0n || voteValue > 0xffffffffffffffffn) {
      throw new ShieldedVoteCryptoError(
        'encrypt_failed',
        'voteValue out of u64 range'
      )
    }
    return voteValue
  }
  if (
    !Number.isInteger(voteValue) ||
    voteValue < 0 ||
    voteValue > Number.MAX_SAFE_INTEGER
  ) {
    throw new ShieldedVoteCryptoError(
      'encrypt_failed',
      'voteValue must be a non-negative integer'
    )
  }
  return BigInt(voteValue)
}

/**
 * Encrypt `voteValue` under election authority public key `eaPk`.
 *
 * @returns 64-byte ciphertext (never logs or returns plaintext)
 *
 * @example
 * ```ts
 * import { encryptVote } from '@dao-dao/utils/shieldedVote'
 * const ct = await encryptVote(eaPk, 1) // 64 bytes
 * // submit ct in cast payload as enc_share — not the number 1
 * ```
 */
export async function encryptVote(
  eaPk: Uint8Array,
  voteValue: number | bigint,
  opts: EncryptVoteOptions = {}
): Promise<Uint8Array> {
  requireEaPk(eaPk)
  const api = await loadElgamalWasm()
  const v = toVoteU64(voteValue)

  try {
    let ct: Uint8Array
    if (opts.r !== undefined) {
      if (!(opts.r instanceof Uint8Array) || opts.r.length !== 32) {
        throw new ShieldedVoteCryptoError(
          'bad_r_len',
          `r must be 32 bytes, got ${opts.r?.length ?? 'undefined'}`
        )
      }
      ct = api.encryptVoteWithRandomness(eaPk, v, opts.r)
    } else {
      ct = api.encryptVote(eaPk, v)
    }
    if (!(ct instanceof Uint8Array) || ct.length !== CIPHERTEXT_SIZE) {
      throw new ShieldedVoteCryptoError(
        'encrypt_failed',
        `expected ${CIPHERTEXT_SIZE}-byte ciphertext`
      )
    }
    return ct
  } catch (e) {
    if (e instanceof ShieldedVoteCryptoError) {
      throw e
    }
    throw new ShieldedVoteCryptoError(
      'encrypt_failed',
      e instanceof Error ? e.message : String(e),
      { cause: e }
    )
  }
}

/**
 * Deterministic encrypt (goldens / ZKP witness). Prefer `encryptVote(..., { r })`.
 */
export async function encryptVoteWithRandomness(
  eaPk: Uint8Array,
  voteValue: number | bigint,
  r: Uint8Array
): Promise<Uint8Array> {
  return encryptVote(eaPk, voteValue, { r })
}

/** Assert ciphertext length without inspecting plaintext (privacy tests). */
export function isElgamalCiphertextBytes(x: unknown): x is Uint8Array {
  return x instanceof Uint8Array && x.length === CIPHERTEXT_SIZE
}

/**
 * Build a cast payload fragment that carries **only** ciphertext (no plaintext).
 * Used by privacy unit tests and V-UI-3 submit prep.
 */
export function castPayloadEncShare(ciphertext: Uint8Array): {
  enc_share: Uint8Array
} {
  if (!isElgamalCiphertextBytes(ciphertext)) {
    throw new ShieldedVoteCryptoError(
      'encrypt_failed',
      `enc_share must be ${CIPHERTEXT_SIZE} bytes`
    )
  }
  return { enc_share: ciphertext }
}
