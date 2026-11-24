//! Resolve prebuilt wasm artifacts.
//!
//! Lookup is environment-first, then in-repo `contracts/artifacts`, then an
//! optional *relative* sibling checkout. Absolute machine paths are never
//! hardcoded. See docs/BUILD.md.
use anyhow::Result;
use std::path::{Path, PathBuf};

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Repo root (crates/sezs-orch/../..).
pub fn repo_root() -> PathBuf {
    manifest_dir()
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| manifest_dir().join("../.."))
}

fn first_existing(cands: &[PathBuf]) -> Option<PathBuf> {
    cands.iter().find(|p| p.is_file()).cloned()
}

fn push_stem(cands: &mut Vec<PathBuf>, dir: PathBuf, stem: &str) {
    let name = format!("{stem}.wasm");
    let underscore = name.replace('-', "_");
    cands.push(dir.join(&name));
    if underscore != name {
        cands.push(dir.join(&underscore));
    }
}

/// In-repo SEZS contracts (cw-event-manifold) plus the cw-ave stack when
/// artifacts are supplied via env or a sibling checkout.
pub fn sezs_wasm(stem: &str) -> Result<PathBuf> {
    let root = repo_root();
    let mut cands: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = std::env::var("SEZS_CONTRACT_ARTIFACTS") {
        push_stem(&mut cands, PathBuf::from(dir), stem);
    }
    if let Ok(dir) = std::env::var("SEZS_CW_AVE_ARTIFACTS") {
        push_stem(&mut cands, PathBuf::from(dir), stem);
    }
    if let Ok(cw) = std::env::var("CW_AVE_ROOT") {
        push_stem(&mut cands, PathBuf::from(cw).join("artifacts"), stem);
    }
    push_stem(&mut cands, root.join("contracts/artifacts"), stem);
    // Optional sibling checkouts (relative, documented)
    push_stem(&mut cands, root.join("../cw-ave/artifacts"), stem);
    first_existing(&cands).ok_or_else(|| {
        anyhow::anyhow!(
            "missing wasm {stem}: build in-repo contracts with `just optimize`, \
             or set SEZS_CONTRACT_ARTIFACTS / SEZS_CW_AVE_ARTIFACTS / CW_AVE_ROOT \
             (see docs/BUILD.md)"
        )
    })
}

/// DAO DAO fork artifacts, including dao-calendar. Never vendored here.
pub fn dao_wasm(stem: &str) -> Result<PathBuf> {
    let root = repo_root();
    let mut cands: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = std::env::var("SEZS_DAO_ARTIFACTS") {
        push_stem(&mut cands, PathBuf::from(dir), stem);
    }
    if let Ok(dir) = std::env::var("DAO_CONTRACTS_ROOT") {
        push_stem(&mut cands, PathBuf::from(dir).join("artifacts"), stem);
    }
    push_stem(&mut cands, root.join("../dao-contracts/artifacts"), stem);
    first_existing(&cands).ok_or_else(|| {
        anyhow::anyhow!(
            "missing DAO wasm {stem}: set SEZS_DAO_ARTIFACTS or DAO_CONTRACTS_ROOT \
             to a built https://github.com/permissionlessweb/dao-contracts checkout \
             (dao-calendar stays in that repo; see docs/BUILD.md)"
        )
    })
}

/// terp-rs artifacts (terp-beacon, nftfi-raffle). Not vendored here.
pub fn terp_rs_wasm(stem: &str) -> Result<PathBuf> {
    let root = repo_root();
    let mut cands: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = std::env::var("SEZS_TERP_RS_ARTIFACTS") {
        push_stem(&mut cands, PathBuf::from(dir), stem);
    }
    if let Ok(dir) = std::env::var("TERP_RS_ROOT") {
        push_stem(&mut cands, PathBuf::from(dir).join("artifacts"), stem);
    }
    push_stem(&mut cands, root.join("../terp-rs/artifacts"), stem);
    first_existing(&cands).ok_or_else(|| {
        anyhow::anyhow!(
            "missing terp-rs wasm {stem}: set SEZS_TERP_RS_ARTIFACTS or TERP_RS_ROOT \
             to a built https://github.com/permissionlessweb/terp-rs checkout \
             (see docs/BUILD.md)"
        )
    })
}

pub fn path_is_file(p: &Path) -> bool {
    p.is_file()
}
