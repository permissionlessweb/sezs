/**
 * Client-side XChaCha20-Poly1305 encrypt/decrypt for SEAM-NOTE-OUT envelopes.
 *
 * Matches seam_note_out envelope.rs:
 * - scheme: "xchacha20poly1305"
 * - cleartext_layout: "SEAM-NOTE-OUT-V0"
 * - cleartext_len: 382
 * - empty AAD
 * - nonce 24 bytes, random on encrypt
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { sha256 } from '@noble/hashes/sha2'
import { randomBytes } from '@noble/hashes/utils'

import { bytesToHex, hexToBytes } from './hex'
import {
  CLEARTEXT_LAYOUT_SEAM_NOTE_OUT_V0,
  HeadstashNotesError,
  NoteEnvelope,
  SCHEME_XCHACHA20POLY1305,
  SEAM_NOTE_OUT_V0_LEN,
} from './types'

const NONCE_LEN = 24
const KEY_LEN = 32

export type EncryptNoteOpts = {
  /** When true, set envelope sha256 = SHA256(ciphertext bytes). */
  includeCiphertextSha256?: boolean
  /**
   * Optional fixed 24-byte nonce (tests / vectors only).
   * Production encrypt uses random nonce when omitted.
   */
  nonce?: Uint8Array
}

function requireKey32(key: Uint8Array): Uint8Array {
  if (key.length !== KEY_LEN) {
    throw new HeadstashNotesError({
      kind: 'encrypt',
      reason: `key must be ${KEY_LEN} bytes, got ${key.length}`,
    })
  }
  return key
}

/** SHA256 of decoded ciphertext bytes → lowercase hex (64 chars). */
export function ciphertextSha256Hex(ciphertextHex: string): string {
  const ct = hexToBytes(ciphertextHex)
  return bytesToHex(sha256(ct))
}

/**
 * Encrypt full 382B SEAM-NOTE-OUT cleartext under a 32-byte owner key.
 * No AAD bound (MVP, matches Rust).
 */
export function encryptNoteOut(
  cleartext382: Uint8Array,
  key: Uint8Array,
  opts: EncryptNoteOpts = {}
): NoteEnvelope {
  requireKey32(key)
  if (cleartext382.length !== SEAM_NOTE_OUT_V0_LEN) {
    throw new HeadstashNotesError({
      kind: 'bad_cleartext_len',
      len: cleartext382.length,
    })
  }

  const nonce =
    opts.nonce ??
    (() => {
      const n = randomBytes(NONCE_LEN)
      return n
    })()
  if (nonce.length !== NONCE_LEN) {
    throw new HeadstashNotesError({ kind: 'bad_nonce' })
  }

  try {
    const cipher = xchacha20poly1305(key, nonce)
    const ct = cipher.encrypt(cleartext382)
    const env: NoteEnvelope = {
      ciphertext: bytesToHex(ct),
      nonce: bytesToHex(nonce),
      scheme: SCHEME_XCHACHA20POLY1305,
      cleartext_layout: CLEARTEXT_LAYOUT_SEAM_NOTE_OUT_V0,
      cleartext_len: SEAM_NOTE_OUT_V0_LEN,
    }
    if (opts.includeCiphertextSha256) {
      env.sha256 = ciphertextSha256Hex(env.ciphertext)
    }
    return env
  } catch (e) {
    throw new HeadstashNotesError({
      kind: 'encrypt',
      reason: e instanceof Error ? e.message : String(e),
    })
  }
}

/**
 * Decrypt envelope back to 382B cleartext.
 * Rejects unknown scheme/layout, wrong cleartext_len, bad hex, or AEAD failure.
 */
export function decryptNoteOut(
  env: NoteEnvelope,
  key: Uint8Array
): Uint8Array {
  requireKey32(key)

  if (env.scheme !== SCHEME_XCHACHA20POLY1305) {
    throw new HeadstashNotesError({
      kind: 'unsupported_scheme',
      scheme: env.scheme,
    })
  }
  if (env.cleartext_layout !== CLEARTEXT_LAYOUT_SEAM_NOTE_OUT_V0) {
    throw new HeadstashNotesError({
      kind: 'unsupported_layout',
      layout: env.cleartext_layout,
    })
  }
  if (env.cleartext_len !== SEAM_NOTE_OUT_V0_LEN) {
    throw new HeadstashNotesError({
      kind: 'bad_cleartext_len',
      len: env.cleartext_len,
    })
  }

  let ct: Uint8Array
  let nonceBytes: Uint8Array
  try {
    ct = hexToBytes(env.ciphertext)
    nonceBytes = hexToBytes(env.nonce)
  } catch (e) {
    throw new HeadstashNotesError({
      kind: 'bad_hex',
      reason: e instanceof Error ? e.message : String(e),
    })
  }
  if (nonceBytes.length !== NONCE_LEN) {
    throw new HeadstashNotesError({ kind: 'bad_nonce' })
  }

  try {
    const cipher = xchacha20poly1305(key, nonceBytes)
    const pt = cipher.decrypt(ct)
    if (pt.length !== SEAM_NOTE_OUT_V0_LEN) {
      throw new HeadstashNotesError({
        kind: 'bad_cleartext_len',
        len: pt.length,
      })
    }
    return pt
  } catch (e) {
    if (e instanceof HeadstashNotesError) throw e
    throw new HeadstashNotesError({
      kind: 'decrypt',
      reason: e instanceof Error ? e.message : 'aead failure',
    })
  }
}

/**
 * Parse SEAM-NOTE-OUT-V0 cleartext fields needed for safe UI summary.
 * Layout offsets from seam_note_out SeamNoteOutV0::to_bytes.
 *
 * Offsets:
 *  0: version u8
 *  1: domain_tag [16]
 *  17: origin u8
 *  18: asset_id [32]
 *  50: value u64 LE
 *  58: owner_binding [32]
 *  90: cm_public [32]
 *  ...
 */
export function parseSeamNoteOutSummary(cleartext: Uint8Array): {
  version: number
  value: bigint
  ownerBinding: Uint8Array
  cmPublic: Uint8Array
} {
  if (cleartext.length !== SEAM_NOTE_OUT_V0_LEN) {
    throw new HeadstashNotesError({
      kind: 'bad_cleartext_len',
      len: cleartext.length,
    })
  }
  const version = cleartext[0]!
  const valueView = new DataView(
    cleartext.buffer,
    cleartext.byteOffset + 50,
    8
  )
  const value = valueView.getBigUint64(0, true)
  const ownerBinding = cleartext.subarray(58, 90)
  const cmPublic = cleartext.subarray(90, 122)
  return { version, value, ownerBinding, cmPublic }
}

/** Build a deterministic 382B fixture cleartext for tests (not a valid SEAM). */
export function fixtureCleartext382(seed = 0x42): Uint8Array {
  const out = new Uint8Array(SEAM_NOTE_OUT_V0_LEN)
  for (let i = 0; i < out.length; i++) {
    out[i] = (seed + i) & 0xff
  }
  // domain tag "terp-note-out-v0" at offset 1
  const tag = new TextEncoder().encode('terp-note-out-v0')
  out[0] = 0
  out.set(tag, 1)
  return out
}

