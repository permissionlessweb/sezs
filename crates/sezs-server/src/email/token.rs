//! HMAC-SHA256 signed email session tokens and stateless PoW challenges.

use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

const TOKEN_MAX: usize = 640;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailTokenClaims {
    pub v: u32,
    pub sid: String,
    pub lid: String,
    pub sub: String,
    pub kind: String,
    #[serde(rename = "org")]
    pub origin: String,
    pub iat: i64,
    pub exp: i64,
}

pub fn resolve_email_session_secret(
    secret: Option<&[u8]>,
    state_dir: Option<&Path>,
    env: &[(&str, String)],
) -> anyhow::Result<Vec<u8>> {
    if let Some(s) = secret {
        if s.len() == 32 && env.iter().any(|(k, v)| *k == "raw" && v == "1") {
            // unused
        }
        if !s.is_empty() {
            // If already 32 raw bytes passed in tests as hashed? Node: if secret given,
            // Buffer.isBuffer(secret) ? secret : sha256(String(secret))
            // We'll treat &[u8] as raw if len==32 and no utf8 needed; tests pass
            // sessionSecret: 'test-secret-only' as string. Use a separate string API.
        }
    }
    if let Some(s) = secret {
        return Ok(Sha256::digest(s).to_vec());
    }
    let from_env = env
        .iter()
        .find(|(k, _)| *k == "SEZS_EMAIL_SESSION_SECRET")
        .map(|(_, v)| v.trim().to_string())
        .unwrap_or_default();
    if !from_env.is_empty() {
        if is_hex_key(&from_env) {
            let raw = hex::decode(&from_env)?;
            return Ok(raw.into_iter().take(32).collect());
        }
        return Ok(Sha256::digest(from_env.as_bytes()).to_vec());
    }
    let prod = env
        .iter()
        .any(|(k, v)| (*k == "NODE_ENV" || *k == "SEZS_ENV") && v == "production");
    if prod {
        anyhow::bail!("SEZS_EMAIL_SESSION_SECRET is required in production");
    }
    if let Some(dir) = state_dir {
        std::fs::create_dir_all(dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
        let p = dir.join("email-session.key");
        if p.exists() {
            let hexs = std::fs::read_to_string(&p)?.trim().to_string();
            if is_hex_key(&hexs) {
                let raw = hex::decode(hexs)?;
                return Ok(raw.into_iter().take(32).collect());
            }
        }
        let mut fresh = vec![0u8; 32];
        rand::thread_rng().fill_bytes(&mut fresh);
        std::fs::write(&p, format!("{}\n", hex::encode(&fresh)))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
        }
        return Ok(fresh);
    }
    let mut fresh = vec![0u8; 32];
    rand::thread_rng().fill_bytes(&mut fresh);
    Ok(fresh)
}

/// Resolve a string secret the same way Node does (hash unless it's a buffer).
pub fn secret_from_string(secret: &str) -> Vec<u8> {
    Sha256::digest(secret.as_bytes()).to_vec()
}

fn is_hex_key(s: &str) -> bool {
    s.len() >= 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn b64url(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn b64url_decode(s: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(s)
        .ok()
}

fn hmac_b64(secret: &[u8], input: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac");
    mac.update(input.as_bytes());
    b64url(&mac.finalize().into_bytes())
}

pub fn sign_session_token(
    sid: &str,
    lid: &str,
    sub: &str,
    origin: &str,
    iat: i64,
    exp: i64,
    secret: &[u8],
) -> String {
    let payload = serde_json::json!({
        "v": 1,
        "sid": sid,
        "lid": lid,
        "sub": sub,
        "kind": "email",
        "org": origin,
        "iat": iat,
        "exp": exp,
    });
    let payload_b64 = b64url(payload.to_string().as_bytes());
    let body = format!("v1.{payload_b64}");
    let sig = hmac_b64(secret, &body);
    format!("{body}.{sig}")
}

pub fn verify_session_token(
    token: &str,
    secret: &[u8],
    now: i64,
    expected_origin: Option<&str>,
) -> Option<EmailTokenClaims> {
    if token.len() > TOKEN_MAX {
        return None;
    }
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 || parts[0] != "v1" {
        return None;
    }
    let payload_b64 = parts[1];
    let sig_b64 = parts[2];
    if sig_b64.len() != 43 {
        // Node TOKEN_RE requires 43 char sig (base64url of 32 bytes)
        // allow anyway if decode matches
    }
    let body = format!("v1.{payload_b64}");
    let mut mac = HmacSha256::new_from_slice(secret).ok()?;
    mac.update(body.as_bytes());
    let expected = mac.finalize().into_bytes();
    let got = b64url_decode(sig_b64)?;
    if got.len() != expected.len() || expected.ct_eq(&got).unwrap_u8() != 1 {
        return None;
    }
    let raw = b64url_decode(payload_b64)?;
    let parsed: EmailTokenClaims = serde_json::from_slice(&raw).ok()?;
    if parsed.v != 1 || parsed.kind != "email" || parsed.sid.is_empty() || parsed.sub.is_empty() {
        return None;
    }
    if parsed.exp <= now {
        return None;
    }
    if let Some(o) = expected_origin {
        if parsed.origin != o {
            return None;
        }
    }
    Some(parsed)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowChallenge {
    pub salt: String,
    pub bits: u32,
    pub exp: i64,
    pub sig: String,
}

pub fn issue_pow_challenge(
    origin: &str,
    ip_hash: &str,
    bits: u32,
    now: i64,
    ttl_ms: i64,
    secret: &[u8],
) -> PowChallenge {
    let mut salt_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt = hex::encode(salt_bytes);
    let exp = now + ttl_ms;
    let payload = format!("pow1|{origin}|{ip_hash}|{bits}|{exp}|{salt}");
    PowChallenge {
        salt,
        bits,
        exp,
        sig: hmac_b64(secret, &payload),
    }
}

fn has_leading_zero_bits(buf: &[u8], bits: u32) -> bool {
    let full = (bits / 8) as usize;
    let rem = bits % 8;
    if buf.len() < full + if rem > 0 { 1 } else { 0 } {
        return false;
    }
    if buf.iter().take(full).any(|b| *b != 0) {
        return false;
    }
    if rem > 0 {
        let mask = 0xffu8 << (8 - rem);
        if buf[full] & mask != 0 {
            return false;
        }
    }
    true
}

pub fn verify_pow_solution(
    pow: &serde_json::Value,
    origin: &str,
    ip_hash: &str,
    min_bits: u32,
    now: i64,
    secret: &[u8],
) -> bool {
    let salt = pow.get("salt").and_then(|v| v.as_str()).unwrap_or("");
    let nonce = pow.get("nonce").and_then(|v| v.as_str()).unwrap_or("");
    let sig = pow.get("sig").and_then(|v| v.as_str()).unwrap_or("");
    let bits = pow.get("bits").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let exp = pow.get("exp").and_then(|v| v.as_i64()).unwrap_or(0);
    if salt.len() != 32 || !salt.chars().all(|c| c.is_ascii_hexdigit()) {
        return false;
    }
    if nonce.is_empty()
        || nonce.len() > 64
        || !nonce
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return false;
    }
    if bits < min_bits || bits > 28 {
        return false;
    }
    if exp <= now {
        return false;
    }
    let payload = format!("pow1|{origin}|{ip_hash}|{bits}|{exp}|{salt}");
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac");
    mac.update(payload.as_bytes());
    let expected = mac.finalize().into_bytes();
    let Some(got) = b64url_decode(sig) else {
        return false;
    };
    if got.len() != expected.len() || expected.ct_eq(&got).unwrap_u8() != 1 {
        return false;
    }
    let digest = Sha256::digest(format!("{salt}:{nonce}").as_bytes());
    has_leading_zero_bits(&digest, bits)
}
