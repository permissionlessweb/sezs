/**
 * Module-facing cast body builder — client encrypt + lab prove + submit.
 * Never POSTs plaintext.
 *
 * Encrypt API (V-UI-1): encryptVote wasm
 * Prove API (V-UI-2): labProveCast (lab_mock_prove_v1; Halo2 residual)
 * Submit API (V-UI-4): submitCast → lab HTTP or prepared wasm msg
 */

import {
  bytesToHex,
  encryptVote,
  ensureEncryptAvailable,
  findPrivacyLeaksInBody,
  isHexString,
  labProveCast,
  prepareCastFromEncrypt,
  preparedToSubmitBody,
  PUBLIC_KEY_SIZE,
  hexToBytes,
  submitCast,
  type ShieldedCastPrepared,
  type ShieldedCastSubmitBody,
  type ShieldedVoteChoice,
  type SubmitCastResult,
  LAB_PROOF_MODE,
} from '@dao-dao/utils'

export type CastEncryptAndBuildInput = {
  roundId: string
  proposalId?: string
  eaPkHex: string
  choice: ShieldedVoteChoice
  /** Default true for stable private voting lab path. */
  requireProof?: boolean
  /** Attach lab proof (default true when requireProof). */
  withLabProof?: boolean
  proofHex?: string
  nullifierHex?: string
  publicInputsHex?: string
  /** Deterministic nullifier seed for tests. */
  nullifierSeedHex?: string
}

export type CastEncryptAndBuildResult = {
  prepared: ShieldedCastPrepared
  body: ShieldedCastSubmitBody
  /** Always empty when builder is correct. */
  privacyLeaks: string[]
}

/**
 * Encrypt (client-side wasm), optional lab prove, build submit body.
 * Plaintext choice.value only reaches encryptVote — never the body.
 */
export async function encryptAndBuildCastBody(
  input: CastEncryptAndBuildInput
): Promise<CastEncryptAndBuildResult> {
  const encryptOk = await ensureEncryptAvailable()
  if (!encryptOk) {
    throw new Error(
      'Encrypt unavailable (vote-elgamal-wasm not loaded). Cast fail-closed.'
    )
  }
  if (!input.roundId.trim()) {
    throw new Error('roundId is required')
  }
  if (!isHexString(input.eaPkHex, PUBLIC_KEY_SIZE)) {
    throw new Error(`eaPkHex must be ${PUBLIC_KEY_SIZE}-byte hex`)
  }

  const requireProof = input.requireProof ?? true
  const withLabProof = input.withLabProof ?? requireProof

  const eaPk = hexToBytes(input.eaPkHex)
  const ciphertext = await encryptVote(eaPk, input.choice.value)

  let proofHex = input.proofHex
  let nullifierHex = input.nullifierHex
  let publicInputsHex = input.publicInputsHex
  let proofMode: string | undefined
  let engine = 'vote-elgamal-wasm'

  if (withLabProof && !proofHex) {
    const proved = await labProveCast({
      roundId: input.roundId.trim(),
      proposalId: input.proposalId,
      eaPkHex: input.eaPkHex,
      ciphertextHex: bytesToHex(ciphertext),
      nullifierSeedHex: input.nullifierSeedHex,
    })
    proofHex = proved.proofHex
    nullifierHex = proved.nullifierHex
    publicInputsHex = proved.publicInputsHex
    proofMode = proved.mode
    engine = `vote-elgamal-wasm+${LAB_PROOF_MODE}`
  }

  const prepared = prepareCastFromEncrypt({
    roundId: input.roundId.trim(),
    proposalId: input.proposalId?.trim() || undefined,
    eaPk,
    ciphertext,
    engine,
    localChoiceId: input.choice.id,
    proofHex,
    nullifierHex,
    publicInputsHex,
    proofMode,
  })

  const body = preparedToSubmitBody(prepared, {
    requireProof,
  })

  const privacyLeaks = findPrivacyLeaksInBody(body, [input.choice.value])
  if (privacyLeaks.length > 0) {
    throw new Error(
      `privacy invariant violated in cast body: ${privacyLeaks.join(', ')}`
    )
  }

  return { prepared, body, privacyLeaks }
}

/**
 * V-UI-4 submit: lab HTTP or prepared CosmWasm execute msg.
 */
export async function submitShieldedCast(args: {
  castContract?: string
  labCastBaseUrl?: string
  body: ShieldedCastSubmitBody
  requireProof?: boolean
  sender?: string
}): Promise<SubmitCastResult> {
  return submitCast({
    castContract: args.castContract,
    labCastBaseUrl: args.labCastBaseUrl,
    body: args.body,
    publicInputsHex: args.body.publicInputsHex,
    proofMode: args.body.proofMode ?? LAB_PROOF_MODE,
    requireProof: args.requireProof ?? true,
    sender: args.sender,
  })
}

/**
 * Back-compat alias used by tests/UI — now real submit path.
 */
export async function submitCastStub(args: {
  castContract?: string
  labCastBaseUrl?: string
  body: ShieldedCastSubmitBody
}): Promise<SubmitCastResult> {
  return submitShieldedCast(args)
}

export { buildCastSubmitBody, findPrivacyLeaksInBody } from '@dao-dao/utils'
