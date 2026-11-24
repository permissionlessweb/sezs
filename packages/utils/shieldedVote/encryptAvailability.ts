/**
 * Fail-closed helpers for UI when wasm is missing / unloadable.
 * Real encrypt lives in encryptVote.ts (V-UI-1).
 */

import { getElgamalWasmSync, loadElgamalWasm } from './encryptVote'
import { ShieldedVoteCryptoError } from './types'

/**
 * Try loading wasm once; returns true if encrypt path is usable.
 * Does not throw — UI uses this for button enablement.
 */
export async function ensureEncryptAvailable(): Promise<boolean> {
  if (getElgamalWasmSync()) {
    return true
  }
  try {
    await loadElgamalWasm()
    return true
  } catch {
    return false
  }
}

/** Sync check after a prior successful loadElgamalWasm / encryptVote. */
export function isEncryptVoteAvailable(): boolean {
  return getElgamalWasmSync() !== null
}

export function encryptAvailabilityMessage(available: boolean): string {
  if (available) {
    return 'Client-side ElGamal encrypt is available (vote-elgamal-wasm).'
  }
  return (
    'Client-side ElGamal encrypt is not loaded (vote-elgamal-wasm missing or failed). ' +
    'Cast is disabled — plaintext votes are never sent to a helper server. ' +
    'See packages/utils/shieldedVote/README.md to rebuild wasm.'
  )
}

export function rethrowAsCryptoError(e: unknown): never {
  if (e instanceof ShieldedVoteCryptoError) {
    throw e
  }
  throw new ShieldedVoteCryptoError(
    'encrypt_failed',
    e instanceof Error ? e.message : String(e),
    { cause: e }
  )
}

/** Documented FE import path for V-UI-1. */
export const ENCRYPT_WASM_IMPORT_PATH =
  '@dao-dao/utils/shieldedVote (encryptVote / loadElgamalWasm; pkg/vote_elgamal_wasm.js)'
