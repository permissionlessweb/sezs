/**
 * ZKP #2 public-input wire layout (V-UI-0 freeze / V-UI-2).
 *
 * 9 × 32-byte chunks = 288 bytes → circuit expands to 11 Fp.
 * Source: vote-sdk circuits/src/ffi.rs `sv_verify_vote_proof`.
 *
 * Does not invent alternate slot order.
 */

import { bytesToHex, hexToBytes, isHexString } from './hex'
import { PUBLIC_KEY_SIZE } from './types'

export const CAST_PI_CHUNK_SIZE = 32 as const
export const CAST_PI_CHUNK_COUNT = 9 as const
export const CAST_PI_WIRE_SIZE = CAST_PI_CHUNK_SIZE * CAST_PI_CHUNK_COUNT // 288

export type CastPublicInputSlots = {
  /** Slot 0 — VAN nullifier (32B). */
  vanNullifier: Uint8Array
  /** Slot 1 — compressed r_vpk (32B). */
  rVpk: Uint8Array
  /** Slot 2 — vote authority note new (32B). */
  voteAuthorityNoteNew: Uint8Array
  /** Slot 3 — vote commitment (32B). */
  voteCommitment: Uint8Array
  /** Slot 4 — vote commitment tree root (32B). */
  voteCommTreeRoot: Uint8Array
  /** Slot 5 — anchor height as u64 LE in 32B. */
  anchorHeight: bigint | number
  /** Slot 6 — proposal id as u32 LE in 32B. */
  proposalId: number
  /** Slot 7 — voting round id (32B). */
  votingRoundId: Uint8Array
  /** Slot 8 — compressed ea_pk (32B). */
  eaPk: Uint8Array
}

export const CAST_PI_SLOT_NAMES = [
  'van_nullifier',
  'r_vpk',
  'vote_authority_note_new',
  'vote_commitment',
  'vote_comm_tree_root',
  'anchor_height',
  'proposal_id',
  'voting_round_id',
  'ea_pk',
] as const

function require32(label: string, b: Uint8Array): Uint8Array {
  if (b.length !== CAST_PI_CHUNK_SIZE) {
    throw new Error(`${label} must be ${CAST_PI_CHUNK_SIZE} bytes, got ${b.length}`)
  }
  return b
}

/** Encode u64 LE into a 32-byte chunk (high bytes zero). */
export function encodeU64LeChunk(value: bigint | number): Uint8Array {
  const v = typeof value === 'bigint' ? value : BigInt(value)
  if (v < 0n || v > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`u64 out of range: ${v}`)
  }
  const out = new Uint8Array(CAST_PI_CHUNK_SIZE)
  let x = v
  for (let i = 0; i < 8; i++) {
    out[i] = Number(x & 0xffn)
    x >>= 8n
  }
  return out
}

/** Encode u32 LE into a 32-byte chunk. */
export function encodeU32LeChunk(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`u32 out of range: ${value}`)
  }
  const out = new Uint8Array(CAST_PI_CHUNK_SIZE)
  out[0] = value & 0xff
  out[1] = (value >>> 8) & 0xff
  out[2] = (value >>> 16) & 0xff
  out[3] = (value >>> 24) & 0xff
  return out
}

/**
 * Build 288-byte PI wire blob in slot order 0..8.
 */
export function buildCastPublicInputWire(
  slots: CastPublicInputSlots
): Uint8Array {
  const chunks = [
    require32('vanNullifier', slots.vanNullifier),
    require32('rVpk', slots.rVpk),
    require32('voteAuthorityNoteNew', slots.voteAuthorityNoteNew),
    require32('voteCommitment', slots.voteCommitment),
    require32('voteCommTreeRoot', slots.voteCommTreeRoot),
    encodeU64LeChunk(slots.anchorHeight),
    encodeU32LeChunk(slots.proposalId),
    require32('votingRoundId', slots.votingRoundId),
    require32('eaPk', slots.eaPk),
  ]
  if (slots.eaPk.length !== PUBLIC_KEY_SIZE) {
    throw new Error(`eaPk must be ${PUBLIC_KEY_SIZE} bytes`)
  }
  const out = new Uint8Array(CAST_PI_WIRE_SIZE)
  for (let i = 0; i < chunks.length; i++) {
    out.set(chunks[i]!, i * CAST_PI_CHUNK_SIZE)
  }
  return out
}

export function castPublicInputWireToHex(wire: Uint8Array): string {
  if (wire.length !== CAST_PI_WIRE_SIZE) {
    throw new Error(`PI wire length ${wire.length} != ${CAST_PI_WIRE_SIZE}`)
  }
  return bytesToHex(wire)
}

export function splitCastPublicInputWire(wire: Uint8Array): Uint8Array[] {
  if (wire.length !== CAST_PI_WIRE_SIZE) {
    throw new Error(`PI wire length ${wire.length} != ${CAST_PI_WIRE_SIZE}`)
  }
  const out: Uint8Array[] = []
  for (let i = 0; i < CAST_PI_CHUNK_COUNT; i++) {
    out.push(wire.slice(i * CAST_PI_CHUNK_SIZE, (i + 1) * CAST_PI_CHUNK_SIZE))
  }
  return out
}

/**
 * Map round id string to 32B chunk for lab:
 * - 64 hex chars → raw bytes
 * - otherwise SHA-256 domain tag (async via WebCrypto or Node crypto).
 */
export async function roundIdToChunk(roundId: string): Promise<Uint8Array> {
  const t = roundId.trim()
  if (isHexString(t, CAST_PI_CHUNK_SIZE)) {
    return hexToBytes(t)
  }
  return sha256Utf8(`terp-shielded-vote/v1/round|${t}`)
}

export async function sha256Utf8(s: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(s)
  return sha256Bytes(data)
}

export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  // Prefer WebCrypto (browser + modern Node).
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest('SHA-256', data as BufferSource)
    return new Uint8Array(digest)
  }
  // Node fallback without bundling node:crypto into browser.
  const { createHash } = await import('node:crypto')
  return new Uint8Array(createHash('sha256').update(data).digest())
}

/** Parse proposal id string → u32 (default 0). */
export function parseProposalIdU32(proposalId?: string): number {
  if (proposalId == null || proposalId.trim() === '') return 0
  const n = Number(proposalId.trim())
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) {
    throw new Error(`invalid proposalId: ${proposalId}`)
  }
  return n
}
