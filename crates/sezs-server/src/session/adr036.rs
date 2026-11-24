//! ADR-036 off-chain signatures, matching Zafu / Keplr signArbitrary.

use base64::Engine;
use k256::ecdsa::signature::hazmat::PrehashVerifier;
use k256::ecdsa::{Signature, VerifyingKey};
use ripemd::Ripemd160;
use sha2::{Digest, Sha256};

fn b64_decode(s: &str) -> Option<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .ok()
}

fn b64_encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub fn adr036_sign_doc(signer: &str, data: &[u8]) -> serde_json::Value {
    serde_json::json!({
        "account_number": "0",
        "chain_id": "",
        "fee": { "amount": [], "gas": "0" },
        "memo": "",
        "msgs": [{
            "type": "sign/MsgSignData",
            "value": { "data": b64_encode(data), "signer": signer }
        }],
        "sequence": "0",
    })
}

pub fn sign_doc_bytes(signer: &str, data: &[u8]) -> Vec<u8> {
    serde_json::to_vec(&adr036_sign_doc(signer, data)).expect("sign doc json")
}

fn pubkey_hash(pubkey: &[u8]) -> [u8; 20] {
    let sha = Sha256::digest(pubkey);
    let ripe = Ripemd160::digest(sha);
    let mut out = [0u8; 20];
    out.copy_from_slice(&ripe);
    out
}

fn decode_bech32(addr: &str) -> Option<(String, Vec<u8>)> {
    let (hrp, data, _variant) = bech32::decode(addr).ok()?;
    let bytes = bech32::FromBase32::from_base32(&data).ok()?;
    Some((hrp, bytes))
}

pub fn verify_adr036(
    prefix: &str,
    signer: &str,
    data: &[u8],
    pub_key_type: &str,
    pub_key_value: &str,
    signature_b64: &str,
) -> bool {
    (|| -> Option<()> {
        let (hrp, addr_data) = decode_bech32(signer)?;
        if hrp != prefix {
            return None;
        }
        if pub_key_type != "tendermint/PubKeySecp256k1" {
            return None;
        }
        let pubkey = b64_decode(pub_key_value)?;
        if pubkey_hash(&pubkey).as_slice() != addr_data.as_slice() {
            return None;
        }
        let doc = sign_doc_bytes(signer, data);
        let digest = Sha256::digest(&doc);
        let sig_bytes = b64_decode(signature_b64)?;
        let sig = if sig_bytes.len() == 64 {
            Signature::from_slice(&sig_bytes).ok()?
        } else {
            Signature::from_der(&sig_bytes).ok()?
        };
        let vk = VerifyingKey::from_sec1_bytes(&pubkey).ok()?;
        vk.verify_prehash(&digest, &sig).ok()?;
        Some(())
    })()
    .is_some()
}

pub fn terp_address_from_compressed_pubkey(pub_compressed: &[u8]) -> Option<String> {
    let hash = pubkey_hash(pub_compressed);
    bech32::encode(
        "terp",
        bech32::ToBase32::to_base32(&hash),
        bech32::Variant::Bech32,
    )
    .ok()
}

pub fn sign_adr036(signer: &str, data: &[u8], secret: &[u8]) -> Option<(String, String)> {
    use k256::ecdsa::SigningKey;
    let sk = SigningKey::from_slice(secret).ok()?;
    let vk = sk.verifying_key();
    let pub_bytes = vk.to_encoded_point(true);
    let doc = sign_doc_bytes(signer, data);
    let digest = Sha256::digest(&doc);
    let (sig, _recid) = sk.sign_prehash_recoverable(&digest).ok()?;
    Some((
        b64_encode(pub_bytes.as_bytes()),
        b64_encode(&sig.to_bytes()),
    ))
}

pub fn new_admin() -> Option<(Vec<u8>, String, Vec<u8>)> {
    use k256::ecdsa::SigningKey;
    let sk = SigningKey::random(&mut rand::thread_rng());
    let secret = sk.to_bytes().to_vec();
    let pub_bytes = sk
        .verifying_key()
        .to_encoded_point(true)
        .as_bytes()
        .to_vec();
    let address = terp_address_from_compressed_pubkey(&pub_bytes)?;
    Some((secret, address, pub_bytes))
}
