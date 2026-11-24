//! Deterministic params + keys. `Params::new(K)` and keygen are deterministic, so
//! the browser, the backend and the stored on-chain circuit all derive the same VK.

use crate::{Circuit, K};
use halo2_proofs::{
    plonk::{self, ProvingKey, VerifyingKey},
    poly::commitment::Params,
};
use pasta_curves::vesta;
use std::sync::OnceLock;

pub struct Keys {
    pub params: Params<vesta::Affine>,
    pub pk: ProvingKey<vesta::Affine>,
}

impl Keys {
    pub fn vk(&self) -> &VerifyingKey<vesta::Affine> {
        self.pk.get_vk()
    }
}

pub fn generate() -> Result<Keys, String> {
    let params = Params::<vesta::Affine>::new(K);
    let empty = Circuit::empty();
    let vk = plonk::keygen_vk(&params, &empty).map_err(|e| format!("keygen_vk: {e:?}"))?;
    let pk = plonk::keygen_pk(&params, vk, &empty).map_err(|e| format!("keygen_pk: {e:?}"))?;
    Ok(Keys { params, pk })
}

/// Process-wide keys, generated once.
pub fn get() -> &'static Keys {
    static KEYS: OnceLock<Keys> = OnceLock::new();
    KEYS.get_or_init(|| generate().expect("sezs_consume_v2 keygen"))
}

/// Raw serialisations used by the store-circuit blob: `(params, cs, vk)`.
pub fn serialize(keys: &Keys) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), String> {
    let mut p = Vec::new();
    keys.params.write(&mut p).map_err(|e| format!("params.write: {e}"))?;
    let mut cs = Vec::new();
    keys.vk().cs().write(&mut cs).map_err(|e| format!("cs.write: {e}"))?;
    let mut vk = Vec::new();
    keys.vk().write(&mut vk).map_err(|e| format!("vk.write: {e}"))?;
    Ok((p, cs, vk))
}
