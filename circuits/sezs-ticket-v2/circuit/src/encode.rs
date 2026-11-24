//! Field encodings shared by the browser, the backend and the contract.
//!
//! * `event_id_fp(s)`: UTF-8 bytes of the event id, zero-padded to 32, little-endian,
//!   top two bits of byte 31 cleared (same as v1 `fromStrBytes`). Ids longer than
//!   31 bytes are rejected so two ids can never collide by truncation.
//! * `sku_fp(s)`: same encoding as the event id.
//! * `domain_fp(s)`: `SHA-256("sezs-domain-v2\0" ‖ utf8(domain))`, top two bits cleared.
//!   Domains are URLs and can be long, so they are hashed.
//! * secrets: 32 bytes, top two bits cleared (v1 `fitSecretToField`).

use ff::PrimeField;
use pasta_curves::pallas;
use sha2::{Digest, Sha256};

pub const DOMAIN_TAG: &[u8] = b"sezs-domain-v2\0";

fn masked(mut b: [u8; 32]) -> pallas::Base {
    b[31] &= 0x3f;
    // < 2^254 < p, always canonical.
    pallas::Base::from_repr(b).unwrap()
}

/// Short string (≤ 31 bytes) to field, v1-compatible.
pub fn short_str_fp(s: &str) -> Result<pallas::Base, String> {
    let src = s.as_bytes();
    if src.is_empty() || src.len() > 31 {
        return Err(format!("id must be 1..=31 bytes, got {}", src.len()));
    }
    let mut b = [0u8; 32];
    b[..src.len()].copy_from_slice(src);
    Ok(masked(b))
}

pub fn event_id_fp(event_id: &str) -> Result<pallas::Base, String> {
    short_str_fp(event_id)
}

pub fn sku_fp(sku: &str) -> Result<pallas::Base, String> {
    short_str_fp(sku)
}

pub fn domain_fp(domain: &str) -> pallas::Base {
    let mut h = Sha256::new();
    h.update(DOMAIN_TAG);
    h.update(domain.as_bytes());
    masked(h.finalize().into())
}

/// 32 bytes → secret field element (top two bits cleared).
pub fn secret_from_bytes(b: [u8; 32]) -> pallas::Base {
    masked(b)
}

/// Strict canonical decode (rejects ≥ p).
pub fn fp_from_le(b: &[u8]) -> Result<pallas::Base, String> {
    let arr: [u8; 32] = b.try_into().map_err(|_| format!("field element must be 32 bytes, got {}", b.len()))?;
    Option::from(pallas::Base::from_repr(arr)).ok_or_else(|| "non-canonical field element".to_string())
}

pub fn fp_to_le(x: &pallas::Base) -> [u8; 32] {
    x.to_repr()
}

pub fn to_hex(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 15) as usize] as char);
    }
    s
}

pub fn from_hex(s: &str) -> Result<Vec<u8>, String> {
    let s = s.trim().trim_start_matches("0x");
    if s.len() % 2 != 0 {
        return Err("odd hex".into());
    }
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}
