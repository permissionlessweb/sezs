//! wasm-bindgen surface for the front end (P2) and the Node backend (P4).
//!
//! Bytes in/out are `Uint8Array`. Field elements are 32-byte little-endian.
//! The ticket secret is passed in by the holder's own page and never leaves it;
//! nothing here does I/O. Randomness comes from the caller
//! (`crypto.getRandomValues(new Uint8Array(32))`) as a 32-byte seed.

use sezs_ticket_v2::{
    bundle::{self, Bundle, ProveInput},
    consent,
    encode::{self, fp_from_le, fp_to_le},
    tree::GuestTree,
};
use pasta_curves::pallas;
use wasm_bindgen::prelude::*;

type R<T> = Result<T, JsError>;

fn err(e: impl core::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn fp(b: &[u8], what: &str) -> R<pallas::Base> {
    fp_from_le(b).map_err(|e| err(format!("{what}: {e}")))
}

fn seed32(b: &[u8]) -> R<[u8; 32]> {
    b.try_into().map_err(|_| err("seed must be 32 bytes"))
}

fn nonce16(b: &[u8]) -> R<[u8; 16]> {
    b.try_into().map_err(|_| err("alpha_nonce must be 16 bytes"))
}

fn leaves_of(b: &[u8]) -> R<Vec<pallas::Base>> {
    if b.len() % 32 != 0 {
        return Err(err("leaves must be n × 32 bytes"));
    }
    b.chunks_exact(32).map(|c| fp(c, "leaf")).collect()
}

/// Circuit constants: `{depth, k, numPublic, bundleVersion}` as JSON.
#[wasm_bindgen(js_name = circuitInfo)]
pub fn circuit_info() -> String {
    format!(
        "{{\"circuit\":\"sezs_consume_v2\",\"depth\":{},\"k\":{},\"numPublic\":{},\"bundleVersion\":{}}}",
        sezs_ticket_v2::DEPTH,
        sezs_ticket_v2::K,
        sezs_ticket_v2::NUM_PUBLIC,
        sezs_ticket_v2::BUNDLE_VERSION
    )
}

/// Generate params + proving key once (deterministic). Returns SHA-256(cs ‖ vk),
/// which must equal the on-chain circuit footer `vk_hash` for the event's zkid.
#[wasm_bindgen(js_name = warmUp)]
pub fn warm_up() -> R<Vec<u8>> {
    use sha2::{Digest, Sha256};
    let (_, cs, vk) = sezs_ticket_v2::keys::serialize(sezs_ticket_v2::keys::get()).map_err(err)?;
    let mut h = Sha256::new();
    h.update(&cs);
    h.update(&vk);
    Ok(h.finalize().to_vec())
}

#[wasm_bindgen(js_name = eventIdFp)]
pub fn event_id_fp(event_id: &str) -> R<Vec<u8>> {
    Ok(fp_to_le(&encode::event_id_fp(event_id).map_err(err)?).to_vec())
}

#[wasm_bindgen(js_name = skuFp)]
pub fn sku_fp(sku: &str) -> R<Vec<u8>> {
    Ok(fp_to_le(&encode::sku_fp(sku).map_err(err)?).to_vec())
}

#[wasm_bindgen(js_name = domainFp)]
pub fn domain_fp(domain: &str) -> Vec<u8> {
    fp_to_le(&encode::domain_fp(domain)).to_vec()
}

/// 32 random bytes → field-fitted secret (top two bits cleared).
#[wasm_bindgen(js_name = fitSecret)]
pub fn fit_secret(bytes: &[u8]) -> R<Vec<u8>> {
    Ok(fp_to_le(&encode::secret_from_bytes(seed32(bytes)?)).to_vec())
}

/// `C = Poseidon(secret, sku, event_id)` with standard P128Pow5T3.
#[wasm_bindgen]
pub fn commitment(secret: &[u8], sku: &str, event_id: &str) -> R<Vec<u8>> {
    let c = sezs_ticket_v2::commitment(
        fp(secret, "secret")?,
        encode::sku_fp(sku).map_err(err)?,
        encode::event_id_fp(event_id).map_err(err)?,
    );
    Ok(fp_to_le(&c).to_vec())
}

/// `N = Poseidon(secret, event_id)`.
#[wasm_bindgen]
pub fn nullifier(secret: &[u8], event_id: &str) -> R<Vec<u8>> {
    Ok(fp_to_le(&sezs_ticket_v2::nullifier(fp(secret, "secret")?, encode::event_id_fp(event_id).map_err(err)?)).to_vec())
}

/// Root of the guest tree over `leaves` (n × 32 bytes, append order).
#[wasm_bindgen(js_name = treeRoot)]
pub fn tree_root(leaves: &[u8]) -> R<Vec<u8>> {
    let t = GuestTree::from_leaves(leaves_of(leaves)?).map_err(err)?;
    Ok(fp_to_le(&t.root()).to_vec())
}

/// Proving output. `bundle` is public (show it at the door). `alphaNonce` is
/// public too; `rsk` is never returned: it is re-derived from the secret.
#[wasm_bindgen]
pub struct Proven {
    bundle: Vec<u8>,
    alpha_nonce: Vec<u8>,
    root: Vec<u8>,
    nullifier: Vec<u8>,
    leaf_index: u32,
}

#[wasm_bindgen]
impl Proven {
    #[wasm_bindgen(getter)]
    pub fn bundle(&self) -> Vec<u8> {
        self.bundle.clone()
    }
    #[wasm_bindgen(getter, js_name = alphaNonce)]
    pub fn alpha_nonce(&self) -> Vec<u8> {
        self.alpha_nonce.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn root(&self) -> Vec<u8> {
        self.root.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn nullifier(&self) -> Vec<u8> {
        self.nullifier.clone()
    }
    #[wasm_bindgen(getter, js_name = leafIndex)]
    pub fn leaf_index(&self) -> u32 {
        self.leaf_index
    }
}

/// Prove membership of this ticket's `C` in the tree built from the FULL leaf list
/// (download all leaves, find yours locally; never ask the server for "my" path).
/// `seed` = 32 fresh random bytes; `alpha_nonce` derives from it.
#[wasm_bindgen]
pub fn prove(secret: &[u8], sku: &str, event_id: &str, domain: &str, leaves: &[u8], seed: &[u8]) -> R<Proven> {
    let secret = fp(secret, "secret")?;
    let (s, e, d) = (encode::sku_fp(sku).map_err(err)?, encode::event_id_fp(event_id).map_err(err)?, encode::domain_fp(domain));
    let t = GuestTree::from_leaves(leaves_of(leaves)?).map_err(err)?;
    let c = sezs_ticket_v2::commitment(secret, s, e);
    let index = t.position(&c).ok_or_else(|| err("ticket commitment not in this leaf list (not paid yet, or wrong event/sku)"))?;
    let path = t.path(index).map_err(err)?;
    let mut rng = sezs_ticket_v2::rng_from_seed(seed32(seed)?);
    let mut alpha_nonce = [0u8; 16];
    rand_fill(&mut rng, &mut alpha_nonce);
    let p = bundle::prove(&ProveInput { secret, sku: s, event_id: e, domain: d, path, alpha_nonce }, &mut rng).map_err(err)?;
    Ok(Proven {
        root: p.bundle.root.to_vec(),
        nullifier: p.bundle.nullifier.to_vec(),
        bundle: p.bundle.to_bytes(),
        alpha_nonce: alpha_nonce.to_vec(),
        leaf_index: index as u32,
    })
}

fn rand_fill(rng: &mut rand::rngs::StdRng, out: &mut [u8]) {
    use rand::Rng as _;
    rng.fill_bytes(out)
}

/// Local check on the usher device (or the holder's) before submitting.
#[wasm_bindgen(js_name = verifyBundle)]
pub fn verify_bundle(bundle: &[u8], event_id: &str, domain: &str) -> R<bool> {
    let b = Bundle::from_bytes(bundle).map_err(err)?;
    Ok(bundle::verify(&b, encode::event_id_fp(event_id).map_err(err)?, encode::domain_fp(domain)).is_ok())
}

/// Bundle fields as JSON hex: `{root, nullifier, rk_x, rk_y, rk, proof_len}`.
#[wasm_bindgen(js_name = bundleFields)]
pub fn bundle_fields(bundle: &[u8]) -> R<String> {
    let b = Bundle::from_bytes(bundle).map_err(err)?;
    let h = encode::to_hex;
    Ok(format!(
        "{{\"root\":\"{}\",\"nullifier\":\"{}\",\"rk_x\":\"{}\",\"rk_y\":\"{}\",\"rk\":\"{}\",\"proof\":\"{}\",\"proof_len\":{}}}",
        h(&b.root),
        h(&b.nullifier),
        h(&b.rk_x),
        h(&b.rk_y),
        h(&b.rk()),
        h(&b.proof),
        b.proof.len()
    ))
}

/// Usher device: build the live challenge bytes to show as a QR.
#[wasm_bindgen(js_name = liveChallenge)]
pub fn live_challenge(event_id: &str, domain: &str, nonce: &[u8], issued_at: u64, usher: &str) -> R<Vec<u8>> {
    let n: [u8; 16] = nonce.try_into().map_err(|_| err("nonce must be 16 bytes"))?;
    if usher.is_empty() || usher.len() > consent::MAX_ADDR {
        return Err(err("usher address length"));
    }
    Ok(consent::LiveChallenge::new(encode::event_id_fp(event_id).map_err(err)?, encode::domain_fp(domain), n, issued_at, usher).to_bytes())
}

/// Holder device: decode a scanned challenge for the "Approve check-in?" screen.
/// Returns JSON `{event_id_fp, domain_fp, nonce, issued_at, usher}`.
#[wasm_bindgen(js_name = parseChallenge)]
pub fn parse_challenge(bytes: &[u8]) -> R<String> {
    let c = consent::LiveChallenge::from_bytes(bytes).map_err(err)?;
    let h = encode::to_hex;
    Ok(format!(
        "{{\"event_id_fp\":\"{}\",\"domain_fp\":\"{}\",\"nonce\":\"{}\",\"issued_at\":{},\"usher\":\"{}\"}}",
        h(&c.event_id),
        h(&c.domain),
        h(&c.nonce),
        c.issued_at,
        c.usher.replace('\\', "").replace('"', "")
    ))
}

/// Holder device: sign a live challenge. The caller must have shown the parsed
/// challenge (event, usher, time) and got an explicit approve tap first.
/// Refuses a challenge for another event or domain.
#[wasm_bindgen(js_name = signLive)]
pub fn sign_live(secret: &[u8], event_id: &str, domain: &str, alpha_nonce: &[u8], challenge: &[u8], seed: &[u8]) -> R<Vec<u8>> {
    let (e, d) = (encode::event_id_fp(event_id).map_err(err)?, encode::domain_fp(domain));
    let c = consent::LiveChallenge::from_bytes(challenge).map_err(err)?;
    if c.event_id != fp_to_le(&e) || c.domain != fp_to_le(&d) {
        return Err(err("challenge is for another event or domain"));
    }
    let rsk = bundle::rsk(&fp(secret, "secret")?, &d, &nonce16(alpha_nonce)?);
    let mut rng = sezs_ticket_v2::rng_from_seed(seed32(seed)?);
    Ok(consent::sign(&rsk, challenge, &mut rng).map_err(err)?.to_vec())
}

/// Printed fallback: the fixed message for this bundle's `N` and the event's door key.
#[wasm_bindgen(js_name = printedMessage)]
pub fn printed_message(event_id: &str, domain: &str, nullifier: &[u8], door_auth_pubkey: &str) -> R<Vec<u8>> {
    let n: [u8; 32] = nullifier.try_into().map_err(|_| err("nullifier must be 32 bytes"))?;
    consent::printed_message(encode::event_id_fp(event_id).map_err(err)?, encode::domain_fp(domain), &n, door_auth_pubkey.as_bytes()).map_err(err)
}

/// Printed fallback: sign the printed message (bearer: whoever holds the paper gets in once).
#[wasm_bindgen(js_name = signPrinted)]
pub fn sign_printed(secret: &[u8], event_id: &str, domain: &str, alpha_nonce: &[u8], nullifier: &[u8], door_auth_pubkey: &str, seed: &[u8]) -> R<Vec<u8>> {
    let msg = printed_message(event_id, domain, nullifier, door_auth_pubkey)?;
    let rsk = bundle::rsk(&fp(secret, "secret")?, &encode::domain_fp(domain), &nonce16(alpha_nonce)?);
    let mut rng = sezs_ticket_v2::rng_from_seed(seed32(seed)?);
    Ok(consent::sign(&rsk, &msg, &mut rng).map_err(err)?.to_vec())
}

/// RedPallas SpendAuth verify (same as the chain host).
#[wasm_bindgen(js_name = verifyConsent)]
pub fn verify_consent(rk: &[u8], message: &[u8], sig: &[u8]) -> R<bool> {
    let rk: [u8; 32] = rk.try_into().map_err(|_| err("rk must be 32 bytes"))?;
    let sig: [u8; 64] = sig.try_into().map_err(|_| err("sig must be 64 bytes"))?;
    Ok(consent::verify(&rk, message, &sig))
}
