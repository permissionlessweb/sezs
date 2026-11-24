//! Ticket proof verifier for ConsumeTicket.
//!
//! Production calls `sezs_ticket_v2_verify::verify_consume` with [`TerpHost`]
//! (zk-wasmvm `proof_instance_verify` + `redpallas_spendauth_verify`).
//! Unit tests inject a host that accepts the well-known proof `b"stub-ok"`
//! after the same consent and public-input checks, so role and state
//! transitions can be tested without the circuit.

use cosmwasm_std::{Binary, Env, HexBinary, MessageInfo};
use sezs_ticket_v2_verify::{self as v2, TerpHost, ZkHost};

use crate::error::ContractError;
use crate::msg::Consent;
use crate::state::Config;

/// Public inputs of the consume circuit, in circuit order:
/// `[root, N, event_id, domain, rk_x, rk_y]`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConsumePublicInputs {
    pub root: HexBinary,
    pub nullifier: HexBinary,
    pub event_id: HexBinary,
    pub domain: HexBinary,
    pub rk_x: HexBinary,
    pub rk_y: HexBinary,
}

pub const STUB_OK: &[u8] = b"stub-ok";

fn arr32(label: &'static str, value: &HexBinary) -> Result<[u8; 32], ContractError> {
    value
        .as_slice()
        .try_into()
        .map_err(|_| ContractError::BadLength)
        .map_err(|e| {
            let _ = label;
            e
        })
}

fn map_verify(err: v2::VerifyError) -> ContractError {
    match err {
        v2::VerifyError::NotConfigured => ContractError::ZkidUnset,
        v2::VerifyError::NonCanonical(_) => ContractError::BadPublicInput,
        other => ContractError::TicketRejected(other.to_string()),
    }
}

/// Verify a consume proof and consent against this event's door config.
///
/// * `zkid == 0` is fail-closed (`ZkidUnset`).
/// * `event_id` / `domain` in the message must equal the configured field
///   elements (they are not trusted as a substitute for config).
/// * Printed consent does not carry a message; it is recomputed on-chain.
pub fn verify_ticket_proof(
    env: &Env,
    info: &MessageInfo,
    cfg: &Config,
    proof: &Binary,
    i: &ConsumePublicInputs,
    consent: &Consent,
) -> Result<v2::Verified, ContractError> {
    #[cfg(not(test))]
    {
        verify_ticket_proof_with(&TerpHost, env, info, cfg, proof, i, consent)
    }
    #[cfg(test)]
    {
        let _ = TerpHost;
        verify_ticket_proof_with(&TestHost, env, info, cfg, proof, i, consent)
    }
}

pub fn verify_ticket_proof_with<H: ZkHost>(
    host: &H,
    env: &Env,
    info: &MessageInfo,
    cfg: &Config,
    proof: &Binary,
    i: &ConsumePublicInputs,
    consent: &Consent,
) -> Result<v2::Verified, ContractError> {
    if cfg.zkid == 0 {
        return Err(ContractError::ZkidUnset);
    }
    let event_id = arr32("event_id", &i.event_id)?;
    let domain = arr32("domain", &i.domain)?;
    let cfg_event = arr32("cfg.event_id", &cfg.event_id_fp)?;
    let cfg_domain = arr32("cfg.domain", &cfg.domain_fp)?;
    if event_id != cfg_event || domain != cfg_domain {
        return Err(ContractError::WrongEvent);
    }
    let door = v2::DoorConfig {
        zkid: cfg.zkid,
        event_id_fp: cfg_event,
        domain_fp: cfg_domain,
        door_auth_pubkey: cfg.door_auth_pubkey.as_slice(),
        challenge_ttl_s: v2::DEFAULT_CHALLENGE_TTL_S,
    };
    let c = match consent {
        Consent::Live { challenge, sig } => v2::Consent::Live {
            challenge: challenge.as_slice(),
            sig: sig.as_slice(),
        },
        Consent::Printed { sig } => v2::Consent::Printed { sig: sig.as_slice() },
    };
    let input = v2::ConsumeInput {
        proof: proof.as_slice(),
        root: arr32("root", &i.root)?,
        nullifier: arr32("nullifier", &i.nullifier)?,
        rk_x: arr32("rk_x", &i.rk_x)?,
        rk_y: arr32("rk_y", &i.rk_y)?,
        consent: c,
    };
    let ctx = v2::Ctx {
        sender: info.sender.as_str(),
        now_s: env.block.time.seconds(),
    };
    v2::verify_consume(host, &door, &input, ctx).map_err(map_verify)
}

/// Canonical Pallas field element check for published roots.
pub fn require_canonical_root(root: &HexBinary) -> Result<(), ContractError> {
    let arr = arr32("root", root)?;
    if !v2::is_canonical(&arr) {
        return Err(ContractError::BadPublicInput);
    }
    Ok(())
}

#[cfg(test)]
struct TestHost;

#[cfg(test)]
impl ZkHost for TestHost {
    fn proof_instance_verify(
        &self,
        _zkid: u64,
        proof: &[u8],
        _instances: &[u8],
    ) -> Result<bool, String> {
        Ok(proof == STUB_OK)
    }

    fn redpallas_spendauth_verify(
        &self,
        _message: &[u8],
        sig: &[u8],
        _rk: &[u8],
    ) -> Result<bool, String> {
        // 64-byte signatures are accepted in unit tests; a leading 0xff marks a bad sig.
        Ok(sig.len() == 64 && sig.first() != Some(&0xff))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{mock_env, mock_info};
    use cosmwasm_std::HexBinary;

    fn fp(b: u8) -> HexBinary {
        HexBinary::from([b; 32])
    }

    fn cfg() -> Config {
        // Minimal config for verifier unit tests. Unused fields are dummy.
        use crate::state::EventStatus;
        use cosmwasm_std::{Addr, Timestamp};
        Config {
            curator: Addr::unchecked("curator"),
            cw_ave: None,
            coordinators: Addr::unchecked("group"),
            randomness: None,
            id: "speakez-sessions".into(),
            name: "Speakez Sessions".into(),
            status: EventStatus::Announced,
            start: Timestamp::from_seconds(1),
            end: Timestamp::from_seconds(2),
            timezone: "UTC".into(),
            venue_label: String::new(),
            domain: "http://127.0.0.1:3051".into(),
            door_auth_pubkey: HexBinary::from([9u8; 32]),
            kind: 31923,
            d_tag: "speakez-sessions".into(),
            summary: String::new(),
            content: String::new(),
            location: String::new(),
            geohash: String::new(),
            image: String::new(),
            tags: vec![],
            metadata_uri: String::new(),
            metadata_hash: HexBinary::from(vec![]),
            service_key: None,
            usher_group: None,
            zkid: 7,
            event_id_fp: fp(3),
            domain_fp: fp(4),
            guest_root: HexBinary::from(vec![0u8; 32]),
            leaf_count: 0,
            epoch: 0,
            guest_root_vk: None,
        }
    }

    fn ok_inputs() -> ConsumePublicInputs {
        ConsumePublicInputs {
            root: fp(1),
            nullifier: fp(8),
            event_id: fp(3),
            domain: fp(4),
            rk_x: fp(5),
            rk_y: fp(6),
        }
    }

    fn sig_ok() -> Binary {
        Binary::from(vec![1u8; 64])
    }

    fn printed() -> Consent {
        Consent::Printed { sig: sig_ok() }
    }

    #[test]
    fn zkid_zero_is_fail_closed() {
        let mut c = cfg();
        c.zkid = 0;
        let err = verify_ticket_proof(
            &mock_env(),
            &mock_info("usher", &[]),
            &c,
            &Binary::from(STUB_OK.to_vec()),
            &ok_inputs(),
            &printed(),
        )
        .unwrap_err();
        assert_eq!(err, ContractError::ZkidUnset);
    }

    #[test]
    fn stub_ok_accepted_in_tests() {
        verify_ticket_proof(
            &mock_env(),
            &mock_info("usher", &[]),
            &cfg(),
            &Binary::from(STUB_OK.to_vec()),
            &ok_inputs(),
            &printed(),
        )
        .unwrap();
    }

    #[test]
    fn other_proofs_are_rejected() {
        let err = verify_ticket_proof(
            &mock_env(),
            &mock_info("usher", &[]),
            &cfg(),
            &Binary::from(vec![9, 9, 9]),
            &ok_inputs(),
            &printed(),
        )
        .unwrap_err();
        assert_eq!(
            err,
            ContractError::TicketRejected("ticket proof invalid".into())
        );
    }

    #[test]
    fn short_public_input_is_rejected() {
        let mut inputs = ok_inputs();
        inputs.root = HexBinary::from(vec![1, 2]);
        let err = verify_ticket_proof(
            &mock_env(),
            &mock_info("usher", &[]),
            &cfg(),
            &Binary::from(STUB_OK.to_vec()),
            &inputs,
            &printed(),
        )
        .unwrap_err();
        assert_eq!(err, ContractError::BadLength);
    }

    #[test]
    fn event_or_domain_mismatch_is_wrong_event() {
        let mut inputs = ok_inputs();
        inputs.event_id = fp(9);
        let err = verify_ticket_proof(
            &mock_env(),
            &mock_info("usher", &[]),
            &cfg(),
            &Binary::from(STUB_OK.to_vec()),
            &inputs,
            &printed(),
        )
        .unwrap_err();
        assert_eq!(err, ContractError::WrongEvent);
    }

    #[test]
    fn printed_disabled_without_door_auth() {
        let mut c = cfg();
        c.door_auth_pubkey = HexBinary::from(vec![]);
        let err = verify_ticket_proof(
            &mock_env(),
            &mock_info("usher", &[]),
            &c,
            &Binary::from(STUB_OK.to_vec()),
            &ok_inputs(),
            &printed(),
        )
        .unwrap_err();
        assert_eq!(
            err,
            ContractError::TicketRejected(
                "printed tickets disabled (no door_auth_pubkey)".into()
            )
        );
    }
}
