//! # sezs_consume_v2
//!
//! Production ticket consume circuit for SEZS / Speakez Sessions (TICKET-V2-SPEC.md).
//! Halo2 IPA over Pasta from the zakura fork, the same stack Terp's zk-wasmvm
//! verifies with `proof_instance_verify` (`Params<vesta::Affine>`, Blake2b transcript).
//!
//! Private: `secret`, `sku`, Merkle `siblings[D]`, `bits[D]`, `alpha`.
//! Public instance (6 × 32-byte LE, in this order): `root, N, event_id, domain, rk_x, rk_y`.
//!
//! ```text
//! C    = Poseidon(secret, sku, event_id)        leaf (shape unchanged from v1)
//! root = Merkle(C, siblings, bits)               depth D, parent = Poseidon(left, right)
//! N    = Poseidon(secret, event_id)              door nullifier
//! ask  = Poseidon(AK_TAG, secret, domain)        never leaves the holder
//! rk   = [ask]·SpendAuthG + [alpha]·SpendAuthG   re-randomised RedPallas key
//! ```
//!
//! Poseidon is the **standard** `P128Pow5T3` (Orchard) instance, so the chain's
//! `poseidon_hash_pallas` host can recompute roots. The secret never leaves the
//! holder's device: nothing in this crate sends it anywhere.

#[cfg(feature = "keygen")]
pub mod blob;
pub mod bundle;
pub mod circuit;
pub mod consent;
pub mod encode;
pub mod keys;
pub mod tables;
pub mod tree;

pub use bundle::{Bundle, BUNDLE_VERSION};
pub use circuit::{ConsumeV2, Witness};
pub use encode::{domain_fp, event_id_fp, sku_fp, fp_from_le, fp_to_le, secret_from_bytes};
pub use tree::{GuestTree, MerklePath};

use pasta_curves::pallas;

/// Merkle depth: 1,024 tickets per event root.
pub const DEPTH: usize = 10;
/// Circuit size.
pub const K: u32 = 11;

/// Public-instance row indices.
pub const ROOT: usize = 0;
pub const NULLIFIER: usize = 1;
pub const EVENT_ID: usize = 2;
pub const DOMAIN: usize = 3;
pub const RK_X: usize = 4;
pub const RK_Y: usize = 5;
pub const NUM_PUBLIC: usize = 6;

/// The production circuit type.
pub type Circuit = ConsumeV2<DEPTH>;

/// Standard P128Pow5T3 Poseidon, ConstantLength<2>.
pub fn p2(a: pallas::Base, b: pallas::Base) -> pallas::Base {
    use halo2_poseidon::{ConstantLength, Hash, P128Pow5T3};
    Hash::<_, P128Pow5T3, ConstantLength<2>, 3, 2>::init().hash([a, b])
}

/// Standard P128Pow5T3 Poseidon, ConstantLength<3>.
pub fn p3(a: pallas::Base, b: pallas::Base, c: pallas::Base) -> pallas::Base {
    use halo2_poseidon::{ConstantLength, Hash, P128Pow5T3};
    Hash::<_, P128Pow5T3, ConstantLength<3>, 3, 2>::init().hash([a, b, c])
}

/// Ticket commitment `C = Poseidon(secret, sku, event_id)`.
pub fn commitment(secret: pallas::Base, sku: pallas::Base, event_id: pallas::Base) -> pallas::Base {
    p3(secret, sku, event_id)
}

/// Door nullifier `N = Poseidon(secret, event_id)`.
pub fn nullifier(secret: pallas::Base, event_id: pallas::Base) -> pallas::Base {
    p2(secret, event_id)
}

/// Serialise the 6 public inputs exactly as the contract passes them to
/// `proof_instance_verify`: `root‖N‖event_id‖domain‖rk_x‖rk_y`, 32-byte LE each.
pub fn instance_bytes(pi: &[pallas::Base; NUM_PUBLIC]) -> [u8; NUM_PUBLIC * 32] {
    let mut out = [0u8; NUM_PUBLIC * 32];
    for (i, x) in pi.iter().enumerate() {
        out[i * 32..(i + 1) * 32].copy_from_slice(&fp_to_le(x));
    }
    out
}

/// Seeded CSPRNG (ChaCha12). Native: seeded from the OS. Browser: seeded from
/// `crypto.getRandomValues` by the wasm wrapper.
pub fn rng_from_seed(seed: [u8; 32]) -> rand::rngs::StdRng {
    use rand::SeedableRng;
    rand::rngs::StdRng::from_seed(seed)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn os_rng() -> rand::rngs::StdRng {
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).expect("os randomness");
    rng_from_seed(seed)
}
