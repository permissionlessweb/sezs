/**
 * Build cast submit bodies that **never** include plaintext vote.
 *
 * G-privacy: automated tests assert no vote value / choice secret in JSON.
 * Ciphertext encrypt: encryptVote.ts (V-UI-1 wasm).
 */

import {
  CIPHERTEXT_SIZE,
  PUBLIC_KEY_SIZE,
  ShieldedCastPrepared,
  ShieldedCastSubmitBody,
  ShieldedVoteCryptoError,
} from './types'
import { bytesToHex, isHexString } from './hex'

export type BuildCastSubmitBodyInput = {
  roundId: string
  proposalId?: string
  eaPkHex: string
  ciphertextHex: string
  proofHex?: string
  nullifierHex?: string
  publicInputsHex?: string
  proofMode?: string
  /**
   * If true, require non-empty proofHex (product/lab path after V-UI-2).
   * Default false for encrypt-only.
   */
  requireProof?: boolean
}

/**
 * Fields that must never appear on the cast body (plaintext vote surface).
 */
export const FORBIDDEN_CAST_BODY_KEYS = [
  'vote',
  'voteValue',
  'vote_value',
  'plaintext',
  'choiceValue',
  'choice_value',
  'ballot',
  'ballotValue',
  'cleartext',
  'localChoiceId',
] as const

/**
 * Normalize and validate hex fields; construct wire body without plaintext.
 */
export function buildCastSubmitBody(
  input: BuildCastSubmitBodyInput
): ShieldedCastSubmitBody {
  const roundId = input.roundId?.trim()
  if (!roundId) {
    throw new Error('roundId is required')
  }
  if (!isHexString(input.eaPkHex, PUBLIC_KEY_SIZE)) {
    throw new ShieldedVoteCryptoError(
      'bad_ea_pk_len',
      `eaPkHex must be ${PUBLIC_KEY_SIZE} bytes hex`
    )
  }
  if (!isHexString(input.ciphertextHex, CIPHERTEXT_SIZE)) {
    throw new ShieldedVoteCryptoError(
      'bad_ciphertext_len',
      `ciphertextHex must be ${CIPHERTEXT_SIZE} bytes hex`
    )
  }
  if (input.requireProof && !input.proofHex?.trim()) {
    throw new Error('cast proof required (fail-closed without proofHex)')
  }
  if (input.proofHex && !isHexString(input.proofHex)) {
    throw new Error('proofHex must be hex')
  }
  if (input.nullifierHex && !isHexString(input.nullifierHex)) {
    throw new Error('nullifierHex must be hex')
  }

  const body: ShieldedCastSubmitBody = {
    protocol: 'terp-shielded-vote/v1',
    roundId,
    eaPkHex: strip0x(input.eaPkHex).toLowerCase(),
    ciphertextHex: strip0x(input.ciphertextHex).toLowerCase(),
    statusSummary: input.proofHex?.trim()
      ? input.proofMode?.includes('lab')
        ? 'lab_proof'
        : 'encrypted+proof'
      : 'encrypted',
  }
  if (input.proposalId?.trim()) {
    body.proposalId = input.proposalId.trim()
  }
  if (input.proofHex?.trim()) {
    body.proofHex = strip0x(input.proofHex).toLowerCase()
  }
  if (input.nullifierHex?.trim()) {
    body.nullifierHex = strip0x(input.nullifierHex).toLowerCase()
  }
  if (input.publicInputsHex?.trim()) {
    if (!isHexString(input.publicInputsHex, 288)) {
      throw new Error('publicInputsHex must be 288-byte hex')
    }
    body.publicInputsHex = strip0x(input.publicInputsHex).toLowerCase()
  }
  if (input.proofMode?.trim()) {
    body.proofMode = input.proofMode.trim()
  }
  return body
}

/**
 * Prepare in-memory cast from encrypt result + round context.
 * `localChoiceId` stays off the wire body (local UX only).
 */
export function prepareCastFromEncrypt(args: {
  roundId: string
  proposalId?: string
  eaPk: Uint8Array
  ciphertext: Uint8Array
  engine: string
  localChoiceId?: string
  proofHex?: string
  nullifierHex?: string
  publicInputsHex?: string
  proofMode?: string
}): ShieldedCastPrepared {
  if (args.eaPk.length !== PUBLIC_KEY_SIZE) {
    throw new ShieldedVoteCryptoError(
      'bad_ea_pk_len',
      `ea_pk length ${args.eaPk.length}`
    )
  }
  if (args.ciphertext.length !== CIPHERTEXT_SIZE) {
    throw new ShieldedVoteCryptoError(
      'bad_ciphertext_len',
      `ciphertext length ${args.ciphertext.length}`
    )
  }
  return {
    roundId: args.roundId,
    proposalId: args.proposalId,
    eaPkHex: bytesToHex(args.eaPk),
    ciphertextHex: bytesToHex(args.ciphertext),
    localChoiceId: args.localChoiceId,
    proofHex: args.proofHex,
    nullifierHex: args.nullifierHex,
    publicInputsHex: args.publicInputsHex,
    proofMode: args.proofMode,
    engine: args.engine,
  }
}

/** Convert prepared cast → submit body (drops localChoiceId). */
export function preparedToSubmitBody(
  prepared: ShieldedCastPrepared,
  opts?: { requireProof?: boolean }
): ShieldedCastSubmitBody {
  return buildCastSubmitBody({
    roundId: prepared.roundId,
    proposalId: prepared.proposalId,
    eaPkHex: prepared.eaPkHex,
    ciphertextHex: prepared.ciphertextHex,
    proofHex: prepared.proofHex,
    nullifierHex: prepared.nullifierHex,
    publicInputsHex: prepared.publicInputsHex,
    proofMode: prepared.proofMode,
    requireProof: opts?.requireProof,
  })
}

/**
 * G-privacy helper: return forbidden keys found in a JSON-serializable body.
 * Also flags if a known plaintext vote integer appears as a raw JSON number
 * when `forbiddenPlaintextValues` is provided.
 */
export function findPrivacyLeaksInBody(
  body: unknown,
  forbiddenPlaintextValues: number[] = []
): string[] {
  const json = JSON.stringify(body)
  const leaks: string[] = []
  for (const key of FORBIDDEN_CAST_BODY_KEYS) {
    if (json.includes(`"${key}"`)) {
      leaks.push(`key:${key}`)
    }
  }
  for (const v of forbiddenPlaintextValues) {
    const re = new RegExp(`[:\\[]\\s*${v}\\s*[,\\}\\]]`)
    if (re.test(json)) {
      leaks.push(`plaintext_value:${v}`)
    }
  }
  return leaks
}

function strip0x(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
}
