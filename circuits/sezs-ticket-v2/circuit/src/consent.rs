//! Door consent messages and RedPallas (Orchard SpendAuth) signing under `rk`.
//!
//! Live challenge (usher device → holder), all fixed-width except the address:
//! ```text
//! "sezs-door-v2\0" (12) ‖ event_id_fp (32) ‖ domain_fp (32) ‖ nonce (16) ‖ issued_at u64 BE (8) ‖ usher addr (utf8, 1..=128)
//! ```
//! Printed authorization (signed at print time):
//! ```text
//! "sezs-print-v2\0" (13) ‖ event_id_fp (32) ‖ domain_fp (32) ‖ N (32) ‖ door_auth_pubkey (1..=128)
//! ```
//! The holder signs the exact bytes. The contract parses and checks them, then
//! calls `redpallas_spendauth_verify(msg, sig, rk)`.

use crate::encode::fp_to_le;
use ff::PrimeField;
use pasta_curves::pallas;
use reddsa::{orchard::SpendAuth, Signature, SigningKey, VerificationKey};

pub const LIVE_TAG: &[u8] = b"sezs-door-v2\0";
pub const PRINT_TAG: &[u8] = b"sezs-print-v2\0";
pub const NONCE_LEN: usize = 16;
pub const MAX_ADDR: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiveChallenge {
    pub event_id: [u8; 32],
    pub domain: [u8; 32],
    pub nonce: [u8; NONCE_LEN],
    pub issued_at: u64,
    pub usher: String,
}

impl LiveChallenge {
    pub fn new(event_id: pallas::Base, domain: pallas::Base, nonce: [u8; NONCE_LEN], issued_at: u64, usher: &str) -> Self {
        Self { event_id: fp_to_le(&event_id), domain: fp_to_le(&domain), nonce, issued_at, usher: usher.to_string() }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut v = Vec::with_capacity(LIVE_TAG.len() + 32 + 32 + NONCE_LEN + 8 + self.usher.len());
        v.extend_from_slice(LIVE_TAG);
        v.extend_from_slice(&self.event_id);
        v.extend_from_slice(&self.domain);
        v.extend_from_slice(&self.nonce);
        v.extend_from_slice(&self.issued_at.to_be_bytes());
        v.extend_from_slice(self.usher.as_bytes());
        v
    }

    pub fn from_bytes(b: &[u8]) -> Result<Self, String> {
        let fixed = LIVE_TAG.len() + 32 + 32 + NONCE_LEN + 8;
        if b.len() <= fixed || b.len() > fixed + MAX_ADDR || !b.starts_with(LIVE_TAG) {
            return Err("not an sezs-door-v2 challenge".into());
        }
        let mut o = LIVE_TAG.len();
        let mut take = |n: usize| {
            let s = &b[o..o + n];
            o += n;
            s
        };
        let event_id = take(32).try_into().unwrap();
        let domain = take(32).try_into().unwrap();
        let nonce = take(NONCE_LEN).try_into().unwrap();
        let issued_at = u64::from_be_bytes(take(8).try_into().unwrap());
        let usher = std::str::from_utf8(&b[fixed..]).map_err(|_| "usher addr not utf8".to_string())?.to_string();
        Ok(Self { event_id, domain, nonce, issued_at, usher })
    }
}

pub fn printed_message(event_id: pallas::Base, domain: pallas::Base, nullifier: &[u8; 32], door_auth_pubkey: &[u8]) -> Result<Vec<u8>, String> {
    if door_auth_pubkey.is_empty() || door_auth_pubkey.len() > MAX_ADDR {
        return Err("door_auth_pubkey must be 1..=128 bytes".into());
    }
    let mut v = Vec::new();
    v.extend_from_slice(PRINT_TAG);
    v.extend_from_slice(&fp_to_le(&event_id));
    v.extend_from_slice(&fp_to_le(&domain));
    v.extend_from_slice(nullifier);
    v.extend_from_slice(door_auth_pubkey);
    Ok(v)
}

/// RedPallas SpendAuth signature under `rsk`.
pub fn sign<R: rand_core::CryptoRng>(rsk: &pallas::Scalar, msg: &[u8], rng: &mut R) -> Result<[u8; 64], String> {
    let sk = SigningKey::<SpendAuth>::try_from(rsk.to_repr()).map_err(|e| format!("rsk: {e:?}"))?;
    Ok(sk.sign(rng, msg).into())
}

/// Native verify (same as the chain host `redpallas_spendauth_verify`).
pub fn verify(rk: &[u8; 32], msg: &[u8], sig: &[u8; 64]) -> bool {
    match VerificationKey::<SpendAuth>::try_from(*rk) {
        Ok(vk) => vk.verify(msg, &Signature::<SpendAuth>::from(*sig)).is_ok(),
        Err(_) => false,
    }
}
