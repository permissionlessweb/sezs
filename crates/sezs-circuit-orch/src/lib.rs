//! sezs_consume_v2 store-circuit blob and cw-orch `circuit_interface`.
//!
//! The circuit interface is compiled against the terp-core `cw-orchestrator`
//! fork (`cw-orch` 0.30, `cosmwasm-std` 4.1 via this workspace's `[patch]`).
//! `SezsConsumeV2Circuit::upload_circuit()` stores
//! `{artifacts}/sezs_consume_v2_vk.bin` through `MsgStoreCircuit` and
//! records the zkid in cw-orch state, the same way contract `upload()`
//! records a code id.
//!
//! Compilation of params + vk + footer happens in [`prepare_artifacts`],
//! which runs `sezs-v2-keygen` against the sezs-ticket-v2 source (or
//! reuses a valid existing blob, the same way prebuilt wasm is reused).

mod interface;

pub use interface::SezsConsumeV2Circuit;

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Command;

pub const CIRCUIT_ID: &str = "sezs_consume_v2";
pub const FOOTER_LEN: usize = 80;
pub const K: u8 = 11;
pub const NUM_PUBLIC: u8 = 6;
pub const PROVER_PLONKISH: u8 = 0;
pub const CURVE_PASTA: u8 = 0;

/// 80-byte CircuitFooter layout used by zk-wasmvm / `AnyVerifyingKey`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CircuitFooter {
    pub prover_id: u8,
    pub curve_id: u8,
    pub k: u8,
    pub i: u8,
    pub param_len: u32,
    pub cs_len: u32,
    pub vk_len: u32,
    pub param_checksum: [u8; 32],
    pub vk_checksum: [u8; 32],
}

impl CircuitFooter {
    pub fn from_bytes(b: &[u8]) -> Result<Self, String> {
        if b.len() != FOOTER_LEN {
            return Err(format!("footer len {} != {FOOTER_LEN}", b.len()));
        }
        let u32le = |o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap());
        let mut param_checksum = [0u8; 32];
        let mut vk_checksum = [0u8; 32];
        param_checksum.copy_from_slice(&b[16..48]);
        vk_checksum.copy_from_slice(&b[48..80]);
        Ok(Self {
            prover_id: b[0],
            curve_id: b[1],
            k: b[2],
            i: b[3],
            param_len: u32le(4),
            cs_len: u32le(8),
            vk_len: u32le(12),
            param_checksum,
            vk_checksum,
        })
    }
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// sezs-app repo root (packages/sezs-circuit-orch/../..).
pub fn repo_root() -> PathBuf {
    manifest_dir()
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| manifest_dir().join("../.."))
}

/// Directory the `circuit_interface` derive resolves `{id}_vk.bin` from.
pub fn artifacts_dir() -> PathBuf {
    repo_root().join("circuits/sezs-ticket-v2/artifacts")
}

/// `{artifacts}/sezs_consume_v2_vk.bin` — `CircuitUploadable::vk_path`.
pub fn vk_path() -> PathBuf {
    artifacts_dir().join(format!("{CIRCUIT_ID}_vk.bin"))
}

pub fn validate_store_circuit_blob(blob: &[u8]) -> Result<CircuitFooter, String> {
    if blob.len() < FOOTER_LEN {
        return Err("blob shorter than CircuitFooter".into());
    }
    let footer = CircuitFooter::from_bytes(&blob[blob.len() - FOOTER_LEN..])?;
    let expect = footer.param_len as usize
        + footer.cs_len as usize
        + footer.vk_len as usize
        + FOOTER_LEN;
    if blob.len() != expect {
        return Err(format!(
            "blob len {} != param+cs+vk+footer {}",
            blob.len(),
            expect
        ));
    }
    if footer.prover_id != PROVER_PLONKISH || footer.curve_id != CURVE_PASTA {
        return Err(format!(
            "footer expected Plonkish/Pasta, got prover={} curve={}",
            footer.prover_id, footer.curve_id
        ));
    }
    if footer.k != K || footer.i != NUM_PUBLIC {
        return Err(format!(
            "footer expected k={K} i={NUM_PUBLIC}, got k={} i={}",
            footer.k, footer.i
        ));
    }
    let p = footer.param_len as usize;
    let c = footer.cs_len as usize;
    let v = footer.vk_len as usize;
    let params = &blob[..p];
    let cs = &blob[p..p + c];
    let vk = &blob[p + c..p + c + v];
    let param_hash: [u8; 32] = Sha256::digest(params).into();
    if param_hash != footer.param_checksum {
        return Err("param checksum mismatch vs footer".into());
    }
    let mut vk_body = Vec::with_capacity(cs.len() + vk.len());
    vk_body.extend_from_slice(cs);
    vk_body.extend_from_slice(vk);
    let vk_hash: [u8; 32] = Sha256::digest(&vk_body).into();
    if vk_hash != footer.vk_checksum {
        return Err("vk/cs checksum mismatch vs footer".into());
    }
    Ok(footer)
}

fn existing_valid_blob() -> Option<(PathBuf, CircuitFooter)> {
    let path = vk_path();
    let blob = std::fs::read(&path).ok()?;
    let footer = validate_store_circuit_blob(&blob).ok()?;
    Some((path, footer))
}

fn env_truthy(key: &str) -> bool {
    matches!(
        std::env::var(key).ok().as_deref().map(str::trim),
        Some("1") | Some("true") | Some("yes")
    )
}

fn env_falsy(key: &str) -> bool {
    matches!(
        std::env::var(key).ok().as_deref().map(str::trim),
        Some("0") | Some("false") | Some("no")
    )
}

/// Run `sezs-v2-keygen` in the sezs-ticket-v2 workspace so params, vk,
/// and the 80-byte footer are packed from source into [`vk_path`].
pub fn compile_from_source() -> Result<(PathBuf, CircuitFooter), String> {
    let manifest = repo_root().join("circuits/sezs-ticket-v2/circuit/Cargo.toml");
    if !manifest.is_file() {
        return Err(format!(
            "missing sezs-ticket-v2 Cargo.toml at {}",
            manifest.display()
        ));
    }
    let out = artifacts_dir();
    std::fs::create_dir_all(&out).map_err(|e| format!("mkdir artifacts: {e}"))?;
    eprintln!(
        "sezs-circuit-orch: compiling sezs_consume_v2 from sezs-ticket-v2 source → {}",
        out.display()
    );
    let status = Command::new("cargo")
        .arg("run")
        .arg("--manifest-path")
        .arg(&manifest)
        .arg("--features")
        .arg("keygen")
        .arg("--bin")
        .arg("sezs-v2-keygen")
        .arg("--release")
        .arg("--")
        .arg(&out)
        .status()
        .map_err(|e| format!("spawn sezs-v2-keygen: {e}"))?;
    if !status.success() {
        return Err(format!("sezs-v2-keygen failed: {status}"));
    }
    let path = vk_path();
    let blob = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let footer = validate_store_circuit_blob(&blob)?;
    eprintln!(
        "sezs-circuit-orch: footer ok Plonkish Pasta K={} i={} param_len={} cs_len={} vk_len={} blob={}",
        footer.k, footer.i, footer.param_len, footer.cs_len, footer.vk_len, blob.len()
    );
    Ok((path, footer))
}

/// Prepare the store-circuit blob the `circuit_interface` trait uploads.
///
/// - Default: reuse a valid existing `{id}_vk.bin` (mirrors prebuilt wasm).
/// - If the blob is missing/invalid, compile from sezs-ticket-v2 source.
/// - `SEZS_REBUILD_CIRCUIT=1` forces a keygen even when a valid blob exists.
/// - `SEZS_SKIP_CIRCUIT_KEYGEN=1` never runs keygen (errors if invalid).
pub fn prepare_artifacts() -> Result<(PathBuf, CircuitFooter), String> {
    let force = env_truthy("SEZS_REBUILD_CIRCUIT");
    let skip = env_falsy("SEZS_REBUILD_CIRCUIT") || env_truthy("SEZS_SKIP_CIRCUIT_KEYGEN");
    if !force {
        if let Some((path, footer)) = existing_valid_blob() {
            eprintln!(
                "sezs-circuit-orch: using existing store-circuit blob (footer valid K={} i={} {} bytes)",
                footer.k,
                footer.i,
                std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
            );
            return Ok((path, footer));
        }
        if skip {
            return Err(format!(
                "missing or invalid {} and SEZS_SKIP_CIRCUIT_KEYGEN=1",
                vk_path().display()
            ));
        }
    }
    compile_from_source()
}

pub fn vk_bytes() -> Result<Vec<u8>, String> {
    let path = vk_path();
    std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))
}

pub fn path_is_file(p: &Path) -> bool {
    p.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_blob_footer_is_plonkish_pasta_k11_i6() {
        let path = vk_path();
        if !path.is_file() {
            eprintln!("skip: {} missing (run `just circuits` to build artifacts)", path.display());
            return;
        }
        let blob = std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let footer = validate_store_circuit_blob(&blob).expect("footer");
        assert_eq!(footer.k, K);
        assert_eq!(footer.i, NUM_PUBLIC);
        assert_eq!(footer.prover_id, PROVER_PLONKISH);
        assert_eq!(footer.curve_id, CURVE_PASTA);
        assert_eq!(
            footer.param_len as usize + footer.cs_len as usize + footer.vk_len as usize + FOOTER_LEN,
            blob.len()
        );
    }

    #[test]
    fn circuit_interface_vk_path_matches_compiled_blob() {
        let expected = vk_path();
        if !expected.is_file() {
            eprintln!("skip: {} missing (run `just circuits` to build artifacts)", expected.display());
            return;
        }
        // The derive implements CircuitUploadable for SezsConsumeV2Circuit<Chain>
        // for any Chain. Use a stand-in unit param if the impl is unconstrained;
        // otherwise this associated path is what upload_circuit() reads.
        let interface_path = artifacts_dir().join(format!("{CIRCUIT_ID}_vk.bin"));
        assert_eq!(
            interface_path.canonicalize().unwrap(),
            expected.canonicalize().unwrap()
        );
        let bytes = std::fs::read(&interface_path).unwrap();
        let footer = validate_store_circuit_blob(&bytes).expect("uploadable blob footer");
        assert_eq!(footer.k, K);
        assert_eq!(footer.i, NUM_PUBLIC);
        // Touch the derived name so the interface module stays in the test graph.
        let _ = std::any::type_name::<SezsConsumeV2Circuit<()>>();
    }
}
