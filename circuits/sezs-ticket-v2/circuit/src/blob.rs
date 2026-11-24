//! zk-wasmvm store-circuit blob `[params][cs][vk][CircuitFooter]` for
//! cw-orch upload_circuit / MsgStoreCircuit (`{id}_vk.bin` is the combined blob).
//! `.params` and `.vkbody` remain available as the split layout (cs||vk||footer).
//! Same packer as headstash and itl-zk-cw-orch.

use crate::{keys, NUM_PUBLIC, K};
use sha2::{Digest, Sha256};
use zk_cosmwasm::{circuits::CircuitType, curves::CurveType, CircuitFooter, COSMWASM_FOOTER_LENGTH};

pub struct StoreCircuit {
    pub params: Vec<u8>,
    /// cs || vk || footer (the split vk-body file; the combined blob is `blob`).
    pub vk_body: Vec<u8>,
    /// params ‖ cs ‖ vk ‖ footer.
    pub blob: Vec<u8>,
    pub footer: CircuitFooter,
}

fn sha(b: &[u8]) -> [u8; 32] {
    Sha256::digest(b).into()
}

pub fn build() -> Result<StoreCircuit, String> {
    let (params, cs, vk) = keys::serialize(keys::get())?;
    let mut vk_cs = Vec::with_capacity(cs.len() + vk.len());
    vk_cs.extend_from_slice(&cs);
    vk_cs.extend_from_slice(&vk);
    let footer = CircuitFooter::new(
        CircuitType::Plonkish,
        CurveType::Pasta,
        K as u8,
        NUM_PUBLIC as u8,
        params.len() as u32,
        cs.len() as u32,
        vk.len() as u32,
        sha(&params),
        sha(&vk_cs),
    );
    let fb = footer.to_bytes();
    assert_eq!(fb.len(), COSMWASM_FOOTER_LENGTH);
    let mut vk_body = vk_cs.clone();
    vk_body.extend_from_slice(&fb);
    let mut blob = params.clone();
    blob.extend_from_slice(&vk_body);
    // Host-identical decode: this is what zk-wasmvm loads for the zkid.
    zk_cosmwasm::AnyVerifyingKey::from_bytes(&blob).map_err(|e| format!("AnyVerifyingKey::from_bytes: {e}"))?;
    Ok(StoreCircuit { params, vk_body, blob, footer })
}

/// Verify through the exact zk-cosmwasm path the chain host runs
/// (`AnyInstance::try_from_bytes(curve_id, instances)` + `AnyVerifyingKey::verify`).
pub fn host_verify(blob: &[u8], proof: &[u8], instances: &[u8]) -> Result<(), String> {
    let vk = zk_cosmwasm::AnyVerifyingKey::from_bytes(blob).map_err(|e| e.to_string())?;
    let i = zk_cosmwasm::AnyInstance::try_from_bytes(vk.curve_id() as u32, instances).map_err(|e| e.to_string())?;
    vk.verify(&zk_cosmwasm::Proof::new(proof.to_vec()), &[i]).map_err(|e| e.to_string())
}
