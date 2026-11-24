//! Verification order from sezs-0020.
use crate::messages::{
    decode_consume_device, decode_frame, decode_grant, event_tag_hex, verify_frame_sig,
    ConsumeDeviceMsg, FrameMsg, GrantMsg, CAP_SCAN_TICKET,
};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BleError {
    BadGrant,
    BadAdminSig,
    RevokedDevice,
    ExpiredGrant,
    WrongEvent,
    MissingCapability,
    BadFrame,
    BadFrameSig,
    ReplayedFrame,
    StaleFrame,
    TamperedPayload,
    GrantMismatch,
    BadConsume,
    BadSignature,
    NonAdmin,
    NonUsher,
    UnknownDevice,
    MissingFrame,
}

impl BleError {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::BadGrant => "bad_grant",
            Self::BadAdminSig => "bad_admin_sig",
            Self::RevokedDevice => "revoked_device",
            Self::ExpiredGrant => "expired_grant",
            Self::WrongEvent => "wrong_event",
            Self::MissingCapability => "missing_capability",
            Self::BadFrame => "bad_frame",
            Self::BadFrameSig => "bad_frame_sig",
            Self::ReplayedFrame => "replayed_frame",
            Self::StaleFrame => "stale_frame",
            Self::TamperedPayload => "tampered_payload",
            Self::GrantMismatch => "grant_mismatch",
            Self::BadConsume => "bad_consume",
            Self::BadSignature => "bad_signature",
            Self::NonAdmin => "non_admin",
            Self::NonUsher => "non_usher",
            Self::UnknownDevice => "unknown_device",
            Self::MissingFrame => "missing_frame",
        }
    }
}

/// Caller-supplied admin / usher / signature checks (on-chain role set
/// and ADR-36 live on the desk / sezs-server path).
pub trait RoleChecks: Send + Sync {
    fn is_admin(&self, addr: &str) -> bool;
    fn is_usher(&self, addr: &str) -> bool;
    /// Admin ADR-36 (or a test stand-in) over the grant text.
    fn verify_admin_sig(&self, grant_text: &str, admin_sig: &Value, admin: &str) -> bool;
    /// Usher ADR-36 (or a test stand-in) over the consume-device text.
    fn verify_usher_sig(&self, consume_text: &str, auth: &Value, usher: &str) -> bool;
}

/// Always-allow role checks for simulated / unit tests.
pub struct OpenRoles;
impl RoleChecks for OpenRoles {
    fn is_admin(&self, _addr: &str) -> bool {
        true
    }
    fn is_usher(&self, _addr: &str) -> bool {
        true
    }
    fn verify_admin_sig(&self, _t: &str, sig: &Value, _a: &str) -> bool {
        !sig.is_null()
    }
    fn verify_usher_sig(&self, _t: &str, auth: &Value, _u: &str) -> bool {
        !auth.is_null()
    }
}

pub fn verify_grant(
    grant_text: &str,
    admin_sig: &Value,
    admin: &str,
    now: i64,
    roles: &dyn RoleChecks,
) -> Result<GrantMsg, BleError> {
    let grant = decode_grant(grant_text).map_err(|_| BleError::BadGrant)?;
    if grant.expiry <= now {
        return Err(BleError::ExpiredGrant);
    }
    if !grant
        .capabilities
        .split(',')
        .map(|s| s.trim())
        .any(|s| s == CAP_SCAN_TICKET)
    {
        return Err(BleError::MissingCapability);
    }
    if !roles.verify_admin_sig(grant_text, admin_sig, admin) {
        return Err(BleError::BadAdminSig);
    }
    if !roles.is_admin(admin) {
        return Err(BleError::NonAdmin);
    }
    Ok(grant)
}

const MAX_SKEW: i64 = 300;

pub fn verify_frame(
    frame_text: &str,
    frame_sig: &str,
    grant: &GrantMsg,
    last_seq: u64,
    seen: &std::collections::BTreeSet<String>,
    now: i64,
    expected_event: Option<&str>,
) -> Result<FrameMsg, BleError> {
    let frame = decode_frame(frame_text).map_err(|_| BleError::BadFrame)?;
    if frame.grant_hash != grant.hash {
        return Err(BleError::GrantMismatch);
    }
    if frame.device_sign_pubkey != grant.device_sign_pubkey {
        return Err(BleError::GrantMismatch);
    }
    if let Some(ev) = expected_event {
        if frame.event_id != ev || grant.event_id != ev {
            return Err(BleError::WrongEvent);
        }
    }
    if frame.event_id != grant.event_id {
        return Err(BleError::WrongEvent);
    }
    if frame.event_tag != event_tag_hex(&frame.event_id) {
        return Err(BleError::TamperedPayload);
    }
    if (frame.ts - now).abs() > MAX_SKEW {
        return Err(BleError::StaleFrame);
    }
    if frame.seq <= last_seq {
        return Err(BleError::ReplayedFrame);
    }
    let sk = format!("{}:{}", grant.hash.to_ascii_lowercase(), frame.seq);
    if seen.contains(&sk) {
        return Err(BleError::ReplayedFrame);
    }
    if !verify_frame_sig(frame_text, frame_sig, &grant.device_sign_pubkey) {
        return Err(BleError::BadFrameSig);
    }
    Ok(frame)
}

pub fn verify_device_chain(
    grant_text: &str,
    admin_sig: &Value,
    admin: &str,
    status: &str,
    frame_text: &str,
    frame_sig: &str,
    last_seq: u64,
    seen: &std::collections::BTreeSet<String>,
    consume: &Value,
    consume_auth_text: &str,
    auth: &Value,
    expected_event: Option<&str>,
    now: i64,
    roles: &dyn RoleChecks,
) -> Result<(GrantMsg, FrameMsg, ConsumeDeviceMsg), BleError> {
    if status == "revoked" {
        return Err(BleError::RevokedDevice);
    }
    let grant = verify_grant(grant_text, admin_sig, admin, now, roles)?;
    let frame = verify_frame(
        frame_text,
        frame_sig,
        &grant,
        last_seq,
        seen,
        now,
        expected_event,
    )?;
    let parsed = decode_consume_device(consume_auth_text).map_err(|_| BleError::BadConsume)?;
    if parsed.expiry <= now {
        return Err(BleError::ExpiredGrant);
    }
    if !roles.verify_usher_sig(consume_auth_text, auth, &parsed.usher) {
        return Err(BleError::BadSignature);
    }
    if parsed.grant_hash != grant.hash {
        return Err(BleError::GrantMismatch);
    }
    if parsed.frame_hash != frame.hash {
        return Err(BleError::TamperedPayload);
    }
    if parsed.frame_sig != frame_sig.to_ascii_lowercase() {
        return Err(BleError::BadFrameSig);
    }
    if parsed.frame_seq != frame.seq {
        return Err(BleError::ReplayedFrame);
    }
    if let Some(ev) = expected_event {
        if parsed.event_id != ev {
            return Err(BleError::WrongEvent);
        }
    }
    if parsed.usher != grant.usher {
        return Err(BleError::GrantMismatch);
    }
    if !roles.is_usher(&parsed.usher) {
        return Err(BleError::NonUsher);
    }
    // Bind consume fields when present.
    let nf = consume
        .get("nullifier")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let root = consume.get("root").and_then(|v| v.as_str()).unwrap_or("");
    let ph = consume
        .get("proofHash")
        .or_else(|| consume.get("proof_hash"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !nf.is_empty() && nf.to_ascii_lowercase() != parsed.nullifier {
        return Err(BleError::BadConsume);
    }
    if !root.is_empty() && root.to_ascii_lowercase() != parsed.root {
        return Err(BleError::BadConsume);
    }
    if !ph.is_empty() && ph.to_ascii_lowercase() != parsed.proof_hash {
        return Err(BleError::BadConsume);
    }
    Ok((grant, frame, parsed))
}
