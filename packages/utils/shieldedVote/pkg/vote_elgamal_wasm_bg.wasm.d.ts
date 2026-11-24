/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const ciphertextSize: () => number;
export const encryptVote: (a: number, b: number, c: bigint) => [number, number, number, number];
export const encryptVoteWithRandomness: (a: number, b: number, c: bigint, d: number, e: number) => [number, number, number, number];
export const identityCiphertext: () => [number, number];
export const publicKeySize: () => number;
export const spendAuthGCompressed: () => [number, number];
export const __wbindgen_exn_store: (a: number) => void;
export const __externref_table_alloc: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
