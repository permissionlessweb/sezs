//! Network selection from env. Mainnet is config-only unless explicitly confirmed.

use anyhow::{bail, Result};
use cw_orch::daemon::networks::{ChainInfo, ChainKind, NetworkInfo};
use cw_orch::environment::ChainInfoOwned;

/// Bech32 / coin type shared by Terp local, test, and mainnet.
pub const TERP_NETWORK: NetworkInfo = NetworkInfo {
    chain_name: "terp",
    pub_address_prefix: "terp",
    coin_type: 118,
};

/// Local walkthrough / lab chain. Loopback only.
pub const SEZS_LOCAL_1: ChainInfo = ChainInfo {
    kind: ChainKind::Local,
    chain_id: "sezs-local-1",
    gas_denom: "uterp",
    gas_price: 0.025,
    grpc_urls: &["http://127.0.0.1:9090"],
    rpc_urls: &["http://127.0.0.1:26657"],
    network_info: TERP_NETWORK,
    lcd_url: Some("http://127.0.0.1:1317"),
    fcd_url: None,
};

/// Public mainnet. Variables only unless SEZS_DEPLOY_CONFIRM_MAINNET=1.
pub const MOROCCO_1: ChainInfo = ChainInfo {
    kind: ChainKind::Mainnet,
    chain_id: "morocco-1",
    gas_denom: "uthiol",
    gas_price: 0.05,
    grpc_urls: &["https://grpc.terp.network:443"],
    rpc_urls: &["https://rpc.terp.network"],
    network_info: TERP_NETWORK,
    lcd_url: Some("https://api.terp.network"),
    fcd_url: None,
};

/// Optional public testnet placeholder (vars only; this crate never broadcasts to it from tests).
pub const TERP_TESTNET: ChainInfo = ChainInfo {
    kind: ChainKind::Testnet,
    chain_id: "90u-4",
    gas_denom: "uthiolx",
    gas_price: 0.025,
    grpc_urls: &["http://127.0.0.1:9090"],
    rpc_urls: &["http://127.0.0.1:26657"],
    network_info: TERP_NETWORK,
    lcd_url: Some("http://127.0.0.1:1317"),
    fcd_url: None,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NetworkChoice {
    Local,
    Testnet,
    Mainnet,
}

impl NetworkChoice {
    pub fn parse(raw: &str) -> Result<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "" | "local" | "sezs-local-1" | "sezs_local_1" => Ok(Self::Local),
            "testnet" | "90u-4" | "90u4" => Ok(Self::Testnet),
            "mainnet" | "morocco-1" | "morocco_1" => Ok(Self::Mainnet),
            other => bail!("unknown NETWORK={other}; expected local|sezs-local-1|testnet|mainnet|morocco-1"),
        }
    }

    pub fn info(self) -> ChainInfo {
        match self {
            Self::Local => SEZS_LOCAL_1,
            Self::Testnet => TERP_TESTNET,
            Self::Mainnet => MOROCCO_1,
        }
    }

    pub fn is_remote(self) -> bool {
        !matches!(self, Self::Local)
    }
}

fn env(k: &str) -> Option<String> {
    std::env::var(k)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}


pub fn chain_info_owned(info: ChainInfo) -> ChainInfoOwned {
    let mut owned: ChainInfoOwned = info.into();
    if let Some(grpc) = env_nonempty("SEZS_GRPC") {
        owned.grpc_urls = vec![grpc];
    }
    if let Some(rpc) = env_nonempty("SEZS_RPC") {
        owned.rpc_urls = vec![rpc];
    }
    if let Some(lcd) = env_nonempty("SEZS_LCD") {
        owned.lcd_url = Some(lcd);
    }
    owned
}

pub fn chain_from_env() -> Result<(NetworkChoice, ChainInfo)> {
    let raw = env("NETWORK")
        .or_else(|| env("SEZS_NETWORK"))
        .unwrap_or_else(|| "local".into());
    let choice = NetworkChoice::parse(&raw)?;
    Ok((choice, choice.info()))
}

/// Refuse mainnet / testnet broadcast unless the explicit confirm var is set.
/// Local is always allowed. Never prints secrets.
pub fn assert_deploy_allowed(choice: NetworkChoice) -> Result<()> {
    if !choice.is_remote() {
        return Ok(());
    }
    let confirm = env("SEZS_DEPLOY_CONFIRM_MAINNET").unwrap_or_default();
    if confirm == "1" {
        eprintln!(
            "sezs-orch: {} deploy allowed because SEZS_DEPLOY_CONFIRM_MAINNET=1",
            choice.info().chain_id
        );
        return Ok(());
    }
    bail!(
        "refusing to deploy to {} (not loopback). Set SEZS_DEPLOY_CONFIRM_MAINNET=1 to override. Mainnet config is variables only.",
        choice.info().chain_id
    );
}

/// True when the Daemon can sign without reading a key file from this crate.
/// Values are never logged.
pub fn signer_env_present() -> bool {
    env("SEZS_DEPLOY_MNEMONIC").is_some()
        || env("LOCAL_MNEMONIC").is_some()
        || env("SEZS_DEPLOY_SECP256K1").is_some()
}

pub fn env_nonempty(k: &str) -> Option<String> {
    env(k)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_local_aliases() {
        assert_eq!(
            NetworkChoice::parse("sezs-local-1").unwrap(),
            NetworkChoice::Local
        );
        assert_eq!(
            NetworkChoice::parse("morocco-1").unwrap(),
            NetworkChoice::Mainnet
        );
    }

    #[test]
    fn local_is_always_allowed() {
        assert_deploy_allowed(NetworkChoice::Local).unwrap();
    }
}
