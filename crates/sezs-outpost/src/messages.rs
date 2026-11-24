//! Canonical sezs-0020 messages. UTF-8, LF, no trailing newline.
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

pub const GRANT_DOMAIN: &str = "SEZS-DEVICE-GRANT-V1";
pub const FRAME_DOMAIN: &str = "SEZS-TICKET-FRAME-V1";
pub const CONSUME_DEVICE_DOMAIN: &str = "SEZS-CONSUME-V3-DEVICE";
pub const USHER_REG_DOMAIN: &str = "SEZS-USHER-REG-V1";
pub const CAP_SCAN_TICKET: &str = "scan-ticket";

fn is_hex(s: &str, n: usize) -> bool {
    s.len() == n && s.chars().all(|c| c.is_ascii_hexdigit())
}
fn norm_hex(s: &str) -> String {
    s.trim().to_ascii_lowercase()
}
pub fn is_terp_addr(s: &str) -> bool {
    let s = s.trim();
    let lower = s.to_ascii_lowercase();
    lower.starts_with("terp1")
        && lower.len() >= 5 + 38
        && lower[5..]
            .chars()
            .all(|c| matches!(c, '0'..='9' | 'a'..='z'))
}
fn is_contract(s: &str) -> bool {
    s.is_empty() || s == "-" || is_terp_addr(s)
}
fn is_cap_list(s: &str) -> bool {
    s.split(',').map(|x| x.trim()).any(|x| x == CAP_SCAN_TICKET)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// First 8 bytes of sha256(event id), 16 hex chars.
pub fn event_tag_hex(event_id: &str) -> String {
    sha256_hex(event_id.as_bytes())[..16].to_string()
}

fn field(lines: &[&str], prefix: &str) -> Result<String, String> {
    lines
        .iter()
        .find(|l| l.starts_with(prefix))
        .map(|l| l[prefix.len()..].trim().to_string())
        .ok_or_else(|| format!("missing {prefix}"))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantMsg {
    pub device_sign_pubkey: String,
    pub device_noise_static: String,
    pub usher: String,
    pub event_id: String,
    pub contract: String,
    pub capabilities: String,
    pub expiry: i64,
    pub nonce: String,
    pub text: String,
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameMsg {
    pub grant_hash: String,
    pub device_sign_pubkey: String,
    pub event_id: String,
    pub event_tag: String,
    pub seq: u64,
    pub ts: i64,
    pub payload: String,
    pub text: String,
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsumeDeviceMsg {
    pub usher: String,
    pub event_id: String,
    pub nullifier: String,
    pub root: String,
    pub proof_hash: String,
    pub expiry: i64,
    pub grant_hash: String,
    pub frame_hash: String,
    pub frame_sig: String,
    pub frame_seq: u64,
    pub text: String,
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsherRegMsg {
    pub event_id: String,
    pub usher: String,
    pub terp: String,
    pub zid: String,
    pub expiry: i64,
    pub nonce: String,
    pub text: String,
    pub hash: String,
}

pub fn encode_grant(
    device_sign_pubkey: &str,
    device_noise_static: &str,
    usher: &str,
    event_id: &str,
    contract: &str,
    capabilities: &str,
    expiry: i64,
    nonce: &str,
) -> Result<GrantMsg, String> {
    let sign = norm_hex(device_sign_pubkey);
    let noise = norm_hex(device_noise_static);
    let caps = if capabilities.trim().is_empty() {
        CAP_SCAN_TICKET.to_string()
    } else {
        capabilities.trim().to_string()
    };
    let n = norm_hex(nonce);
    let ctr = {
        let c = contract.trim();
        if c.is_empty() {
            "-".into()
        } else {
            c.to_string()
        }
    };
    if !is_hex(&sign, 64) {
        return Err("device_sign_pubkey must be 32-byte hex".into());
    }
    if !is_hex(&noise, 64) {
        return Err("device_noise_static must be 32-byte hex".into());
    }
    if !is_terp_addr(usher) {
        return Err("bad usher address".into());
    }
    if event_id.is_empty() {
        return Err("event required".into());
    }
    if !is_contract(&ctr) {
        return Err("bad contract".into());
    }
    if !is_cap_list(&caps) {
        return Err("capabilities must include scan-ticket".into());
    }
    if expiry <= 0 {
        return Err("expiry required".into());
    }
    if !is_hex(&n, 64) {
        return Err("nonce must be 32-byte hex".into());
    }
    let text = [
        GRANT_DOMAIN.to_string(),
        format!("device_sign_pubkey: {sign}"),
        format!("device_noise_static: {noise}"),
        format!("usher: {usher}"),
        format!("event: {event_id}"),
        format!("contract: {ctr}"),
        format!("capabilities: {caps}"),
        format!("expiry: {expiry}"),
        format!("nonce: {n}"),
    ]
    .join("\n");
    Ok(GrantMsg {
        device_sign_pubkey: sign,
        device_noise_static: noise,
        usher: usher.to_string(),
        event_id: event_id.to_string(),
        contract: ctr,
        capabilities: caps,
        expiry,
        nonce: n,
        hash: sha256_hex(text.as_bytes()),
        text,
    })
}

pub fn decode_grant(text: &str) -> Result<GrantMsg, String> {
    let lines: Vec<&str> = text.split('\n').collect();
    if lines.first().copied() != Some(GRANT_DOMAIN) {
        return Err("bad grant domain".into());
    }
    let again = encode_grant(
        &field(&lines, "device_sign_pubkey: ")?,
        &field(&lines, "device_noise_static: ")?,
        &field(&lines, "usher: ")?,
        &field(&lines, "event: ")?,
        &field(&lines, "contract: ")?,
        &field(&lines, "capabilities: ")?,
        field(&lines, "expiry: ")?
            .parse()
            .map_err(|_| "bad expiry".to_string())?,
        &field(&lines, "nonce: ")?,
    )?;
    if again.text != text {
        return Err("grant not canonical".into());
    }
    Ok(again)
}

pub fn encode_frame(
    grant_hash: &str,
    device_sign_pubkey: &str,
    event_id: &str,
    event_tag: Option<&str>,
    seq: u64,
    ts: i64,
    payload: &str,
) -> Result<FrameMsg, String> {
    let gh = norm_hex(grant_hash);
    let pk = norm_hex(device_sign_pubkey);
    let tag = event_tag
        .map(norm_hex)
        .unwrap_or_else(|| event_tag_hex(event_id));
    let body = payload.trim().to_string();
    if !is_hex(&gh, 64) {
        return Err("grant_hash must be 32-byte hex".into());
    }
    if !is_hex(&pk, 64) {
        return Err("device_sign_pubkey must be 32-byte hex".into());
    }
    if event_id.is_empty() {
        return Err("event required".into());
    }
    if !is_hex(&tag, 16) {
        return Err("event_tag must be 8-byte hex".into());
    }
    if seq < 1 {
        return Err("seq must be a positive integer".into());
    }
    if ts <= 0 {
        return Err("ts required".into());
    }
    if !body.to_ascii_lowercase().starts_with("sezs3")
        || !body.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err("payload must be a sezs3 code".into());
    }
    let text = [
        FRAME_DOMAIN.to_string(),
        format!("grant_hash: {gh}"),
        format!("device_sign_pubkey: {pk}"),
        format!("event: {event_id}"),
        format!("event_tag: {tag}"),
        format!("seq: {seq}"),
        format!("ts: {ts}"),
        format!("payload: {body}"),
    ]
    .join("\n");
    Ok(FrameMsg {
        grant_hash: gh,
        device_sign_pubkey: pk,
        event_id: event_id.to_string(),
        event_tag: tag,
        seq,
        ts,
        payload: body,
        hash: sha256_hex(text.as_bytes()),
        text,
    })
}

pub fn decode_frame(text: &str) -> Result<FrameMsg, String> {
    let lines: Vec<&str> = text.split('\n').collect();
    if lines.first().copied() != Some(FRAME_DOMAIN) {
        return Err("bad frame domain".into());
    }
    let seq: u64 = field(&lines, "seq: ")?
        .parse()
        .map_err(|_| "bad seq".to_string())?;
    let ts: i64 = field(&lines, "ts: ")?
        .parse()
        .map_err(|_| "bad ts".to_string())?;
    let again = encode_frame(
        &field(&lines, "grant_hash: ")?,
        &field(&lines, "device_sign_pubkey: ")?,
        &field(&lines, "event: ")?,
        Some(&field(&lines, "event_tag: ")?),
        seq,
        ts,
        &field(&lines, "payload: ")?,
    )?;
    if again.text != text {
        return Err("frame not canonical".into());
    }
    Ok(again)
}

pub fn encode_consume_device(
    usher: &str,
    event_id: &str,
    nullifier: &str,
    root: &str,
    proof_hash: &str,
    expiry: i64,
    grant_hash: &str,
    frame_hash: &str,
    frame_sig: &str,
    frame_seq: u64,
) -> Result<ConsumeDeviceMsg, String> {
    if !is_terp_addr(usher) {
        return Err("bad usher address".into());
    }
    if event_id.is_empty() {
        return Err("event required".into());
    }
    let nullifier = norm_hex(nullifier);
    let root = norm_hex(root);
    let proof_hash = norm_hex(proof_hash);
    let grant_hash = norm_hex(grant_hash);
    let frame_hash = norm_hex(frame_hash);
    let frame_sig = norm_hex(frame_sig);
    if !is_hex(&nullifier, 64) || !is_hex(&root, 64) || !is_hex(&proof_hash, 64) {
        return Err("nullifier, root, and proof_hash must be 32-byte hex".into());
    }
    if !is_hex(&grant_hash, 64) || !is_hex(&frame_hash, 64) || !is_hex(&frame_sig, 128) {
        return Err("grant_hash, frame_hash, and frame_sig must be hex".into());
    }
    if expiry <= 0 {
        return Err("expiry required".into());
    }
    let text = [
        CONSUME_DEVICE_DOMAIN.to_string(),
        format!("usher: {usher}"),
        format!("event: {event_id}"),
        format!("nullifier: {nullifier}"),
        format!("root: {root}"),
        format!("proof_hash: {proof_hash}"),
        format!("expiry: {expiry}"),
        format!("grant_hash: {grant_hash}"),
        format!("frame_hash: {frame_hash}"),
        format!("frame_sig: {frame_sig}"),
        format!("frame_seq: {frame_seq}"),
    ]
    .join("\n");
    Ok(ConsumeDeviceMsg {
        usher: usher.to_string(),
        event_id: event_id.to_string(),
        nullifier,
        root,
        proof_hash,
        expiry,
        grant_hash,
        frame_hash,
        frame_sig,
        frame_seq,
        hash: sha256_hex(text.as_bytes()),
        text,
    })
}

pub fn decode_consume_device(text: &str) -> Result<ConsumeDeviceMsg, String> {
    let lines: Vec<&str> = text.split('\n').collect();
    if lines.first().copied() != Some(CONSUME_DEVICE_DOMAIN) {
        return Err("bad consume domain".into());
    }
    let again = encode_consume_device(
        &field(&lines, "usher: ")?,
        &field(&lines, "event: ")?,
        &field(&lines, "nullifier: ")?,
        &field(&lines, "root: ")?,
        &field(&lines, "proof_hash: ")?,
        field(&lines, "expiry: ")?
            .parse()
            .map_err(|_| "bad expiry".to_string())?,
        &field(&lines, "grant_hash: ")?,
        &field(&lines, "frame_hash: ")?,
        &field(&lines, "frame_sig: ")?,
        field(&lines, "frame_seq: ")?
            .parse()
            .map_err(|_| "bad frame_seq".to_string())?,
    )?;
    if again.text != text {
        return Err("consume not canonical".into());
    }
    Ok(again)
}

pub fn encode_usher_reg(
    event_id: &str,
    usher: &str,
    terp: &str,
    zid: &str,
    expiry: i64,
    nonce: &str,
) -> Result<UsherRegMsg, String> {
    if event_id.is_empty() {
        return Err("event required".into());
    }
    if !is_terp_addr(usher) {
        return Err("bad usher address".into());
    }
    let taddr = if terp.trim().is_empty() {
        "-".into()
    } else {
        terp.trim().to_string()
    };
    let z = if zid.trim().is_empty() {
        "-".into()
    } else {
        zid.trim().to_string()
    };
    let n = norm_hex(nonce);
    if !is_hex(&n, 64) {
        return Err("nonce must be 32-byte hex".into());
    }
    if expiry <= 0 {
        return Err("expiry required".into());
    }
    let text = [
        USHER_REG_DOMAIN.to_string(),
        format!("event: {event_id}"),
        format!("usher: {usher}"),
        format!("terp: {taddr}"),
        format!("zid: {z}"),
        format!("expiry: {expiry}"),
        format!("nonce: {n}"),
    ]
    .join("\n");
    Ok(UsherRegMsg {
        event_id: event_id.to_string(),
        usher: usher.to_string(),
        terp: taddr,
        zid: z,
        expiry,
        nonce: n,
        hash: sha256_hex(text.as_bytes()),
        text,
    })
}

pub fn decode_usher_reg(text: &str) -> Result<UsherRegMsg, String> {
    let lines: Vec<&str> = text.split('\n').collect();
    if lines.first().copied() != Some(USHER_REG_DOMAIN) {
        return Err("bad usher-reg domain".into());
    }
    let again = encode_usher_reg(
        &field(&lines, "event: ")?,
        &field(&lines, "usher: ")?,
        &field(&lines, "terp: ")?,
        &field(&lines, "zid: ")?,
        field(&lines, "expiry: ")?
            .parse()
            .map_err(|_| "bad expiry".to_string())?,
        &field(&lines, "nonce: ")?,
    )?;
    if again.text != text {
        return Err("usher-reg not canonical".into());
    }
    Ok(again)
}

pub fn verify_frame_sig(text: &str, sig_hex: &str, pubkey_hex: &str) -> bool {
    let pk = match hex::decode(pubkey_hex) {
        Ok(b) if b.len() == 32 => b,
        _ => return false,
    };
    let sig = match hex::decode(sig_hex) {
        Ok(b) if b.len() == 64 => b,
        _ => return false,
    };
    let vk = match VerifyingKey::from_bytes(pk.as_slice().try_into().ok().unwrap_or(&[0u8; 32])) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let signature = match Signature::from_slice(&sig) {
        Ok(s) => s,
        Err(_) => return false,
    };
    vk.verify(text.as_bytes(), &signature).is_ok()
}
