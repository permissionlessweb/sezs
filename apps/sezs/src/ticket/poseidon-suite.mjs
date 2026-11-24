/**
 * Poseidon suite lock for ticket v2.
 *
 * The owner approved the standard halo2_gadgets P128Pow5T3 / host
 * `poseidon_hash_pallas` recommendation in TICKET-V2-SPEC §2.3.
 * Leaf argument order is unchanged: C = Poseidon(ticketSecret, sku, event_id),
 * N = Poseidon(ticketSecret, event_id), parent = Poseidon(left, right).
 *
 * All C / N / root values change when this suite is used. There are no real
 * tickets yet, so the switch is safe. The previous SEZS-custom constants
 * (SHA256("sezs-poseidon-pallas-t3-v1"||i)) must not be used for v2 roots.
 *
 * This module is the coordination point with the circuit worker. JS still
 * needs the P128Pow5T3 MDS / round-constant tables ported from halo2_gadgets
 * before browser-side commitments match the circuit; until that port is
 * wired, call sites should import SUITE and treat custom poseidon.mjs as
 * legacy. The local root publisher records the suite name on each publish.
 */
export const POSEIDON_SUITE = 'P128Pow5T3'
export const POSEIDON_T = 3
export const POSEIDON_ALPHA = 5
export const POSEIDON_RF = 8
export const POSEIDON_RP = 56
export const TREE_DEPTH = 10
export const ROOT_PUBLISH_MS = 15 * 60 * 1000
