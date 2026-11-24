//! Resolve prebuilt wasm artifacts. Circuit blobs live in sezs-circuit-orch.
use anyhow::{bail, Result};
use std::path::{Path, PathBuf};

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// sezs-app repo root (packages/sezs-orch/../..).
pub fn repo_root() -> PathBuf {
    manifest_dir()
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| manifest_dir().join("../.."))
}

fn first_existing(cands: &[PathBuf]) -> Option<PathBuf> {
    cands.iter().find(|p| p.is_file()).cloned()
}

pub fn sezs_wasm(stem: &str) -> Result<PathBuf> {
    let root = repo_root();
    let name = format!("{stem}.wasm");
    let underscore = name.replace('-', "_");
    let mut cands: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = std::env::var("SEZS_CW_AVE_ARTIFACTS") {
        let dir = PathBuf::from(dir);
        cands.push(dir.join(&name));
        cands.push(dir.join(&underscore));
    }
    if let Ok(cw) = std::env::var("CW_AVE_ROOT") {
        let dir = PathBuf::from(cw).join("artifacts");
        cands.push(dir.join(&name));
        cands.push(dir.join(&underscore));
    }
    // Optional sibling checkout: <sezs-repo>/../cw-ave/artifacts
    cands.push(root.join("../cw-ave/artifacts").join(&name));
    cands.push(root.join("../cw-ave/artifacts").join(&underscore));
    first_existing(&cands).ok_or_else(|| {
        anyhow::anyhow!(
            "missing SEZS wasm {stem}: set SEZS_CW_AVE_ARTIFACTS or CW_AVE_ROOT to a built https://github.com/permissionlessweb/cw-ave checkout"
        )
    })
}

/// External artifacts that already live in the user's other repos. Never invent a new oracle.
pub fn dao_wasm(stem: &str) -> Result<PathBuf> {
    let root = repo_root();
    let terp = root.join("../terp-core/crates/dao-contracts/artifacts");
    let p = terp.join(format!("{stem}.wasm"));
    if p.is_file() {
        Ok(p)
    } else {
        bail!("missing DAO wasm {stem} at dao-contracts/artifacts")
    }
}

pub fn terp_rs_wasm(stem: &str) -> Result<PathBuf> {
    let root = repo_root();
    let p = root
        .join("../terp-core/crates/terp-rs/artifacts")
        .join(format!("{stem}.wasm"));
    if p.is_file() {
        Ok(p)
    } else {
        bail!("missing terp-rs wasm {stem}")
    }
}

pub fn path_is_file(p: &Path) -> bool {
    p.is_file()
}
