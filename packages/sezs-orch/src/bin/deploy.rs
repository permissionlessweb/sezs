//! cw-orch Daemon deploy entrypoint.
//!
//! Network: `NETWORK` or `SEZS_NETWORK` (`local` / `sezs-local-1` default,
//! `mainnet` / `morocco-1`, `testnet`). Remote chains are refused unless
//! `SEZS_DEPLOY_CONFIRM_MAINNET=1`.
//!
//! Event specs: set `SEZS_EVENT_SPEC` to a JSON file containing one EventSpec
//! or `{ "events": [...] }` to deploy multiple events in one pass (reusing
//! stored code_ids across events). Without `SEZS_EVENT_SPEC`, deploys the
//! default local Lantern Night record.
//!
//! Circuit upload: set `SEZS_SKIP_CIRCUIT_UPLOAD=1` to deploy without
//! uploading `sezs_consume_v2` (`zkid: null`).
//!
//! Signing (never logged):
//! - `SEZS_DEPLOY_MNEMONIC` or `LOCAL_MNEMONIC`, or
//! - `SEZS_DEPLOY_SECP256K1` (32-byte hex from a keyring export).

use anyhow::{bail, Result};
use cw_orch::prelude::*;
use serde_json::json;
use sezs_orch::{
    kms::{self, KmsNeed},
    networks::{
        assert_deploy_allowed, chain_from_env, chain_info_owned, env_nonempty, signer_env_present,
    },
    seed::{door_auth_hex, EventSpec, LanternNight},
    suite::{Member, SezsDeployData},
    wasm, SezsSuite,
};
use std::path::PathBuf;

fn members_from_addrs(addrs: &[String]) -> Vec<Member> {
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::new();
    for a in addrs {
        let clean = a.trim();
        if clean.is_empty() || !seen.insert(clean.to_string()) {
            continue;
        }
        out.push(Member {
            addr: clean.to_string(),
            weight: 1,
        });
    }
    out
}

fn main() -> Result<()> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    dotenv::dotenv().ok();
    env_logger::init();

    let (choice, network) = chain_from_env()?;
    assert_deploy_allowed(choice)?;

    if !signer_env_present() {
        eprintln!(
            "sezs-orch-deploy: no SEZS_DEPLOY_MNEMONIC, LOCAL_MNEMONIC, or SEZS_DEPLOY_SECP256K1 in the environment."
        );
        eprintln!(
            "For the local session keyring on loopback, run `make deploy-local` (it feeds a secp hex into the env without printing it)."
        );
        eprintln!("This binary will not read a mnemonic file and will not print key material.");
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
    let specs: Vec<EventSpec> = match &spec_path {
        Some(p) => EventSpec::load_many_from_path(p)?,
        None => vec![EventSpec::from(&LanternNight::default())],
    };

    if choice.is_remote() {
        for s in &specs {
            s.validate_for_remote()?;
        }
    }

    let mut builder = DaemonBuilder::new(chain_info_owned(network.clone()));
    builder.load_network(false);
    if let Some(grpc) = env_nonempty("SEZS_GRPC") {
        builder.grpc_url(grpc);
    }
    if let Some(id) = env_nonempty("SEZS_DEPLOYMENT_ID") {
        builder.deployment_id(id);
    }

    let chain = kms::build_operator_daemon(&mut builder)?;
    let chain = kms::attach(chain, choice, &KmsNeed::deploy()?)?;

    let sender = chain.sender_addr();
    let default_curator = env_nonempty("SEZS_CURATOR").unwrap_or_else(|| sender.to_string());
    let default_service = env_nonempty("SEZS_SERVICE");
    let default_usher = env_nonempty("SEZS_USHER");
    let default_coord = env_nonempty("SEZS_COORD");

    let mut deployed = Vec::new();
    let mut contracts_list = Vec::new();
    let mut last_boot = serde_json::Value::Null;
    let mut last_codes = std::collections::BTreeMap::new();

    for spec in &specs {
        let curator = spec
            .curator
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| default_curator.clone());
        let service = spec
            .service_key
            .clone()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| default_service.clone())
            .or_else(|| {
                if choice.is_remote() {
                    None
                } else {
                    Some(curator.clone())
                }
            });

        let mut coord_addrs = vec![curator.clone()];
        if let Some(c) = &default_coord {
            coord_addrs.push(c.clone());
        }
        if let Some(s) = &service {
            coord_addrs.push(s.clone());
        }
        coord_addrs.extend(spec.coordinators.iter().cloned());

        let mut usher_addrs = Vec::new();
        if let Some(u) = &default_usher {
            usher_addrs.push(u.clone());
        }
        usher_addrs.extend(spec.ushers.iter().cloned());
        usher_addrs.push(curator.clone());

        let meta_path = spec
            .metadata_path
            .as_deref()
            .map(PathBuf::from)
            .map(|p| {
                if p.is_absolute() {
                    p
                } else {
                    wasm::repo_root().join(p)
                }
            })
            .unwrap_or_else(|| {
                if spec_path.is_none() && spec.id == "lantern-night-2027" {
                    wasm::repo_root().join("apps/sezs/public/lantern-night-nip52.json")
                } else {
                    wasm::repo_root().join(format!("apps/sezs/public/{}-nip52.json", spec.id))
                }
            });

        let data = SezsDeployData {
            coordinators: members_from_addrs(&coord_addrs),
            ushers: members_from_addrs(&usher_addrs),
            curator: Some(curator),
            service_key: service,
            event: LanternNight::default(),
            spec: Some(spec.clone()),
            meta_path: Some(meta_path.clone()),
        };

        let suite = SezsSuite::deploy_on(chain.clone(), data)?;
        last_codes = suite.code_ids();
        let addrs = &suite.addresses;
        let event_addr = addrs
            .cw_event_manifold
            .clone()
            .ok_or_else(|| anyhow::anyhow!("missing event address"))?;
        contracts_list.push(event_addr.clone());

        let lcd = env_nonempty("SEZS_LCD")
            .unwrap_or_else(|| network.lcd_url.unwrap_or("http://127.0.0.1:1317").into());
        let rpc = env_nonempty("SEZS_RPC").unwrap_or_else(|| {
            network
                .rpc_urls
                .first()
                .copied()
                .unwrap_or("http://127.0.0.1:26657")
                .into()
        });
        let chain_id = env_nonempty("SEZS_CHAIN_ID").unwrap_or_else(|| network.chain_id.into());

        last_boot = json!({
            "contract": event_addr,
            "lcd": lcd,
            "chainId": chain_id,
            "rpc": rpc,
            "zkid": suite.zkid,
            "coordinators": addrs.cw420_coordinators,
            "ushers": addrs.cw420_ushers,
            "doorAuthPubkey": if spec.door_auth_pubkey.is_some() { spec.door_auth_pubkey.clone() } else if !choice.is_remote() { Some(door_auth_hex()) } else { None },
            "dao": addrs.dao_dao_core,
            "calendar": addrs.dao_calendar,
            "randomness": addrs.terp_beacon,
            "raffle": addrs.nftfi_raffle,
        });

        deployed.push(json!({
            "id": spec.id,
            "name": spec.name,
            "contract": event_addr,
            "coordinators": addrs.cw420_coordinators,
            "ushers": addrs.cw420_ushers,
            "zkid": suite.zkid,
            "metadataUri": spec.resolved_metadata_uri(),
            "metadataPath": meta_path.display().to_string(),
        }));
    }

    let session = env_nonempty("SEZS_SESSION_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp/sezs-session-walkthrough"));

    if !last_boot.is_null() {
        write_json(&session.join("terp-boot.json"), &last_boot)?;
    }
    if !choice.is_remote() && spec_path.is_none() && !last_boot.is_null() {
        write_json(
            &wasm::repo_root().join("apps/sezs/dev/localterp/boot.json"),
            &last_boot,
        )?;
    }

    let manifest_path = env_nonempty("SEZS_MANIFEST_OUT")
        .map(PathBuf::from)
        .unwrap_or_else(|| session.join("events-manifest.json"));
    let summary = json!({
        "ok": true,
        "chainId": network.chain_id,
        "codes": last_codes,
        "nextPublicSezsEvents": contracts_list.join(","),
        "events": deployed,
    });
    write_json(&manifest_path, &summary)?;

    println!("{}", serde_json::to_string_pretty(&summary)?);
    Ok(())
}

fn write_json(path: &PathBuf, value: &serde_json::Value) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(value)?)?;
    Ok(())
}
