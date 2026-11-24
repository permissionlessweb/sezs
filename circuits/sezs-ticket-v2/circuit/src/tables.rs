//! Fixed-base window tables for SpendAuthG (z/u values for the ECC chip).
//!
//! Searching for them takes ~100 s natively, so they ship as `tables.bin`
//! (Orchard ships its tables as constants the same way). `sezs-v2-dump-tables`
//! regenerates the file; a test checks the embedded copy matches the generator.

use ff::PrimeField;
use group::Curve;
use halo2_gadgets::ecc::chip::{H, NUM_WINDOWS, NUM_WINDOWS_SHORT};
use pasta_curves::{arithmetic::CurveExt, pallas};
use std::sync::OnceLock;

pub type Table = Vec<(u64, [pallas::Base; H])>;

static TABLES: &[u8] = include_bytes!("tables.bin");

/// Orchard / RedPallas SpendAuthG, so `rk` verifies with stock RedPallas SpendAuth.
pub fn spend_auth_g() -> pallas::Affine {
    static G: OnceLock<pallas::Affine> = OnceLock::new();
    *G.get_or_init(|| pallas::Point::hash_to_curve("z.cash:Orchard")(b"G").to_affine())
}

pub fn parse(bytes: &[u8], which: usize) -> Table {
    // layout: [u32 n_full][entries][u32 n_short][entries]; entry = u64 z ‖ H × 32-byte u
    let mut off = 0usize;
    let mut out = vec![];
    for t in 0..2 {
        let n = u32::from_le_bytes(bytes[off..off + 4].try_into().unwrap()) as usize;
        off += 4;
        for _ in 0..n {
            let z = u64::from_le_bytes(bytes[off..off + 8].try_into().unwrap());
            off += 8;
            let u: [pallas::Base; H] = core::array::from_fn(|i| {
                let b: [u8; 32] = bytes[off + 32 * i..off + 32 * (i + 1)].try_into().unwrap();
                pallas::Base::from_repr(b).unwrap()
            });
            off += 32 * H;
            if t == which {
                out.push((z, u));
            }
        }
    }
    out
}

pub fn full() -> &'static Table {
    static T: OnceLock<Table> = OnceLock::new();
    T.get_or_init(|| {
        let t = parse(TABLES, 0);
        assert_eq!(t.len(), NUM_WINDOWS);
        t
    })
}

pub fn short() -> &'static Table {
    static T: OnceLock<Table> = OnceLock::new();
    T.get_or_init(|| {
        let t = parse(TABLES, 1);
        assert_eq!(t.len(), NUM_WINDOWS_SHORT);
        t
    })
}

pub fn serialize(full: &Table, short: &Table) -> Vec<u8> {
    let mut v = vec![];
    for t in [full, short] {
        v.extend_from_slice(&(t.len() as u32).to_le_bytes());
        for (z, u) in t.iter() {
            v.extend_from_slice(&z.to_le_bytes());
            for x in u.iter() {
                v.extend_from_slice(&x.to_repr());
            }
        }
    }
    v
}

/// Slow path: search the tables from the generator (≈100 s native).
#[cfg(feature = "search-tables")]
pub fn search() -> Vec<u8> {
    use halo2_gadgets::ecc::chip::find_zs_and_us;
    let g = spend_auth_g();
    let f = find_zs_and_us(g, NUM_WINDOWS).expect("full");
    let s = find_zs_and_us(g, NUM_WINDOWS_SHORT).expect("short");
    serialize(&f, &s)
}

pub fn embedded() -> &'static [u8] {
    TABLES
}
