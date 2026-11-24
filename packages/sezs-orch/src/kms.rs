//! cw-orch-kms wiring for sezs-orch deploy and curate.
//!
//! The operator (grantee) signs `MsgExec` under an authz + feegrant from
//! `CW_ORCH_GRANTER`. On remote chains this crate refuses to broadcast if
//! `plan_session_setup` is not already `Ready` — it will not open a Zigner
//! page mid-deploy. Request a covering grant first with
//! `sezs-orch-kms-approve` (ApprovalSession / `grant_to`, signed on Zigner
//! account 0).
//!
//! Loopback may also set `SEZS_KMS_LOCAL_GRANT=1` and
//! `SEZS_GRANTER_SECP256K1` / `SEZS_GRANTER_MNEMONIC` so a local granter
//! can broadcast the planned grant without a page. That path is refused
//! on any non-local chain. Signer material is never logged.

use anyhow::{bail, Result};
use cosmwasm_std::Addr;
use cw_orch::daemon::senders::tx::TxSender;
use cw_orch::daemon::senders::CosmosOptions;
use cw_orch::prelude::*;
use cw_orch_kms::{
    plan_session_setup, planned_spend_limit, query_grantee_state, ApprovalFactor, ApprovalSession,
    RunAllowlist, ScopedCall, SessionGrant, SessionSetup, SetupChain, SetupTx,
};
use std::path::PathBuf;

use crate::networks::{env_nonempty, NetworkChoice};
use crate::wasm;

/// Cold curator on morocco-1 (Zigner account 0). Not a local key name.
pub const DEFAULT_MAINNET_GRANTER: &str = "terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052";

/// Existing morocco-1 operator grant expiry, for operator-facing notes.
pub const MAINNET_OPERATOR_GRANT_EXPIRES: &str = "2026-11-28 19:46 UTC (Africa/Dakar same clock)";

pub struct KmsNeed {
    pub wasm_paths: Vec<PathBuf>,
    pub instantiate: bool,
    pub executes: Vec<ScopedCall>,
}

impl KmsNeed {
    pub fn deploy() -> Result<Self> {
        let mut wasm_paths = vec![
            wasm::sezs_wasm("cw420")?,
            wasm::sezs_wasm("cw_event_manifold")?,
        ];
        if std::env::var("SEZS_MINIMAL_STACK").ok().as_deref() != Some("1") {
            for stem in ["cw_ave", "cw_ave_factory"] {
                if let Ok(p) = wasm::sezs_wasm(stem) {
                    wasm_paths.push(p);
                }
            }
        }
        Ok(Self {
            wasm_paths,
            instantiate: true,
            executes: Vec::new(),
        })
    }

    pub fn curate(event: impl Into<String>) -> Self {
        Self {
            wasm_paths: Vec::new(),
            instantiate: false,
            executes: vec![ScopedCall {
                address: event.into(),
                keys: CURATE_MSG_KEYS.iter().map(|k| k.to_string()).collect(),
                calls: 64,
                funds: Vec::new(),
            }],
        }
    }
}

/// Execute message keys sezs-orch-curate may send. Required: an empty key
/// list is a deny in cw-orch-kms grant encoding (not AllowAll).
pub const CURATE_MSG_KEYS: &[&str] = &[
    "set_nip52",
    "set_venue",
    "set_metadata",
    "set_guest_root_vk",
    "upsert_lineup_slot",
    "upsert_tier",
    "register_raffle_prize",
    "upsert_faq",
    "upsert_sponsor",
    "set_status",
];

/// Grantee / operator daemon from already-exported env (never printed).
pub fn build_operator_daemon(builder: &mut DaemonBuilder) -> Result<Daemon> {
    build_daemon(
        builder,
        env_nonempty("SEZS_DEPLOY_SECP256K1"),
        env_nonempty("SEZS_DEPLOY_MNEMONIC").or_else(|| env_nonempty("LOCAL_MNEMONIC")),
        "SEZS_DEPLOY_SECP256K1",
    )
}

fn build_daemon(
    builder: &mut DaemonBuilder,
    secp: Option<String>,
    mnemonic: Option<String>,
    secp_label: &str,
) -> Result<Daemon> {
    if let Some(hex_secret) = secp {
        let bytes = decode_secp(&hex_secret, secp_label)?;
        let opts = CosmosOptions::default().secp256k1_secret(bytes);
        Ok(builder.build_sender(opts)?)
    } else if let Some(m) = mnemonic {
        Ok(builder.mnemonic(m).build()?)
    } else {
        Ok(builder.build()?)
    }
}

pub fn decode_secp(hex_secret: &str, label: &str) -> Result<Vec<u8>> {
    let cleaned: String = hex_secret
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();
    let bytes = hex::decode(&cleaned)?;
    if bytes.len() != 32 {
        bail!("{label} must be 32 bytes");
    }
    Ok(bytes)
}

/// Remote chains always use the KMS path (defaulting the morocco-1 granter).
/// Local uses KMS only when `CW_ORCH_GRANTER` is set.
pub fn resolve_granter(choice: NetworkChoice) -> Option<String> {
    if let Some(g) = env_nonempty("CW_ORCH_GRANTER") {
        return Some(g);
    }
    if choice.is_remote() {
        Some(DEFAULT_MAINNET_GRANTER.to_string())
    } else {
        None
    }
}

fn session_for(granter: &str, need: &KmsNeed) -> Result<ApprovalSession> {
    let mut session = ApprovalSession::open(granter);
    session.retain = true;
    session.account_index = 0;
    session.ttl_secs = 2 * 60 * 60;
    session.allowance_limit = planned_spend_limit(64).max(session.allowance_limit);
    for path in &need.wasm_paths {
        let bytes = std::fs::read(path)
            .map_err(|e| anyhow::anyhow!("kms store wasm {}: {e}", path.display()))?;
        session = session
            .allow_store(&bytes)
            .map_err(|e| anyhow::anyhow!("kms allow_store: {e}"))?;
    }
    if need.instantiate {
        session = session.allow_instantiate();
    }
    for call in &need.executes {
        session = session
            .allow_execute(call.clone())
            .map_err(|e| anyhow::anyhow!("kms allow_execute: {e}"))?;
    }
    if session.type_urls.is_empty() {
        bail!("kms session has no message types");
    }
    Ok(session)
}

fn dummy_setup(daemon: &Daemon) -> SetupChain {
    let info = &daemon.sender().chain_info;
    SetupChain {
        chain_id: info.chain_id.clone(),
        account_number: 0,
        sequence: 0,
        gas: 600_000,
        fee_denom: info.gas_denom.clone(),
        fee_amount: 1,
    }
}

fn session_grant(session: &ApprovalSession, grantee: &str) -> SessionGrant {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut allow = RunAllowlist::default();
    for url in &session.type_urls {
        allow = allow.allow_type(url.clone());
    }
    for sum in &session.stores {
        allow = allow.allow_store_checksum(sum.clone());
    }
    for call in &session.executes {
        allow = allow.allow_execute_unchecked(call.clone());
    }
    SessionGrant {
        grantee: grantee.to_string(),
        expiration_unix: now.saturating_add(session.ttl_secs),
        session_id: format!("wallet-{grantee}"),
        allowlist: allow,
        factor: ApprovalFactor::Zafu,
        nonce: [0u8; 32],
    }
}

fn plan_for(
    daemon: &Daemon,
    session: &ApprovalSession,
    grant: &SessionGrant,
) -> Result<SessionSetup> {
    let on_chain = query_grantee_state(daemon, &session.granter, &grant.grantee)
        .map_err(|e| anyhow::anyhow!("kms grant query: {e}"))?;
    let fee_denom = daemon.sender().chain_info.gas_denom.clone();
    plan_session_setup(
        &session.granter,
        grant,
        &on_chain,
        &fee_denom,
        session.allowance_limit,
        &dummy_setup(daemon),
    )
    .map_err(|e| anyhow::anyhow!("kms plan_session_setup: {e}"))
}

fn arm(daemon: &mut Daemon, granter: &str) {
    let granter = Addr::unchecked(granter);
    daemon.sender_mut().set_authz_granter(&granter);
    daemon.sender_mut().set_fee_granter(&granter);
}

fn refuse_remote(granter: &str, operator: &str) -> String {
    format!(
        "no covering cw-orch-kms grant from {granter} to operator {operator}. \
         Refusing remote broadcast (will not open a Zigner page). \
         The morocco-1 operator grant expires {expires}. \
         Request a covering authz+feegrant with `sezs-orch-kms-approve` and sign the \
         ApprovalSession / grant_to QR on Zigner account 0, then rerun with the operator \
         signer (SEZS_DEPLOY_MNEMONIC or SEZS_DEPLOY_SECP256K1 of the grantee, never the cold key).",
        expires = MAINNET_OPERATOR_GRANT_EXPIRES
    )
}

fn sdk_anys(tx: &SetupTx) -> Result<Vec<cosmrs::Any>> {
    let text = std::str::from_utf8(&tx.amino)
        .map_err(|_| anyhow::anyhow!("kms grant amino is not utf-8"))?;
    let types = amino_msg_types(text);
    if types.len() != tx.proto.len() {
        bail!(
            "kms grant refused: {} amino messages and {} proto messages",
            types.len(),
            tx.proto.len()
        );
    }
    let mut anys = Vec::with_capacity(tx.proto.len());
    for (sdk_type, bytes) in types.iter().zip(tx.proto.iter()) {
        let type_url = match sdk_type.as_str() {
            "cosmos-sdk/MsgRevoke" => "/cosmos.authz.v1beta1.MsgRevoke",
            "cosmos-sdk/MsgGrant" => "/cosmos.authz.v1beta1.MsgGrant",
            "cosmos-sdk/MsgRevokeAllowance" => "/cosmos.feegrant.v1beta1.MsgRevokeAllowance",
            "cosmos-sdk/MsgGrantAllowance" => "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
            other => bail!("kms grant refused: unexpected amino type {other}"),
        };
        anys.push(cosmrs::Any {
            type_url: type_url.to_string(),
            value: bytes.clone(),
        });
    }
    Ok(anys)
}

fn amino_msg_types(amino: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = amino;
    while let Some(index) = rest.find("\"type\":\"cosmos-sdk/") {
        let start = index + "\"type\":\"".len();
        let tail = &rest[start..];
        let Some(end) = tail.find('"') else {
            break;
        };
        let name = &tail[..end];
        if matches!(
            name,
            "cosmos-sdk/MsgRevoke"
                | "cosmos-sdk/MsgGrant"
                | "cosmos-sdk/MsgRevokeAllowance"
                | "cosmos-sdk/MsgGrantAllowance"
        ) {
            out.push(name.to_string());
        }
        rest = &tail[end..];
    }
    out
}

fn local_fill(operator: &Daemon, session: &ApprovalSession, grant: &SessionGrant) -> Result<()> {
    if env_nonempty("SEZS_GRANTER_SECP256K1").is_none()
        && env_nonempty("SEZS_GRANTER_MNEMONIC").is_none()
    {
        bail!(
            "SEZS_KMS_LOCAL_GRANT=1 requires SEZS_GRANTER_SECP256K1 or SEZS_GRANTER_MNEMONIC \
             (loopback only; never printed)"
        );
    }
    let (_, network) = crate::networks::chain_from_env()?;
    let mut builder = DaemonBuilder::new(crate::networks::chain_info_owned(network));
    builder.load_network(false);
    if let Some(grpc) = env_nonempty("SEZS_GRPC") {
        builder.grpc_url(grpc);
    }
    // The operator daemon already holds STATE_FILE. Give the granter its own
    // throwaway path so the two builders do not contend for the same lock.
    let prev_state = std::env::var("STATE_FILE").ok();
    let granter_state = std::env::temp_dir().join(format!(
        "sezs-kms-granter-state-{}.json",
        std::process::id()
    ));
    std::env::set_var("STATE_FILE", &granter_state);
    let granter_daemon = build_daemon(
        &mut builder,
        env_nonempty("SEZS_GRANTER_SECP256K1"),
        env_nonempty("SEZS_GRANTER_MNEMONIC"),
        "SEZS_GRANTER_SECP256K1",
    );
    match prev_state {
        Some(path) => std::env::set_var("STATE_FILE", path),
        None => std::env::remove_var("STATE_FILE"),
    }
    let _ = std::fs::remove_file(&granter_state);
    let granter_daemon = granter_daemon?;
    let granter_addr = granter_daemon.sender_addr().to_string();
    if granter_addr != session.granter {
        bail!(
            "SEZS_GRANTER signer address does not match CW_ORCH_GRANTER (addresses only; secrets not printed)"
        );
    }
    let setup = plan_for(operator, session, grant)?;
    let SessionSetup::Sign(tx) = setup else {
        return Ok(());
    };
    let anys = sdk_anys(&tx)?;
    let handle = granter_daemon.rt_handle.clone();
    let response = handle.block_on(async {
        granter_daemon
            .sender()
            .commit_tx_any(anys, Some("sezs-kms-local-grant".into()))
            .await
    })?;
    if response.code != 0 {
        bail!(
            "local kms grant broadcast refused: code {} {}",
            response.code,
            response.raw_log
        );
    }
    eprintln!(
        "sezs-orch: local cw-orch-kms grant committed tx={}",
        response.txhash
    );
    Ok(())
}

/// Arm the operator daemon for MsgExec, or leave it unchanged on local
/// when `CW_ORCH_GRANTER` is unset. Never opens a Zigner page.
pub fn attach(mut daemon: Daemon, choice: NetworkChoice, need: &KmsNeed) -> Result<Daemon> {
    let Some(granter) = resolve_granter(choice) else {
        return Ok(daemon);
    };
    let operator = daemon.sender_addr().to_string();
    if operator == granter {
        bail!(
            "CW_ORCH_GRANTER and the operator signer are the same address; the operator must be a distinct grantee"
        );
    }
    let session = session_for(&granter, need)?;
    let grant = session_grant(&session, &operator);
    match plan_for(&daemon, &session, &grant)? {
        SessionSetup::Ready => {
            arm(&mut daemon, &granter);
            eprintln!(
                "sezs-orch: cw-orch-kms session ready; operator {operator} will MsgExec as {granter}"
            );
            return Ok(daemon);
        }
        SessionSetup::Sign(_) => {}
    }
    if choice.is_remote() {
        bail!("{}", refuse_remote(&granter, &operator));
    }
    if env_nonempty("SEZS_KMS_LOCAL_GRANT").as_deref() != Some("1") {
        bail!(
            "local cw-orch-kms grant from {granter} to operator {operator} is not Ready. \
             Set SEZS_KMS_LOCAL_GRANT=1 with SEZS_GRANTER_SECP256K1 or SEZS_GRANTER_MNEMONIC \
             (loopback only), or create a covering authz+feegrant first."
        );
    }
    local_fill(&daemon, &session, &grant)?;
    let mut ready = matches!(plan_for(&daemon, &session, &grant)?, SessionSetup::Ready);
    for _ in 0..8 {
        if ready {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
        ready = matches!(plan_for(&daemon, &session, &grant)?, SessionSetup::Ready);
    }
    if !ready {
        bail!("local kms grant was broadcast but plan_session_setup is still not Ready");
    }
    arm(&mut daemon, &granter);
    eprintln!(
        "sezs-orch: cw-orch-kms session ready after local grant; operator {operator} will MsgExec as {granter}"
    );
    Ok(daemon)
}

/// Open a Zigner ApprovalSession / grant_to page so the cold key can write
/// a covering grant. Remote chains require `SEZS_DEPLOY_CONFIRM_MAINNET=1`.
/// Loopback with `SEZS_KMS_LOCAL_GRANT=1` fills the grant without a page.
pub fn request_grant(builder: &DaemonBuilder, choice: NetworkChoice, need: &KmsNeed) -> Result<()> {
    let granter = resolve_granter(choice).ok_or_else(|| {
        anyhow::anyhow!(
            "set CW_ORCH_GRANTER to the local granter address before requesting a grant"
        )
    })?;
    let session = session_for(&granter, need)?;
    if !choice.is_remote() && env_nonempty("SEZS_KMS_LOCAL_GRANT").as_deref() == Some("1") {
        let mut operator_builder = builder.clone();
        let daemon = build_operator_daemon(&mut operator_builder)?;
        let operator = daemon.sender_addr().to_string();
        let grant = session_grant(&session, &operator);
        if matches!(plan_for(&daemon, &session, &grant)?, SessionSetup::Ready) {
            eprintln!("sezs-orch-kms-approve: covering grant already Ready for {operator}");
            return Ok(());
        }
        local_fill(&daemon, &session, &grant)?;
        return Ok(());
    }
    if choice.is_remote() && env_nonempty("SEZS_DEPLOY_CONFIRM_MAINNET").as_deref() != Some("1") {
        bail!(
            "refusing to open a Zigner grant page on a remote chain without SEZS_DEPLOY_CONFIRM_MAINNET=1"
        );
    }
    if let Some(grantee) = env_nonempty("SEZS_KMS_GRANTEE") {
        eprintln!(
            "sezs-orch-kms-approve: opening grant_to page for granter {granter} → {grantee} (Zigner account {})",
            session.account_index
        );
        cw_orch_kms::grant_to(builder, session, &grantee, Vec::new())
            .map_err(|e| anyhow::anyhow!("grant_to refused: {e}"))?;
        eprintln!("sezs-orch-kms-approve: grant_to finished");
        return Ok(());
    }
    eprintln!(
        "sezs-orch-kms-approve: opening ApprovalSession page for granter {granter} (Zigner account {})",
        session.account_index
    );
    let _daemon = cw_orch_kms::enable_approval(builder, session)
        .map_err(|e| anyhow::anyhow!("enable_approval refused: {e}"))?;
    eprintln!("sezs-orch-kms-approve: ApprovalSession finished and operator daemon is armed");
    Ok(())
}

/// Execute a contract message as the authz granter when `CW_ORCH_GRANTER` is
/// set. cw-orch-daemon's default `Daemon::execute` names the signing account
/// as the wasm sender; curator-gated SEZS messages need the granter inside
/// the MsgExec-wrapped `MsgExecuteContract`.
pub fn execute_json(daemon: &Daemon, contract: &str, msg: &serde_json::Value) -> Result<String> {
    use cosmrs::cosmwasm::MsgExecuteContract;
    use cosmrs::AccountId;
    use cw_orch::daemon::senders::tx::TxSender;
    use std::str::FromStr;

    let sender = resolve_granter_from_env().unwrap_or_else(|| daemon.sender_addr().to_string());
    let exec = MsgExecuteContract {
        sender: AccountId::from_str(&sender).map_err(|e| anyhow::anyhow!("sender: {e}"))?,
        contract: AccountId::from_str(contract).map_err(|e| anyhow::anyhow!("contract: {e}"))?,
        msg: serde_json::to_vec(msg)?,
        funds: vec![],
    };
    let handle = daemon.rt_handle.clone();
    let response = handle.block_on(async { daemon.sender().commit_tx(vec![exec], None).await })?;
    if response.code != 0 {
        bail!(
            "execute {} refused: code {} {}",
            contract,
            response.code,
            response.raw_log
        );
    }
    Ok(response.txhash)
}

fn resolve_granter_from_env() -> Option<String> {
    env_nonempty("CW_ORCH_GRANTER")
}
