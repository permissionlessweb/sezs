/**
 * Shielded vote crypto + cast payload surface for dao-dao-ui (privacy cast).
 *
 * FE import:
 *   import { encryptVote, CIPHERTEXT_SIZE, buildCastSubmitBody, labProveCast, submitCast } from '@dao-dao/utils/shieldedVote'
 *
 * Encrypt: ./encryptVote (V-UI-1 wasm under ./pkg)
 * Cast body: ./castPayload (privacy-safe submit shape)
 * Prove: ./labProveCast (V-UI-2 lab path; Halo2 residual)
 * Submit: ./submitCast + ./labCastServer (V-UI-4)
 */

export * from './types'
export * from './hex'
export {
  castPayloadEncShare,
  encryptVote,
  encryptVoteWithRandomness,
  getElgamalWasmSync,
  isElgamalCiphertextBytes,
  loadElgamalWasm,
} from './encryptVote'
export * from './castPayload'
export {
  ensureEncryptAvailable,
  isEncryptVoteAvailable,
  encryptAvailabilityMessage,
  ENCRYPT_WASM_IMPORT_PATH,
} from './encryptAvailability'
export {
  CAST_PI_CHUNK_COUNT,
  CAST_PI_CHUNK_SIZE,
  CAST_PI_SLOT_NAMES,
  CAST_PI_WIRE_SIZE,
  buildCastPublicInputWire,
  castPublicInputWireToHex,
  encodeU32LeChunk,
  encodeU64LeChunk,
  parseProposalIdU32,
  roundIdToChunk,
  sha256Bytes,
  splitCastPublicInputWire,
  type CastPublicInputSlots,
} from './publicInputs'
export {
  LAB_PROOF_DOMAIN,
  LAB_PROOF_MODE,
  labProveCast,
  verifyLabMockProof,
  type LabCastProveInput,
  type LabCastProofResult,
} from './labProveCast'
export {
  buildCastShieldedVoteExecuteMsg,
  buildWasmExecuteBody,
  type BuildCastExecuteMsgInput,
  type CastShieldedVoteExecuteMsg,
  type CastShieldedVoteFields,
} from './castExecuteMsg'
export {
  queryLabCasts,
  submitCast,
  type SubmitCastInput,
  type SubmitCastResult,
} from './submitCast'
export {
  startLabCastServer,
  type LabCastServer,
  type StoredCast,
} from './labCastServer'
