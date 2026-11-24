//! WebAuthn P-256 assertion verification (UV required, rpId + origin checks).

use base64::Engine;
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct PasskeyOk {
    pub sign_count: u32,
    pub normalized_public_key: String,
    pub rp_id: String,
}

fn from_b64_any(s: &str) -> Option<Vec<u8>> {
    let raw = s.trim();
    if raw.is_empty() {
        return None;
    }
    if !regex::Regex::new(r"^[A-Za-z0-9+/_-]+=*$")
        .ok()?
        .is_match(raw)
    {
        return None;
    }
    let mut std = raw.replace('-', "+").replace('_', "/");
    let pad = (4 - (std.len() % 4)) % 4;
    std.extend(std::iter::repeat('=').take(pad));
    base64::engine::general_purpose::STANDARD.decode(std).ok()
}

fn is_ipv4_host(host: &str) -> bool {
    let parts: Vec<&str> = host.split('.').collect();
    parts.len() == 4
        && parts
            .iter()
            .all(|p| p.parse::<u8>().is_ok() && *p != "" && p.chars().all(|c| c.is_ascii_digit()))
}

pub fn resolve_rp_id_for_origin(origin: &str, configured_rp_id: Option<&str>) -> Option<String> {
    let url = url::Url::parse(origin).ok()?;
    let host = url.host_str()?.to_lowercase();
    if is_ipv4_host(&host) || host.contains(':') {
        return None;
    }
    if let Some(cfg) = configured_rp_id {
        let rp = cfg.trim().to_lowercase();
        if rp.is_empty() || is_ipv4_host(&rp) || rp.contains(':') {
            return None;
        }
        if host != rp && !host.ends_with(&format!(".{rp}")) {
            return None;
        }
        return Some(rp);
    }
    Some(host)
}

pub fn verify_passkey_assertion(
    origin: &str,
    rp_id: Option<&str>,
    challenge_b64: &str,
    public_key: &str,
    client_data_json: &str,
    authenticator_data: &str,
    signature: &str,
    prev_sign_count: u32,
) -> Result<PasskeyOk, &'static str> {
    let expected_rp_id = rp_id
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| resolve_rp_id_for_origin(origin, None))
        .ok_or("passkey_invalid_rp_id")?;

    let pub_bytes = from_b64_any(public_key).ok_or("proof_required")?;
    if pub_bytes.len() != 65 || pub_bytes[0] != 0x04 {
        return Err("proof_required");
    }
    let client_bytes = from_b64_any(client_data_json).ok_or("proof_required")?;
    let auth_data = from_b64_any(authenticator_data).ok_or("proof_required")?;
    let sig = from_b64_any(signature).ok_or("proof_required")?;
    if client_bytes.len() > 4096
        || auth_data.len() < 37
        || auth_data.len() > 4096
        || sig.len() > 256
    {
        return Err("proof_required");
    }

    let client: serde_json::Value =
        serde_json::from_slice(&client_bytes).map_err(|_| "bad_signature")?;
    if client.get("type").and_then(|v| v.as_str()) != Some("webauthn.get") {
        return Err("bad_signature");
    }
    if client.get("origin").and_then(|v| v.as_str()) != Some(origin) {
        return Err("passkey_origin");
    }
    if client.get("challenge").and_then(|v| v.as_str()) != Some(challenge_b64) {
        return Err("passkey_challenge");
    }
    if client.get("crossOrigin").and_then(|v| v.as_bool()) == Some(true) {
        return Err("passkey_origin");
    }

    let rp_hash = Sha256::digest(expected_rp_id.as_bytes());
    if auth_data[..32] != rp_hash[..] {
        return Err("passkey_rp_id");
    }
    let flags = auth_data[32];
    if flags & 0x01 == 0 || flags & 0x04 == 0 {
        return Err("passkey_flags");
    }
    if flags & 0x40 != 0 {
        return Err("bad_signature");
    }
    let sign_count =
        u32::from_be_bytes([auth_data[33], auth_data[34], auth_data[35], auth_data[36]]);
    if prev_sign_count > 0 && sign_count > 0 && sign_count <= prev_sign_count {
        return Err("passkey_counter");
    }

    let client_hash = Sha256::digest(&client_bytes);
    let mut signed = Vec::with_capacity(auth_data.len() + 32);
    signed.extend_from_slice(&auth_data);
    signed.extend_from_slice(&client_hash);

    let vk = VerifyingKey::from_sec1_bytes(&pub_bytes).map_err(|_| "bad_signature")?;
    let ecdsa_sig = Signature::from_der(&sig).map_err(|_| "bad_signature")?;
    vk.verify(&signed, &ecdsa_sig)
        .map_err(|_| "bad_signature")?;

    Ok(PasskeyOk {
        sign_count,
        normalized_public_key: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&pub_bytes),
        rp_id: expected_rp_id,
    })
}

pub fn from_b64_any_pub(s: &str) -> Option<Vec<u8>> {
    from_b64_any(s)
}

pub fn to_b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}
