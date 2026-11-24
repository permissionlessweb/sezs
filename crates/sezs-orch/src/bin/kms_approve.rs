//! Request a covering cw-orch-kms grant for sezs-orch deploy or curate.
//!
//! Loopback: `SEZS_KMS_LOCAL_GRANT=1` plus a local granter signer writes the
//! planned authz+feegrant without opening a page.
//! Remote: requires `SEZS_DEPLOY_CONFIRM_MAINNET=1`. Opens an
//! ApprovalSession (or `grant_to` when `SEZS_KMS_GRANTEE` is set) so Zigner
//! account 0 can sign. This binary is the only sezs-orch entry that will
//! open that page; `sezs-orch-deploy` and `sezs-orch-curate` refuse if the
//! grant is not already Ready.
//!
//! Never prints key material.

use anyhow::{bail, Result};
use cw_orch::prelude::*;
use sezs_orch::{
    kms::{self, KmsNeed},
    networks::{
        assert_deploy_allowed, chain_from_env, chain_info_owned, env_nonempty, signer_env_present,
    },
};

fn main() -> Result<()> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    dotenv::dotenv().ok();
    env_logger::init();

    let (choice, network) = chain_from_env()?;
    assert_deploy_allowed(choice)?;

    if !signer_env_present() {
        eprintln!(
            "sezs-orch-kms-approve: no SEZS_DEPLOY_MNEMONIC, LOCAL_MNEMONIC, or SEZS_DEPLOY_SECP256K1 in the environment."
        );
        eprintln!("The operator (grantee) daemon broadcasts the cold-signed grant; never put the cold key here.");
        std::process::exit(2);
    }

    let mut builder = DaemonBuilder::new(chain_info_owned(network));
    builder.load_network(false);
    if let Some(grpc) = env_nonempty("SEZS_GRPC") {
        builder.grpc_url(grpc);
    }
    if let Some(id) = env_nonempty("SEZS_DEPLOYMENT_ID") {
        builder.deployment_id(id);
    }

    let scope = env_nonempty("SEZS_KMS_SCOPE").unwrap_or_else(|| "deploy".into());
    let need = match scope.as_str() {
        "deploy" => KmsNeed::deploy()?,
        "curate" => {
            let event = env_nonempty("SEZS_EVENT_CONTRACT").ok_or_else(|| {
                anyhow::anyhow!("SEZS_KMS_SCOPE=curate requires SEZS_EVENT_CONTRACT")
            })?;
            KmsNeed::curate(event)
        }
        other => bail!("unknown SEZS_KMS_SCOPE={other}; expected deploy|curate"),
    };
    kms::request_grant(&builder, choice, &need)
}
