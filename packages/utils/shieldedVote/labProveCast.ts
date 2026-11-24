/**
 * V-UI-2 lab cast prove path.
 *
 * Honest: this is **not** Halo2 ZKP #2. It produces a deterministic lab proof
 * envelope that binds public-input wire + enc_share under a domain tag so
 * submit/nullifier surfaces can require "proof present" fail-closed.
 *
 * Product Halo2 prove (wasm worker / remote prover) replaces `mode: lab_mock`
 * without changing PI layout (V-UI-0) or execute msg shape (V-UI-4).
 */

import { bytesToHex, hexToBytes, isHexString } from './hex'
import {
  CAST_PI_WIRE_SIZE,
  buildCastPublicInputWire,
  castPublicInputWireToHex,
  parseProposalIdU32,
  roundIdToChunk,
  sha256Bytes,
  type CastPublicInputSlots,
} from './publicInputs'
import { CIPHERTEXT_SIZE, PUBLIC_KEY_SIZE } from './types'

export const LAB_PROOF_DOMAIN = 'terp-shielded-vote/v1/lab_mock_prove' as const
export const LAB_PROOF_MODE = 'lab_mock_prove_v1' as const

export type LabCastProveInput = {
  roundId: string
  proposalId?: string
  eaPkHex: string
  ciphertextHex: string
  /** Optional fixed fields for tests; otherwise lab placeholders. */
  vanNullifierHex?: string
  rVpkHex?: string
  voteAuthorityNoteNewHex?: string
  voteCommitmentHex?: string
  voteCommTreeRootHex?: string
  anchorHeight?: number | bigint
  /** Optional seed for deterministic nullifier (tests). */
  nullifierSeedHex?: string
}

export type LabCastProofResult = {
  mode: typeof LAB_PROOF_MODE
  /** Lab proof blob hex (includes domain tag + binding digest). */
  proofHex: string
  /** 288-byte PI wire hex. */
  publicInputsHex: string
  nullifierHex: string
  /** Safe summary — never plaintext vote. */
  statusSummary: 'lab_proof'
  /** True only for lab mock (not production Halo2). */
  isLabMock: true
}

function requireHex32(label: string, hex: string | undefined): Uint8Array {
  if (!hex || !isHexString(hex, 32)) {
    throw new Error(`${label} must be 32-byte hex`)
  }
  return hexToBytes(hex)
}

async function randomOrSeeded32(seedHex?: string): Promise<Uint8Array> {
  if (seedHex && isHexString(seedHex, 32)) {
    return hexToBytes(seedHex)
  }
  if (seedHex && isHexString(seedHex)) {
    return sha256Bytes(hexToBytes(seedHex))
  }
  const out = new Uint8Array(32)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(out)
    return out
  }
  // Node fallback
  const { randomBytes } = await import('node:crypto')
  return new Uint8Array(randomBytes(32))
}

/**
 * Build lab PI slots + proof binding ciphertext.
 * Nullifier is random (or seeded) 32B — uniqueness enforced at submit.
 */
export async function labProveCast(
  input: LabCastProveInput
): Promise<LabCastProofResult> {
  if (!isHexString(input.eaPkHex, PUBLIC_KEY_SIZE)) {
    throw new Error(`eaPkHex must be ${PUBLIC_KEY_SIZE}-byte hex`)
  }
  if (!isHexString(input.ciphertextHex, CIPHERTEXT_SIZE)) {
    throw new Error(`ciphertextHex must be ${CIPHERTEXT_SIZE}-byte hex`)
  }

  const vanNullifier =
    input.vanNullifierHex != null
      ? requireHex32('vanNullifierHex', input.vanNullifierHex)
      : await randomOrSeeded32(input.nullifierSeedHex)

  const rVpk =
    input.rVpkHex != null
      ? requireHex32('rVpkHex', input.rVpkHex)
      : await sha256Bytes(
          new TextEncoder().encode(`${LAB_PROOF_DOMAIN}|r_vpk|${input.roundId}`)
        )
  const voteAuthorityNoteNew =
    input.voteAuthorityNoteNewHex != null
      ? requireHex32('voteAuthorityNoteNewHex', input.voteAuthorityNoteNewHex)
      : await sha256Bytes(
          new TextEncoder().encode(`${LAB_PROOF_DOMAIN}|van_new|${input.roundId}`)
        )
  const voteCommitment =
    input.voteCommitmentHex != null
      ? requireHex32('voteCommitmentHex', input.voteCommitmentHex)
      : await sha256Bytes(
          new Uint8Array([
            ...new TextEncoder().encode(`${LAB_PROOF_DOMAIN}|vc|`),
            ...hexToBytes(input.ciphertextHex),
          ])
        )
  const voteCommTreeRoot =
    input.voteCommTreeRootHex != null
      ? requireHex32('voteCommTreeRootHex', input.voteCommTreeRootHex)
      : await sha256Bytes(
          new TextEncoder().encode(`${LAB_PROOF_DOMAIN}|root|${input.roundId}`)
        )

  const slots: CastPublicInputSlots = {
    vanNullifier,
    rVpk,
    voteAuthorityNoteNew,
    voteCommitment,
    voteCommTreeRoot,
    anchorHeight: input.anchorHeight ?? 1,
    proposalId: parseProposalIdU32(input.proposalId),
    votingRoundId: await roundIdToChunk(input.roundId),
    eaPk: hexToBytes(input.eaPkHex),
  }

  const piWire = buildCastPublicInputWire(slots)
  if (piWire.length !== CAST_PI_WIRE_SIZE) {
    throw new Error('internal PI wire size mismatch')
  }

  const ct = hexToBytes(input.ciphertextHex)
  const bindMaterial = new Uint8Array(
    LAB_PROOF_DOMAIN.length + 1 + piWire.length + ct.length
  )
  bindMaterial.set(new TextEncoder().encode(LAB_PROOF_DOMAIN), 0)
  bindMaterial[LAB_PROOF_DOMAIN.length] = 0
  bindMaterial.set(piWire, LAB_PROOF_DOMAIN.length + 1)
  bindMaterial.set(ct, LAB_PROOF_DOMAIN.length + 1 + piWire.length)
  const binding = await sha256Bytes(bindMaterial)

  // Proof envelope: magic || version || binding(32) || nullifier(32)
  const magic = new TextEncoder().encode('TSVP') // Terp Shielded Vote Proof (lab)
  const proof = new Uint8Array(4 + 1 + 32 + 32)
  proof.set(magic, 0)
  proof[4] = 1 // version
  proof.set(binding, 5)
  proof.set(vanNullifier, 37)

  return {
    mode: LAB_PROOF_MODE,
    proofHex: bytesToHex(proof),
    publicInputsHex: castPublicInputWireToHex(piWire),
    nullifierHex: bytesToHex(vanNullifier),
    statusSummary: 'lab_proof',
    isLabMock: true,
  }
}

/**
 * Verify lab mock proof structure + binding (not Halo2).
 * Used by lab submit surface for fail-closed checks.
 */
export async function verifyLabMockProof(args: {
  proofHex: string
  publicInputsHex: string
  ciphertextHex: string
  nullifierHex?: string
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isHexString(args.proofHex)) {
    return { ok: false, reason: 'proofHex not hex' }
  }
  if (!isHexString(args.publicInputsHex, CAST_PI_WIRE_SIZE)) {
    return { ok: false, reason: 'publicInputsHex must be 288 bytes' }
  }
  if (!isHexString(args.ciphertextHex, CIPHERTEXT_SIZE)) {
    return { ok: false, reason: 'ciphertextHex bad length' }
  }
  const proof = hexToBytes(args.proofHex)
  if (proof.length !== 4 + 1 + 32 + 32) {
    return { ok: false, reason: `lab proof length ${proof.length}` }
  }
  const magic = new TextDecoder().decode(proof.slice(0, 4))
  if (magic !== 'TSVP') {
    return { ok: false, reason: 'bad lab proof magic' }
  }
  if (proof[4] !== 1) {
    return { ok: false, reason: 'unsupported lab proof version' }
  }
  const piWire = hexToBytes(args.publicInputsHex)
  const ct = hexToBytes(args.ciphertextHex)
  const bindMaterial = new Uint8Array(
    LAB_PROOF_DOMAIN.length + 1 + piWire.length + ct.length
  )
  bindMaterial.set(new TextEncoder().encode(LAB_PROOF_DOMAIN), 0)
  bindMaterial[LAB_PROOF_DOMAIN.length] = 0
  bindMaterial.set(piWire, LAB_PROOF_DOMAIN.length + 1)
  bindMaterial.set(ct, LAB_PROOF_DOMAIN.length + 1 + piWire.length)
  const expected = await sha256Bytes(bindMaterial)
  const got = proof.slice(5, 37)
  for (let i = 0; i < 32; i++) {
    if (got[i] !== expected[i]) {
      return { ok: false, reason: 'lab proof binding mismatch' }
    }
  }
  if (args.nullifierHex) {
    const nf = hexToBytes(args.nullifierHex)
    const proofNf = proof.slice(37, 69)
    for (let i = 0; i < 32; i++) {
      if (nf[i] !== proofNf[i]) {
        return { ok: false, reason: 'nullifier mismatch vs lab proof' }
      }
    }
  }
  return { ok: true }
}
