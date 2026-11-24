/* tslint:disable */
/* eslint-disable */

export function ciphertextSize(): number;

/**
 * Encrypt vote under ea_pk (32 bytes) → 64-byte ciphertext.
 * Uses browser CSPRNG via getrandom/js.
 */
export function encryptVote(ea_pk: Uint8Array, vote_value: bigint): Uint8Array;

/**
 * Deterministic encrypt for golden tests / ZKP witness replay.
 * `r` is 32-byte LE Pallas scalar (non-zero).
 */
export function encryptVoteWithRandomness(ea_pk: Uint8Array, vote_value: bigint, r: Uint8Array): Uint8Array;

export function identityCiphertext(): Uint8Array;

export function publicKeySize(): number;

export function spendAuthGCompressed(): Uint8Array;
