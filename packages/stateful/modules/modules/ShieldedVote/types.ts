/**
 * ShieldedVote module variables (DAO widget storage).
 *
 * Privacy: module config must never store plaintext ballots.
 * Only round identifiers, ea_pk hex, contract addresses, and choice labels/values
 * for client-side encrypt (values stay in browser during cast).
 *
 * Handoff: docs/research/HANDOFF-DAO-DAO-UI-VOTE-SDK-PRIVACY-CAST.md (V-UI-3)
 */

import type { ShieldedVoteChoice } from '@dao-dao/utils'

export type ShieldedVoteModuleData = {
  /**
   * Optional markdown intro above the cast surface.
   */
  description: string
  /**
   * Default / configured round or ceremony session id.
   * Empty → user enters at cast time.
   */
  defaultRoundId: string
  /**
   * Optional proposal id within the round.
   */
  defaultProposalId: string
  /**
   * Election authority public key: 32-byte compressed Pallas, lowercase hex.
   * Source: ceremony / round query once V-UI-0 freezes the path.
   */
  eaPkHex: string
  /**
   * Optional CosmWasm cast / ceremony contract (V-UI-4 prepared wasm path).
   */
  castContract: string
  /**
   * Lab cast HTTP base URL (V-UI-4 stable lab submit). e.g. http://127.0.0.1:PORT
   * When set, Cast uses lab execute with nullifier fail-closed.
   */
  labCastBaseUrl: string
  /**
   * When true, require cast proof (V-UI-2 lab or product) before submit.
   * Default true for stable private voting path.
   */
  requireProof: boolean
  /**
   * Lab mode — Dev tools + lab_mock_prove_v1. Not mainnet Halo2.
   */
  labMode: boolean
  /**
   * Vote choices (id, label, value). Values are encrypt domain only.
   * Stored as JSON array string for TextArea editor simplicity, or structured.
   */
  choices: ShieldedVoteChoice[] | string
}

export type { ShieldedVoteChoice }

/** Runtime cast status shown in UI (safe summaries only). */
export type ShieldedCastUiStatus =
  | 'idle'
  | 'encrypt_unavailable'
  | 'missing_config'
  | 'ready'
  | 'encrypting'
  | 'encrypted'
  | 'proving'
  | 'submitted'
  | 'submit_stub'
  | 'error'

export type ShieldedCastUiState = {
  status: ShieldedCastUiStatus
  /** Safe one-line status; never includes plaintext vote. */
  message: string
  /** Ciphertext hex prefix for display (not full secret material dump by default). */
  ciphertextPreview?: string
  engine?: string
}
