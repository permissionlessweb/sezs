/**
 * V-UI-4 CosmWasm execute msg builder for cast_shielded_vote (V-UI-0 shape).
 * Never includes plaintext vote.
 */

import { findPrivacyLeaksInBody } from './castPayload'
import { bytesToHex, hexToBytes, isHexString } from './hex'
import {
  CAST_PI_CHUNK_SIZE,
  CAST_PI_WIRE_SIZE,
  splitCastPublicInputWire,
} from './publicInputs'
import { CIPHERTEXT_SIZE, PUBLIC_KEY_SIZE } from './types'

export type CastShieldedVoteFields = {
  /** Round / session id (lab: plain string; product may be base64 32B). */
  round_id: string
  proposal_id: number
  van_nullifier: string
  vote_authority_note_new: string
  vote_commitment: string
  vote_comm_tree_root: string
  vote_comm_tree_anchor_height: string
  ea_pk: string
  r_vpk: string
  vote_auth_sig: string
  proof: string
  enc_share: string
  /** Lab-only: 288B PI wire hex for mock verify. */
  public_inputs_hex?: string
  /** Lab marker when proof is lab_mock_prove_v1. */
  proof_mode?: string
}

export type CastShieldedVoteExecuteMsg = {
  cast_shielded_vote: CastShieldedVoteFields
}

export type BuildCastExecuteMsgInput = {
  roundId: string
  proposalId?: number | string
  eaPkHex: string
  ciphertextHex: string
  proofHex: string
  nullifierHex: string
  publicInputsHex: string
  /** Optional RedPallas sig hex; lab may use zeros. */
  voteAuthSigHex?: string
  proofMode?: string
  /** Include public_inputs_hex on msg (default true for lab). */
  includePublicInputs?: boolean
}

function b64FromBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s)
}

function b64FromHex(hex: string): string {
  return b64FromBytes(hexToBytes(hex))
}

function parseProposal(p?: number | string): number {
  if (p == null || p === '') return 0
  if (typeof p === 'number') {
    if (!Number.isInteger(p) || p < 0) throw new Error('bad proposalId')
    return p
  }
  const n = Number(p)
  if (!Number.isInteger(n) || n < 0) throw new Error('bad proposalId')
  return n
}

/**
 * Build CosmWasm execute JSON per STATUS-V-UI-0 §4.1.
 * PI wire splits into named base64 fields; enc_share is 64B ciphertext.
 */
export function buildCastShieldedVoteExecuteMsg(
  input: BuildCastExecuteMsgInput
): CastShieldedVoteExecuteMsg {
  if (!input.roundId.trim()) throw new Error('roundId required')
  if (!isHexString(input.eaPkHex, PUBLIC_KEY_SIZE)) {
    throw new Error('eaPkHex bad length')
  }
  if (!isHexString(input.ciphertextHex, CIPHERTEXT_SIZE)) {
    throw new Error('ciphertextHex bad length')
  }
  if (!isHexString(input.nullifierHex, CAST_PI_CHUNK_SIZE)) {
    throw new Error('nullifierHex must be 32B hex')
  }
  if (!isHexString(input.publicInputsHex, CAST_PI_WIRE_SIZE)) {
    throw new Error('publicInputsHex must be 288B hex')
  }
  if (!isHexString(input.proofHex) || input.proofHex.replace(/^0x/i, '').length < 2) {
    throw new Error('proofHex required')
  }

  const chunks = splitCastPublicInputWire(hexToBytes(input.publicInputsHex))
  // slots: 0 nf, 1 r_vpk, 2 van_new, 3 vc, 4 root, 5 height, 6 proposal, 7 round, 8 ea_pk
  const heightChunk = chunks[5]!
  let height = 0n
  for (let i = 0; i < 8; i++) {
    height |= BigInt(heightChunk[i]!) << BigInt(8 * i)
  }

  const msg: CastShieldedVoteExecuteMsg = {
    cast_shielded_vote: {
      // Lab indexes by plain round id; product may switch to base64 of chunk[7].
      round_id: input.roundId.trim(),
      proposal_id: parseProposal(input.proposalId),
      van_nullifier: b64FromHex(input.nullifierHex),
      vote_authority_note_new: b64FromBytes(chunks[2]!),
      vote_commitment: b64FromBytes(chunks[3]!),
      vote_comm_tree_root: b64FromBytes(chunks[4]!),
      vote_comm_tree_anchor_height: height.toString(),
      ea_pk: b64FromHex(input.eaPkHex),
      r_vpk: b64FromBytes(chunks[1]!),
      vote_auth_sig: input.voteAuthSigHex
        ? b64FromHex(input.voteAuthSigHex)
        : b64FromHex('00'.repeat(64)),
      proof: b64FromHex(input.proofHex),
      enc_share: b64FromHex(input.ciphertextHex),
    },
  }

  if (input.includePublicInputs !== false) {
    msg.cast_shielded_vote.public_inputs_hex = bytesToHex(
      hexToBytes(input.publicInputsHex)
    )
  }
  if (input.proofMode) {
    msg.cast_shielded_vote.proof_mode = input.proofMode
  }

  const leaks = findPrivacyLeaksInBody(msg)
  if (leaks.length > 0) {
    throw new Error(`privacy leak in execute msg: ${leaks.join(', ')}`)
  }
  return msg
}

/** CosmWasm MsgExecuteContract-style body for clients. */
export function buildWasmExecuteBody(args: {
  contract: string
  sender?: string
  msg: CastShieldedVoteExecuteMsg
  funds?: { denom: string; amount: string }[]
}): {
  typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract'
  value: {
    sender: string
    contract: string
    msg: CastShieldedVoteExecuteMsg
    funds: { denom: string; amount: string }[]
  }
} {
  return {
    typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
    value: {
      sender: args.sender ?? '',
      contract: args.contract,
      msg: args.msg,
      funds: args.funds ?? [],
    },
  }
}
