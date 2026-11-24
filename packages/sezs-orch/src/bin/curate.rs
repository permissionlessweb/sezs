//! Update metadata and curation data on an already-deployed event.
//! Supports `SEZS_EVENT_SPEC` (JSON spec + optional `SEZS_EVENT_ID`) or the
//! default local Lantern Night record.
//!
//! Modes:
//! - default (`SEZS_CURATE_MODE=metadata`): writes NIP-52 JSON and executes
//!   `SetMetadata` + `UpsertSponsor` without touching lineup/tiers/raffles.
//! - `SEZS_CURATE_MODE=full`: executes all `curate_msgs` from the EventSpec.
//!
//! Signing: `SEZS_DEPLOY_SECP256K1` / mnemonic of the operator (grantee),
//! same as `sezs-orch-deploy`. Remote curate requires a covering
//! cw-orch-kms grant from `CW_ORCH_GRANTER` or the bin refuses.
//! Loopback only unless `SEZS_DEPLOY_CONFIRM_MAINNET=1`.

use anyhow::{bail, Result};
use cosmwasm_std::Addr;
use cw_orch::prelude::*;
use serde_json::json;
use sezs_orch::{
    interfaces::contracts::JsonMsg,
    kms::{self, KmsNeed},
    networks::{
        assert_deploy_allowed, chain_from_env, chain_info_owned, env_nonempty, signer_env_present,
    },
    seed::EventSpec,
    wasm, LanternNight, SezsSuite,
};
use std::path::PathBuf;

fn main() -> Result<()> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    dotenv::dotenv().ok();
    env_logger::init();

    let (choice, network) = chain_from_env()?;
    assert_deploy_allowed(choice)?;

    if !signer_env_present() {
        eprintln!(
            "sezs-orch-curate: no SEZS_DEPLOY_MNEMONIC, LOCAL_MNEMONIC, or SEZS_DEPLOY_SECP256K1 in the environment."
        );
        eprintln!("Run `make event-curate` with the session keyring on loopback.");
        std::process::exit(2);
    }

    if !matches!(network.kind, cw_orch::daemon::networks::ChainKind::Local) {
        let grpc = network.grpc_urls.first().copied().unwrap_or("");
        if !grpc.contains("127.0.0.1") && !grpc.contains("localhost") {
            if std::env::var("SEZS_DEPLOY_CONFIRM_MAINNET").ok().as_deref() != Some("1") {
                bail!("refusing non-loopback grpc {}", network.chain_id);
            }
        }
    }

    let spec_path = env_nonempty("SEZS_EVENT_SPEC").map(PathBuf::from);
    let ev: EventSpec = match &spec_path {
        Some(p) => {
            let specs = EventSpec::load_many_from_path(p)?;
            if let Some(target_id) = env_nonempty("SEZS_EVENT_ID") {
                specs
                    .into_iter()
                    .find(|s| s.id == target_id)
                    .ok_or_else(|| {
                        anyhow::anyhow!("event id {target_id} not found in {}", p.display())
                    })?
            } else {
                specs.into_iter().next().unwrap()
            }
        }
        None => EventSpec::from(&LanternNight::default()),
    };

    if choice.is_remote() {
        ev.validate_for_remote()?;
    }

    let mut builder = DaemonBuilder::new(chain_info_owned(network));
    builder.load_network(false);
    if let Some(grpc) = env_nonempty("SEZS_GRPC") {
        builder.grpc_url(grpc);
    }
    if let Some(id) = env_nonempty("SEZS_DEPLOYMENT_ID") {
        builder.deployment_id(id);
    }

    let chain = kms::build_operator_daemon(&mut builder)?;

    let mut suite = SezsSuite::load_from(chain)?;
    apply_event_address(&mut suite)?;

    let event_addr = suite
        .event
        .addr_str()
        .map_err(|_| anyhow::anyhow!("event contract address is unknown; set STATE_FILE, SEZS_EVENT_CONTRACT, or terp-boot.json"))?;

    let chain = kms::attach(
        suite.event.environment().clone(),
        choice,
        &KmsNeed::curate(&event_addr),
    )?;
    suite = SezsSuite::load_from(chain.clone())?;
    apply_event_address(&mut suite)?;
    let event_addr = suite
        .event
        .addr_str()
        .map_err(|_| anyhow::anyhow!("event contract address is unknown after kms attach"))?;

    let meta_path = env_nonempty("SEZS_METADATA_PATH")
        .map(PathBuf::from)
        .or_else(|| {
            ev.metadata_path.as_deref().map(PathBuf::from).map(|p| {
                if p.is_absolute() {
                    p
                } else {
                    wasm::repo_root().join(p)
                }
            })
        })
        .unwrap_or_else(|| {
            if spec_path.is_none() && ev.id == "lantern-night-2027" {
                wasm::repo_root().join("apps/sezs/public/lantern-night-nip52.json")
            } else {
                wasm::repo_root().join(format!("apps/sezs/public/{}-nip52.json", ev.id))
            }
        });

    let (meta_uri, meta_hash) = ev.write_metadata_file(&meta_path)?;
    eprintln!(
        "sezs-orch-curate: wrote {} uri={} sha256={}",
        meta_path.display(),
        meta_uri,
        meta_hash
    );

    let full_mode = env_nonempty("SEZS_CURATE_MODE").as_deref() == Some("full");
    let msgs = if full_mode {
        ev.curate_msgs(Some(meta_uri), Some(meta_hash))
    } else {
        ev.metadata_update_msgs(meta_uri, meta_hash)
    };

    for msg in msgs {
        let name = msg
            .as_object()
            .and_then(|o| o.keys().next().cloned())
            .unwrap_or_else(|| "msg".into());
        eprintln!("sezs-orch-curate: {name} on {event_addr}");
        let txhash = kms::execute_json(&chain, &event_addr, &msg)?;
        eprintln!("sezs-orch-curate: {name} txhash {txhash}");
    }

    let view: Option<serde_json::Value> = suite
        .event
        .query(&JsonMsg(json!({ "event_view": {} })))
        .ok();
    if let Some(v) = view {
        let count = v
            .get("sponsors")
            .and_then(|s| s.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        eprintln!("sezs-orch-curate: event now lists {count} sponsors");
    }
    eprintln!("sezs-orch-curate: curation complete");
    Ok(())
}

fn apply_event_address<Chain: cw_orch::environment::CwEnv>(
    suite: &mut SezsSuite<Chain>,
) -> Result<()> {
    if let Some(addr) = env_nonempty("SEZS_EVENT_CONTRACT") {
        suite.event.set_address(&Addr::unchecked(addr));
        return Ok(());
    }
    if suite.event.addr_str().is_ok() {
        return Ok(());
    }
    let boot = read_boot();
    if let Some(addr) = boot_str(&boot, "contract") {
        suite.event.set_address(&Addr::unchecked(addr));
    }
    Ok(())
}

fn boot_str(boot: &serde_json::Value, key: &str) -> Option<String> {
    boot.get(key)?
        .as_str()
        .map(|s| s.to_string())
        .filter(|s| s.starts_with("terp1"))
}

fn read_boot() -> serde_json::Value {
    let path = env_nonempty("SEZS_BOOT_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(
                std::env::var("SEZS_SESSION_ROOT")
                    .unwrap_or_else(|_| "/tmp/sezs-session-walkthrough".into()),
            )
            .join("terp-boot.json")
        });
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}))
}
