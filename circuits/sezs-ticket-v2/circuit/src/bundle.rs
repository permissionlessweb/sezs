//! Proof bundle the holder makes at home and shows at the door.
//!
//! Wire format (v2): `0x02 ‖ root ‖ N ‖ rk_x ‖ rk_y ‖ proof` (4 × 32 bytes + proof).
//! `event_id` and `domain` are not carried: the contract supplies them.
//! `alpha` stays on the holder's device so it can sign consent at the door.

use crate::{
    circuit::Witness,
    encode::fp_from_le,
    instance_bytes, keys,
    tree::MerklePath,
    DEPTH, DOMAIN, EVENT_ID, NULLIFIER, NUM_PUBLIC, RK_X, RK_Y, ROOT,
};
use ff::Field;
use halo2_proofs::{
    plonk::{create_proof, verify_proof, SingleVerifier},
    transcript::{Blake2bRead, Blake2bWrite, Challenge255},
};
use pasta_curves::{pallas, vesta};

pub const BUNDLE_VERSION: u8 = 2;
pub const HEADER_LEN: usize = 1 + 4 * 32;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bundle {
    pub root: [u8; 32],
    pub nullifier: [u8; 32],
    pub rk_x: [u8; 32],
    pub rk_y: [u8; 32],
    pub proof: Vec<u8>,
}

impl Bundle {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut v = Vec::with_capacity(HEADER_LEN + self.proof.len());
        v.push(BUNDLE_VERSION);
        v.extend_from_slice(&self.root);
        v.extend_from_slice(&self.nullifier);
        v.extend_from_slice(&self.rk_x);
        v.extend_from_slice(&self.rk_y);
        v.extend_from_slice(&self.proof);
        v
    }

    pub fn from_bytes(b: &[u8]) -> Result<Self, String> {
        if b.len() <= HEADER_LEN || b[0] != BUNDLE_VERSION {
            return Err("not an sezs v2 bundle".into());
        }
        let f = |i: usize| -> [u8; 32] { b[1 + 32 * i..1 + 32 * (i + 1)].try_into().unwrap() };
        Ok(Self { root: f(0), nullifier: f(1), rk_x: f(2), rk_y: f(3), proof: b[HEADER_LEN..].to_vec() })
    }

    /// 32-byte RedPallas key for consent (no curve math).
    pub fn rk(&self) -> [u8; 32] {
        crate::circuit::rk_bytes_from_xy(&self.rk_x, &self.rk_y)
    }

    /// Instance bytes for a given event/domain encoding.
    pub fn instance(&self, event_id: pallas::Base, domain: pallas::Base) -> Result<[u8; NUM_PUBLIC * 32], String> {
        Ok(instance_bytes(&self.public_inputs(event_id, domain)?))
    }

    pub fn public_inputs(&self, event_id: pallas::Base, domain: pallas::Base) -> Result<[pallas::Base; NUM_PUBLIC], String> {
        let mut pi = [pallas::Base::ZERO; NUM_PUBLIC];
        pi[ROOT] = fp_from_le(&self.root)?;
        pi[NULLIFIER] = fp_from_le(&self.nullifier)?;
        pi[EVENT_ID] = event_id;
        pi[DOMAIN] = domain;
        pi[RK_X] = fp_from_le(&self.rk_x)?;
        pi[RK_Y] = fp_from_le(&self.rk_y)?;
        Ok(pi)
    }
}

/// Holder inputs for one proof.
pub struct ProveInput {
    pub secret: pallas::Base,
    pub sku: pallas::Base,
    pub event_id: pallas::Base,
    pub domain: pallas::Base,
    pub path: MerklePath,
    /// Public 16-byte nonce stored next to the bundle. `alpha` is derived from
    /// `(secret, alpha_nonce)`, so the holder keeps no second secret: the ticket
    /// secret plus this nonce re-derive `rsk` at the door.
    pub alpha_nonce: [u8; 16],
}

pub const ALPHA_TAG: &[u8] = b"sezs-ticket-alpha-v2\0";

/// `alpha = from_uniform(SHA-512(ALPHA_TAG ‖ secret ‖ alpha_nonce))`.
pub fn derive_alpha(secret: &pallas::Base, alpha_nonce: &[u8; 16]) -> pallas::Scalar {
    use ff::{FromUniformBytes, PrimeField};
    use sha2::{Digest, Sha512};
    let mut h = Sha512::new();
    h.update(ALPHA_TAG);
    h.update(secret.to_repr());
    h.update(alpha_nonce);
    let wide: [u8; 64] = h.finalize().into();
    pallas::Scalar::from_uniform_bytes(&wide)
}

/// `rsk = ask(secret, domain) + alpha(secret, nonce)`: the consent signing key for one bundle.
pub fn rsk(secret: &pallas::Base, domain: &pallas::Base, alpha_nonce: &[u8; 16]) -> pallas::Scalar {
    crate::circuit::ask(*secret, *domain) + derive_alpha(secret, alpha_nonce)
}

/// Output: the bundle plus `rsk = ask + alpha` (keep on device; signs consent).
pub struct Proven {
    pub bundle: Bundle,
    pub rsk: pallas::Scalar,
}

pub fn prove<R: rand_core::Rng>(input: &ProveInput, rng: &mut R) -> Result<Proven, String> {
    let alpha = derive_alpha(&input.secret, &input.alpha_nonce);
    let w = Witness::<DEPTH> {
        secret: input.secret,
        sku: input.sku,
        event_id: input.event_id,
        domain: input.domain,
        siblings: input.path.siblings,
        bits: input.path.bits,
        alpha,
    };
    let pi = w.public_inputs();
    let k = keys::get();
    let mut tr = Blake2bWrite::<_, vesta::Affine, Challenge255<_>>::init(vec![]);
    create_proof(&k.params, &k.pk, &[w.circuit()], &[&[&pi]], &mut *rng, &mut tr)
        .map_err(|e| format!("create_proof: {e:?}"))?;
    let proof = tr.finalize();
    let le = |x: &pallas::Base| crate::encode::fp_to_le(x);
    Ok(Proven {
        bundle: Bundle { root: le(&pi[ROOT]), nullifier: le(&pi[NULLIFIER]), rk_x: le(&pi[RK_X]), rk_y: le(&pi[RK_Y]), proof },
        rsk: w.rsk(),
    })
}

/// Native verify with the same params/transcript the zk-wasmvm host uses.
pub fn verify(bundle: &Bundle, event_id: pallas::Base, domain: pallas::Base) -> Result<(), String> {
    let pi = bundle.public_inputs(event_id, domain)?;
    let k = keys::get();
    let strategy = SingleVerifier::new(&k.params);
    let mut tr = Blake2bRead::<_, vesta::Affine, Challenge255<_>>::init(&bundle.proof[..]);
    verify_proof(&k.params, k.vk(), strategy, &[&[&pi]], &mut tr).map_err(|e| format!("verify_proof: {e:?}"))
}
