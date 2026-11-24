//! HMAC-SHA256 session tokens: `v1.<payload_b64url>.<sig_b64url>`.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

const TOKEN_RE: &str = r"^v1\.([A-Za-z0-9_-]{1,512})\.([A-Za-z0-9_-]{43})$";
const HEX_KEY_RE: &str = r"^[0-9a-fA-F]{64,}$";
const ALLOWED_KINDS: &[&str] = &["ed25519/zid", "p256/passkey", "terp-bech32"];

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionClaims {
    pub v: u8,
    pub sid: String,
    pub lid: String,
    pub sub: String,
    pub kind: String,
    pub org: String,
    pub iat: i64,
    pub exp: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("session secret buffer must be at least 32 bytes")]
    BufferTooShort,
    #[error("session secret is too short")]
    TooShort,
    #[error("SEZS_SESSION_SECRET is too short")]
    EnvTooShort,
    #[error("SEZS_SESSION_SECRET_FILE does not exist")]
    FileMissing,
    #[error("SEZS_SESSION_SECRET_FILE contents too short")]
    FileTooShort,
    #[error("SEZS_SESSION_SECRET or SEZS_SESSION_SECRET_FILE is required in production")]
    RequiredInProduction,
}

fn derive_secret_bytes(raw: &str) -> Option<[u8; 32]> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    if regex_is_match(HEX_KEY_RE, s) {
        let bytes = hex::decode(s).ok()?;
        if bytes.len() < 32 {
            return None;
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(&bytes[..32]);
        return Some(out);
    }
    if s.len() < 16 {
        return None;
    }
    let d = Sha256::digest(s.as_bytes());
    let mut out = [0u8; 32];
    out.copy_from_slice(&d);
    Some(out)
}

fn regex_is_match(re: &str, s: &str) -> bool {
    regex::Regex::new(re)
        .map(|r| r.is_match(s))
        .unwrap_or(false)
}

fn env_get(env: &[(String, String)], key: &str) -> String {
    env.iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

/// Resolve the 32-byte session HMAC key from an explicit secret, a file, or env.
pub fn resolve_session_secret(
    secret: Option<&[u8]>,
    secret_file: Option<&str>,
    state_dir: Option<&std::path::Path>,
    env: &[(String, String)],
) -> Result<[u8; 32], SecretError> {
    if let Some(buf) = secret {
        if buf.len() < 32 {
            return Err(SecretError::BufferTooShort);
        }
        // If the provided bytes look like UTF-8 text, derive like the Node path.
        if let Ok(s) = std::str::from_utf8(buf) {
            if s.chars()
                .all(|c| c.is_ascii_graphic() || c.is_ascii_whitespace())
            {
                if let Some(derived) = derive_secret_bytes(s) {
                    return Ok(derived);
                }
            }
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(&buf[..32]);
        return Ok(out);
    }

    let from_env = env_get(env, "SEZS_SESSION_SECRET");
    let from_env = from_env.trim();
    if !from_env.is_empty() {
        return derive_secret_bytes(from_env).ok_or(SecretError::EnvTooShort);
    }

    let file_path = secret_file
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            let v = env_get(env, "SEZS_SESSION_SECRET_FILE");
            let t = v.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        });
    if let Some(path) = file_path {
        let p = std::path::Path::new(&path);
        if !p.exists() {
            return Err(SecretError::FileMissing);
        }
        let text = std::fs::read_to_string(p).map_err(|_| SecretError::FileMissing)?;
        return derive_secret_bytes(&text).ok_or(SecretError::FileTooShort);
    }

    let node_env = env_get(env, "NODE_ENV");
    let sezs_env = env_get(env, "SEZS_ENV");
    if node_env.trim() == "production" || sezs_env.trim() == "production" {
        return Err(SecretError::RequiredInProduction);
    }

    if let Some(dir) = state_dir {
        std::fs::create_dir_all(dir).ok();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
        let p = dir.join("session.key");
        if p.exists() {
            if let Ok(text) = std::fs::read_to_string(&p) {
                if let Some(derived) = derive_secret_bytes(&text) {
                    return Ok(derived);
                }
            }
        }
        let fresh: [u8; 32] = rand::random();
        let _ = std::fs::write(&p, format!("{}\n", hex::encode(fresh)));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
        }
        return Ok(fresh);
    }

    Ok(rand::random())
}

fn b64url(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn hmac_b64(secret: &[u8], input: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac key");
    mac.update(input.as_bytes());
    b64url(&mac.finalize().into_bytes())
}

pub fn sign_session_token(claims: &SessionClaims, secret: &[u8]) -> Result<String, &'static str> {
    if !ALLOWED_KINDS.contains(&claims.kind.as_str()) {
        return Err("unsupported session kind");
    }
    // Insertion order must match the Node signer for cross-implementation tokens.
    let payload = serde_json::json!({
        "v": claims.v,
        "sid": claims.sid,
        "lid": claims.lid,
        "sub": claims.sub,
        "kind": claims.kind,
        "org": claims.org,
        "iat": claims.iat,
        "exp": claims.exp,
    });
    let payload_b64 = b64url(payload.to_string().as_bytes());
    let body = format!("v1.{payload_b64}");
    let sig = hmac_b64(secret, &body);
    Ok(format!("{body}.{sig}"))
}

pub fn verify_session_token(
    token: &str,
    secret: &[u8],
    now: i64,
    expected_origin: Option<&str>,
) -> Option<SessionClaims> {
    if token.len() > 640 {
        return None;
    }
    let re = regex::Regex::new(TOKEN_RE).ok()?;
    let caps = re.captures(token)?;
    let payload_b64 = caps.get(1)?.as_str();
    let sig_b64 = caps.get(2)?.as_str();
    let mut mac = HmacSha256::new_from_slice(secret).ok()?;
    mac.update(format!("v1.{payload_b64}").as_bytes());
    let expected = mac.finalize().into_bytes();
    use base64::Engine;
    let got = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(sig_b64)
        .ok()?;
    let expected_bytes: &[u8] = expected.as_ref();
    if got.len() != expected_bytes.len() || !bool::from(expected_bytes.ct_eq(&got)) {
        return None;
    }
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64)
        .ok()?;
    let parsed: SessionClaims = serde_json::from_slice(&raw).ok()?;
    if parsed.v != 1 || !ALLOWED_KINDS.contains(&parsed.kind.as_str()) {
        return None;
    }
    if parsed.sid.is_empty() || parsed.sub.is_empty() {
        return None;
    }
    if parsed.exp <= now {
        return None;
    }
    if let Some(org) = expected_origin {
        if parsed.org != org {
            return None;
        }
    }
    Some(parsed)
}

pub fn process_env() -> Vec<(String, String)> {
    std::env::vars().collect()
}
