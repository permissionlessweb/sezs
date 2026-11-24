//! Apply coordinator and usher terp1 addresses to an already-deployed
//! local event (cw420 `update_members`). Does not instantiate contracts.
//!
//! Required: `SEZS_COORDINATOR`, `SEZS_USHER`.
//! Signing: `SEZS_DEPLOY_SECP256K1` / mnemonic, same as `sezs-orch-deploy`.
//! Loopback only unless `SEZS_DEPLOY_CONFIRM_MAINNET=1`.

use anyhow::{bail, Result};
use cosmwasm_std::Addr;
use cw_orch::prelude::*;
use sezs_orch::{
    networks::{assert_deploy_allowed, chain_from_env, env_nonempty, signer_env_present},
    interfaces::contracts::JsonMsg,
    SezsSuite,
};
use serde_json::json;
use std::path::PathBuf;

fn main() -> Result<()> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    dotenv::dotenv().ok();
    env_logger::init();

    let (choice, network) = chain_from_env()?;
    assert_deploy_allowed(choice)?;

    let coordinator = required_terp("SEZS_COORDINATOR")?;
    let usher = required_terp("SEZS_USHER")?;

    if !signer_env_present() {
        eprintln!(
            "sezs-orch-roles: no SEZS_DEPLOY_MNEMONIC, LOCAL_MNEMONIC, or SEZS_DEPLOY_SECP256K1 in the environment."
        );
        eprintln!("Run `make event-roles` with the session keyring on loopback.");
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

    let mut builder = DaemonBuilder::new(network);
    builder.load_network(false);
    if let Some(grpc) = env_nonempty("SEZS_GRPC") {
        builder.grpc_url(grpc);
    }
    if let Some(id) = env_nonempty("SEZS_DEPLOYMENT_ID") {
        builder.deployment_id(id);
    }

    let chain = if let Some(hex_secret) = env_nonempty("SEZS_DEPLOY_SECP256K1") {
        let bytes = decode_secp(&hex_secret)?;
        let opts = cw_orch::daemon::senders::CosmosOptions::default().secp256k1_secret(bytes);
        builder.build_sender(opts)?
    } else if let Some(m) = env_nonempty("SEZS_DEPLOY_MNEMONIC").or_else(|| env_nonempty("LOCAL_MNEMONIC"))
    {
        builder.mnemonic(m).build()?
    } else {
        builder.build()?
    };

    let mut suite = SezsSuite::load_from(chain)?;
    apply_boot_addresses(&mut suite)?;

    let coord_group = suite
        .coordinators
        .addr_str()
        .map_err(|_| anyhow::anyhow!("coordinators group address is unknown; set STATE_FILE or terp-boot.json"))?;
    let usher_group = suite
        .ushers
        .addr_str()
        .map_err(|_| anyhow::anyhow!("ushers group address is unknown; set STATE_FILE or terp-boot.json"))?;

    // Bootstrap (curator is the current group admin): add the coordinator
    // to the coordinators group, add the usher to the ushers group, then
    // transfer the ushers group admin to the coordinator address so later
    // add/remove is signed by that coordinator in Zafu, not the backend.
    // cw420 admin is a single Addr; hooks do not grant execute rights, and
    // the coordinators group contract cannot proxy member txs, so the
    // coordinator wallet is the cleanest admin cw420 supports.
    eprintln!("sezs-orch-roles: add coordinator {coordinator} to {coord_group}");
    let r1 = suite.coordinators.execute(
        &JsonMsg(json!({
            "update_members": {
                "add": [{ "addr": coordinator, "weight": 1 }],
                "remove": []
            }
        })),
        &[],
    )?;
    eprintln!("sezs-orch-roles: coordinators update_members txhash {}", r1.txhash);

    eprintln!("sezs-orch-roles: add usher {usher} to {usher_group}");
    let r2 = suite.ushers.execute(
        &JsonMsg(json!({
            "update_members": {
                "add": [{ "addr": usher, "weight": 1 }],
                "remove": []
            }
        })),
        &[],
    )?;
    eprintln!("sezs-orch-roles: ushers update_members txhash {}", r2.txhash);

    eprintln!("sezs-orch-roles: set ushers group admin to {coordinator}");
    let r3 = suite.ushers.execute(
        &JsonMsg(json!({
            "update_admin": { "admin": coordinator }
        })),
        &[],
    )?;
    eprintln!("sezs-orch-roles: ushers update_admin txhash {}", r3.txhash);

    eprintln!("sezs-orch-roles: roles updated");
    Ok(())
}

fn required_terp(var: &str) -> Result<String> {
    let v = env_nonempty(var).ok_or_else(|| anyhow::anyhow!("{var} is required (a terp1 address)"))?;
    if !v.starts_with("terp1") || v.len() < 39 {
        bail!("{var} must be a terp1 address");
    }
    Ok(v)
}

fn decode_secp(hex_secret: &str) -> Result<Vec<u8>> {
    let cleaned: String = hex_secret
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();
    let bytes = hex::decode(&cleaned)?;
    if bytes.len() != 32 {
        bail!("SEZS_DEPLOY_SECP256K1 must be 32 bytes");
    }
    Ok(bytes)
}

fn apply_boot_addresses<Chain: cw_orch::environment::CwEnv>(
    suite: &mut SezsSuite<Chain>,
) -> Result<()> {
    if suite.coordinators.addr_str().is_ok() && suite.ushers.addr_str().is_ok() {
        return Ok(());
    }
    let boot = read_boot();
    if let Some(addr) = env_nonempty("SEZS_COORD_GROUP").or_else(|| boot_str(&boot, "coordinators")) {
        suite.coordinators.set_address(&Addr::unchecked(addr));
    }
    if let Some(addr) = env_nonempty("SEZS_USHER_GROUP").or_else(|| boot_str(&boot, "ushers")) {
        suite.ushers.set_address(&Addr::unchecked(addr));
    }
    if let Some(addr) = env_nonempty("SEZS_EVENT_CONTRACT").or_else(|| boot_str(&boot, "contract")) {
        suite.event.set_address(&Addr::unchecked(addr));
    }
    Ok(())
}

fn boot_str(boot: &serde_json::Value, key: &str) -> Option<String> {
    boot.get(key)?.as_str().map(|s| s.to_string()).filter(|s| s.starts_with("terp1"))
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
