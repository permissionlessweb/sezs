//! # sezs-ticket-v2-verify
//!
//! Stateless door checks for `ConsumeTicket` (TICKET-V2-SPEC.md §4, interface in
//! `sezs-app/apps/sezs/docs/TICKET-V2-INTERFACE.md`). The calling contract owns state:
//! usher-group membership, the `ROOTS` set, the `NULLIFIERS` map, and writing `N`.
//! This crate does the cryptography and the consent-message rules:
//!
//! 1. canonical field encodings for `root, N, rk_x, rk_y`;
//! 2. consent parsing: live challenge bound to this event, domain, the **sender**
//!    (usher) and block time ± TTL; or the fixed printed message bound to `N` and
//!    the contract's `door_auth_pubkey`;
//! 3. `proof_instance_verify(zkid, proof, root‖N‖event_id‖domain‖rk_x‖rk_y)`;
//! 4. `redpallas_spendauth_verify(message, sig, rk)` where `rk` is `rk_x` with the
//!    parity of `rk_y` in the top bit (no curve math in the contract).
//!
//! It has no `cosmwasm-std` dependency. On `wasm32` it calls Terp zk-wasmvm host
//! imports directly ([`TerpHost`]); tests and other hosts implement [`ZkHost`].

#![cfg_attr(not(test), no_std)]
extern crate alloc;

use alloc::{string::String, vec::Vec};
use core::fmt;

pub const LIVE_TAG: &[u8] = b"sezs-door-v2\0";
pub const PRINT_TAG: &[u8] = b"sezs-print-v2\0";
pub const NONCE_LEN: usize = 16;
pub const MAX_ADDR: usize = 128;
pub const NUM_PUBLIC: usize = 6;
/// Default live-challenge window (spec: ±10 minutes of block time).
pub const DEFAULT_CHALLENGE_TTL_S: u64 = 600;

/// Pallas base-field modulus p, little-endian.
const P_LE: [u8; 32] = [
    0x01, 0x00, 0x00, 0x00, 0xed, 0x30, 0x2d, 0x99, 0x1b, 0xf9, 0x4c, 0x09, 0xfc, 0x98, 0x46, 0x22,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40,
];

/// `x < p` for a 32-byte little-endian value.
pub fn is_canonical(x: &[u8; 32]) -> bool {
    for i in (0..32).rev() {
        if x[i] != P_LE[i] {
            return x[i] < P_LE[i];
        }
    }
    false
}

/// Host crypto the checks need. Implemented by [`TerpHost`] on wasm32.
pub trait ZkHost {
    /// `Ok(true)` valid, `Ok(false)` crypto-invalid, `Err` format/host error.
    fn proof_instance_verify(&self, zkid: u64, proof: &[u8], instances: &[u8]) -> Result<bool, String>;
    fn redpallas_spendauth_verify(&self, message: &[u8], sig: &[u8], rk: &[u8]) -> Result<bool, String>;
}

/// Terp zk-wasmvm host imports, called directly (works with any cosmwasm-std).
pub struct TerpHost;

#[repr(C)]
struct Region {
    offset: u32,
    capacity: u32,
    length: u32,
}

impl Region {
    fn of(b: &[u8]) -> Self {
        Region { offset: b.as_ptr() as usize as u32, capacity: b.len() as u32, length: b.len() as u32 }
    }
}

#[cfg(target_arch = "wasm32")]
extern "C" {
    fn proof_instance_verify(zkid: u32, proof_ptr: u32, proof_len: u32, i_ptr: u32, i_len: u32) -> u32;
    fn redpallas_spendauth_verify(message_ptr: u32, signature_ptr: u32, public_key_ptr: u32) -> u32;
}

impl ZkHost for TerpHost {
    #[allow(unused_variables)]
    fn proof_instance_verify(&self, zkid: u64, proof: &[u8], instances: &[u8]) -> Result<bool, String> {
        let zkid32 = u32::try_from(zkid).map_err(|_| String::from("zkid exceeds u32"))?;
        let (p, i) = (Region::of(proof), Region::of(instances));
        #[cfg(target_arch = "wasm32")]
        let code = unsafe {
            proof_instance_verify(
                zkid32,
                &p as *const Region as usize as u32,
                proof.len() as u32,
                &i as *const Region as usize as u32,
                instances.len() as u32,
            )
        };
        #[cfg(not(target_arch = "wasm32"))]
        let code: u32 = {
            let _ = (zkid32, p, i);
            return Err(String::from("TerpHost is wasm32-only"));
        };
        #[allow(unreachable_code)]
        match code {
            0 => Ok(true),
            1 => Ok(false),
            e => Err(alloc::format!("proof_instance_verify host error {e}")),
        }
    }

    #[allow(unused_variables)]
    fn redpallas_spendauth_verify(&self, message: &[u8], sig: &[u8], rk: &[u8]) -> Result<bool, String> {
        let (m, s, k) = (Region::of(message), Region::of(sig), Region::of(rk));
        #[cfg(target_arch = "wasm32")]
        let code = unsafe {
            redpallas_spendauth_verify(
                &m as *const Region as usize as u32,
                &s as *const Region as usize as u32,
                &k as *const Region as usize as u32,
            )
        };
        #[cfg(not(target_arch = "wasm32"))]
        let code: u32 = {
            let _ = (m, s, k);
            return Err(String::from("TerpHost is wasm32-only"));
        };
        #[allow(unreachable_code)]
        match code {
            0 => Ok(true),
            1 => Ok(false),
            e => Err(alloc::format!("redpallas_spendauth_verify host error {e}")),
        }
    }
}

/// Per-event door configuration held by the contract.
#[derive(Clone, Debug)]
pub struct DoorConfig<'a> {
    /// `sezs_consume_v2` circuit id from `MsgStoreFullCircuit`. 0 = fail closed.
    pub zkid: u64,
    pub event_id_fp: [u8; 32],
    pub domain_fp: [u8; 32],
    /// Signed into printed authorisations. Empty = printed tickets disabled.
    pub door_auth_pubkey: &'a [u8],
    pub challenge_ttl_s: u64,
}

#[derive(Clone, Debug)]
pub enum Consent<'a> {
    Live { challenge: &'a [u8], sig: &'a [u8] },
    Printed { sig: &'a [u8] },
}

#[derive(Clone, Debug)]
pub struct ConsumeInput<'a> {
    pub proof: &'a [u8],
    pub root: [u8; 32],
    pub nullifier: [u8; 32],
    pub rk_x: [u8; 32],
    pub rk_y: [u8; 32],
    pub consent: Consent<'a>,
}

/// Caller context: the tx sender (must be the usher who issued a live challenge)
/// and block time in unix seconds.
#[derive(Clone, Copy, Debug)]
pub struct Ctx<'a> {
    pub sender: &'a str,
    pub now_s: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VerifyError {
    NotConfigured,
    NonCanonical(&'static str),
    BadChallenge(&'static str),
    ChallengeWrongEvent,
    ChallengeWrongDomain,
    ChallengeWrongUsher,
    ChallengeExpired,
    PrintedDisabled,
    BadSignatureLength,
    InvalidProof,
    InvalidConsent,
    Host(String),
}

impl fmt::Display for VerifyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VerifyError::NotConfigured => write!(f, "door not configured (zkid = 0)"),
            VerifyError::NonCanonical(w) => write!(f, "{w} is not a canonical Pallas field element"),
            VerifyError::BadChallenge(w) => write!(f, "bad live challenge: {w}"),
            VerifyError::ChallengeWrongEvent => write!(f, "challenge is for another event"),
            VerifyError::ChallengeWrongDomain => write!(f, "challenge is for another domain"),
            VerifyError::ChallengeWrongUsher => write!(f, "challenge was issued to another usher"),
            VerifyError::ChallengeExpired => write!(f, "challenge outside the time window"),
            VerifyError::PrintedDisabled => write!(f, "printed tickets disabled (no door_auth_pubkey)"),
            VerifyError::BadSignatureLength => write!(f, "consent signature must be 64 bytes"),
            VerifyError::InvalidProof => write!(f, "ticket proof invalid"),
            VerifyError::InvalidConsent => write!(f, "holder consent signature invalid"),
            VerifyError::Host(e) => write!(f, "host: {e}"),
        }
    }
}

/// Parsed live challenge.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiveChallenge<'a> {
    pub event_id_fp: [u8; 32],
    pub domain_fp: [u8; 32],
    pub nonce: [u8; NONCE_LEN],
    pub issued_at: u64,
    pub usher: &'a str,
}

pub fn parse_live_challenge(b: &[u8]) -> Result<LiveChallenge<'_>, VerifyError> {
    let fixed = LIVE_TAG.len() + 32 + 32 + NONCE_LEN + 8;
    if !b.starts_with(LIVE_TAG) {
        return Err(VerifyError::BadChallenge("tag"));
    }
    if b.len() <= fixed || b.len() > fixed + MAX_ADDR {
        return Err(VerifyError::BadChallenge("length"));
    }
    let o = LIVE_TAG.len();
    let arr32 = |s: usize| -> [u8; 32] { b[s..s + 32].try_into().unwrap() };
    let event_id_fp = arr32(o);
    let domain_fp = arr32(o + 32);
    let nonce: [u8; NONCE_LEN] = b[o + 64..o + 64 + NONCE_LEN].try_into().unwrap();
    let issued_at = u64::from_be_bytes(b[o + 64 + NONCE_LEN..fixed].try_into().unwrap());
    let usher = core::str::from_utf8(&b[fixed..]).map_err(|_| VerifyError::BadChallenge("usher utf8"))?;
    Ok(LiveChallenge { event_id_fp, domain_fp, nonce, issued_at, usher })
}

pub fn printed_message(event_id_fp: &[u8; 32], domain_fp: &[u8; 32], nullifier: &[u8; 32], door_auth_pubkey: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(PRINT_TAG.len() + 96 + door_auth_pubkey.len());
    v.extend_from_slice(PRINT_TAG);
    v.extend_from_slice(event_id_fp);
    v.extend_from_slice(domain_fp);
    v.extend_from_slice(nullifier);
    v.extend_from_slice(door_auth_pubkey);
    v
}

/// `root‖N‖event_id‖domain‖rk_x‖rk_y`, 6 × 32 bytes LE.
pub fn instance_bytes(cfg: &DoorConfig<'_>, i: &ConsumeInput<'_>) -> [u8; NUM_PUBLIC * 32] {
    let mut out = [0u8; NUM_PUBLIC * 32];
    for (k, x) in [&i.root, &i.nullifier, &cfg.event_id_fp, &cfg.domain_fp, &i.rk_x, &i.rk_y].iter().enumerate() {
        out[k * 32..(k + 1) * 32].copy_from_slice(*x);
    }
    out
}

/// 32-byte RedPallas key: `rk_x` with the parity of `rk_y` in the top bit.
pub fn rk_bytes(rk_x: &[u8; 32], rk_y: &[u8; 32]) -> [u8; 32] {
    let mut out = *rk_x;
    out[31] |= (rk_y[0] & 1) << 7;
    out
}

/// What the caller records on success.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Verified {
    pub nullifier: [u8; 32],
    pub live: bool,
}

/// Full stateless check. The caller must ALSO check, before or after:
/// sender ∈ usher group, `root` ∈ ROOTS, `nullifier` ∉ NULLIFIERS; then record `N`.
pub fn verify_consume<H: ZkHost>(
    host: &H,
    cfg: &DoorConfig<'_>,
    input: &ConsumeInput<'_>,
    ctx: Ctx<'_>,
) -> Result<Verified, VerifyError> {
    if cfg.zkid == 0 {
        return Err(VerifyError::NotConfigured);
    }
    for (name, x) in [("root", &input.root), ("nullifier", &input.nullifier), ("rk_x", &input.rk_x), ("rk_y", &input.rk_y)] {
        if !is_canonical(x) {
            return Err(VerifyError::NonCanonical(name));
        }
    }
    // Consent rules first: cheap, and they fail before the expensive proof check.
    let (message, sig, live): (Vec<u8>, &[u8], bool) = match &input.consent {
        Consent::Live { challenge, sig } => {
            let c = parse_live_challenge(challenge)?;
            if c.event_id_fp != cfg.event_id_fp {
                return Err(VerifyError::ChallengeWrongEvent);
            }
            if c.domain_fp != cfg.domain_fp {
                return Err(VerifyError::ChallengeWrongDomain);
            }
            if c.usher != ctx.sender {
                return Err(VerifyError::ChallengeWrongUsher);
            }
            if c.issued_at.abs_diff(ctx.now_s) > cfg.challenge_ttl_s {
                return Err(VerifyError::ChallengeExpired);
            }
            (challenge.to_vec(), sig, true)
        }
        Consent::Printed { sig } => {
            if cfg.door_auth_pubkey.is_empty() {
                return Err(VerifyError::PrintedDisabled);
            }
            (printed_message(&cfg.event_id_fp, &cfg.domain_fp, &input.nullifier, cfg.door_auth_pubkey), sig, false)
        }
    };
    if sig.len() != 64 {
        return Err(VerifyError::BadSignatureLength);
    }
    let inst = instance_bytes(cfg, input);
    match host.proof_instance_verify(cfg.zkid, input.proof, &inst) {
        Ok(true) => {}
        Ok(false) => return Err(VerifyError::InvalidProof),
        Err(e) => return Err(VerifyError::Host(e)),
    }
    let rk = rk_bytes(&input.rk_x, &input.rk_y);
    match host.redpallas_spendauth_verify(&message, sig, &rk) {
        Ok(true) => {}
        Ok(false) => return Err(VerifyError::InvalidConsent),
        Err(e) => return Err(VerifyError::Host(e)),
    }
    Ok(Verified { nullifier: input.nullifier, live })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Mock {
        proof_ok: bool,
        sig_ok: bool,
        seen: RefCell<Vec<(Vec<u8>, Vec<u8>)>>,
    }
    impl ZkHost for Mock {
        fn proof_instance_verify(&self, _z: u64, _p: &[u8], i: &[u8]) -> Result<bool, String> {
            self.seen.borrow_mut().push((i.to_vec(), vec![]));
            Ok(self.proof_ok)
        }
        fn redpallas_spendauth_verify(&self, m: &[u8], _s: &[u8], rk: &[u8]) -> Result<bool, String> {
            self.seen.borrow_mut().push((m.to_vec(), rk.to_vec()));
            Ok(self.sig_ok)
        }
    }
    fn mock(p: bool, s: bool) -> Mock {
        Mock { proof_ok: p, sig_ok: s, seen: RefCell::new(vec![]) }
    }
    fn fe(b: u8) -> [u8; 32] {
        let mut x = [0u8; 32];
        x[0] = b;
        x
    }
    fn cfg() -> DoorConfig<'static> {
        DoorConfig { zkid: 7, event_id_fp: fe(1), domain_fp: fe(2), door_auth_pubkey: b"door", challenge_ttl_s: 600 }
    }
    fn challenge(event: u8, domain: u8, at: u64, usher: &str) -> Vec<u8> {
        let mut v = LIVE_TAG.to_vec();
        v.extend_from_slice(&fe(event));
        v.extend_from_slice(&fe(domain));
        v.extend_from_slice(&[9u8; 16]);
        v.extend_from_slice(&at.to_be_bytes());
        v.extend_from_slice(usher.as_bytes());
        v
    }
    fn input<'a>(consent: Consent<'a>) -> ConsumeInput<'a> {
        ConsumeInput { proof: b"p", root: fe(3), nullifier: fe(4), rk_x: fe(5), rk_y: fe(1), consent }
    }
    const SIG: [u8; 64] = [0u8; 64];

    #[test]
    fn live_ok_and_instance_order() {
        let ch = challenge(1, 2, 1000, "terp1usher");
        let m = mock(true, true);
        let v = verify_consume(&m, &cfg(), &input(Consent::Live { challenge: &ch, sig: &SIG }), Ctx { sender: "terp1usher", now_s: 1300 }).unwrap();
        assert!(v.live);
        let seen = m.seen.borrow();
        let inst = &seen[0].0;
        assert_eq!(inst.len(), 192);
        assert_eq!(&inst[0..32], &fe(3)); // root
        assert_eq!(&inst[32..64], &fe(4)); // N
        assert_eq!(&inst[64..96], &fe(1)); // event
        assert_eq!(&inst[96..128], &fe(2)); // domain
        assert_eq!(seen[1].0, ch);
        let mut rk = fe(5);
        rk[31] |= 0x80; // y odd
        assert_eq!(seen[1].1, rk.to_vec());
    }

    #[test]
    fn live_rules() {
        let c = cfg();
        let m = mock(true, true);
        let run = |ch: &[u8], sender: &str, now: u64| {
            verify_consume(&m, &c, &input(Consent::Live { challenge: ch, sig: &SIG }), Ctx { sender, now_s: now })
        };
        assert_eq!(run(&challenge(9, 2, 1000, "u"), "u", 1000), Err(VerifyError::ChallengeWrongEvent));
        assert_eq!(run(&challenge(1, 9, 1000, "u"), "u", 1000), Err(VerifyError::ChallengeWrongDomain));
        assert_eq!(run(&challenge(1, 2, 1000, "u"), "other", 1000), Err(VerifyError::ChallengeWrongUsher));
        assert_eq!(run(&challenge(1, 2, 1000, "u"), "u", 1601), Err(VerifyError::ChallengeExpired));
        assert!(run(&challenge(1, 2, 1000, "u"), "u", 400).is_ok());
        assert_eq!(run(b"junk", "u", 1000), Err(VerifyError::BadChallenge("tag")));
    }

    #[test]
    fn printed_and_failures() {
        let m = mock(true, true);
        let v = verify_consume(&m, &cfg(), &input(Consent::Printed { sig: &SIG }), Ctx { sender: "x", now_s: 0 }).unwrap();
        assert!(!v.live);
        assert_eq!(m.seen.borrow()[1].0, printed_message(&fe(1), &fe(2), &fe(4), b"door"));
        let mut c = cfg();
        c.door_auth_pubkey = b"";
        assert_eq!(verify_consume(&m, &c, &input(Consent::Printed { sig: &SIG }), Ctx { sender: "x", now_s: 0 }), Err(VerifyError::PrintedDisabled));
        c = cfg();
        c.zkid = 0;
        assert_eq!(verify_consume(&m, &c, &input(Consent::Printed { sig: &SIG }), Ctx { sender: "x", now_s: 0 }), Err(VerifyError::NotConfigured));
        assert_eq!(verify_consume(&mock(false, true), &cfg(), &input(Consent::Printed { sig: &SIG }), Ctx { sender: "x", now_s: 0 }), Err(VerifyError::InvalidProof));
        assert_eq!(verify_consume(&mock(true, false), &cfg(), &input(Consent::Printed { sig: &SIG }), Ctx { sender: "x", now_s: 0 }), Err(VerifyError::InvalidConsent));
        assert_eq!(verify_consume(&m, &cfg(), &input(Consent::Printed { sig: &[0u8; 63] }), Ctx { sender: "x", now_s: 0 }), Err(VerifyError::BadSignatureLength));
        let mut i = input(Consent::Printed { sig: &SIG });
        i.root = P_LE;
        assert_eq!(verify_consume(&m, &cfg(), &i, Ctx { sender: "x", now_s: 0 }), Err(VerifyError::NonCanonical("root")));
    }

    #[test]
    fn canonical_boundary() {
        let mut pm1 = P_LE;
        pm1[0] = 0;
        assert!(is_canonical(&pm1));
        assert!(!is_canonical(&P_LE));
        assert!(!is_canonical(&[0xff; 32]));
    }
}
