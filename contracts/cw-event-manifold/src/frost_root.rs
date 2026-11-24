//! Verify a session admin FROST (frost-ed25519) signature over a guest root.
//! The message is the concatenation:
//!   b"sezs-guest-root-v1" || contract_addr_bytes || epoch_le || leaf_count_le || root
use crate::ContractError;
use cosmwasm_std::{Addr, HexBinary};

pub const DOMAIN: &[u8] = b"sezs-guest-root-v1";

pub fn guest_root_message(contract: &Addr, epoch: u32, leaf_count: u32, root: &HexBinary) -> Vec<u8> {
    let mut msg = Vec::with_capacity(DOMAIN.len() + contract.as_bytes().len() + 8 + root.len());
    msg.extend_from_slice(DOMAIN);
    msg.extend_from_slice(contract.as_bytes());
    msg.extend_from_slice(&epoch.to_le_bytes());
    msg.extend_from_slice(&leaf_count.to_le_bytes());
    msg.extend_from_slice(root.as_slice());
    msg
}

pub fn require_guest_root_vk(vk: &Option<HexBinary>) -> Result<[u8; 32], ContractError> {
    let raw = vk.as_ref().ok_or(ContractError::NoGuestRootVk)?;
    let slice = raw.as_slice();
    if slice.len() != 32 {
        return Err(ContractError::BadFrostSignature);
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(slice);
    Ok(out)
}

pub fn verify_guest_root_sig(
    contract: &Addr,
    epoch: u32,
    leaf_count: u32,
    root: &HexBinary,
    vk: &Option<HexBinary>,
    signature: &HexBinary,
) -> Result<(), ContractError> {
    let vk_bytes = require_guest_root_vk(vk)?;
    let sig = signature.as_slice();
    if sig.len() != 64 {
        return Err(ContractError::BadFrostSignature);
    }
    let vk = frost_ed25519::VerifyingKey::deserialize(&vk_bytes)
        .map_err(|_| ContractError::BadFrostSignature)?;
    let parsed = frost_ed25519::Signature::deserialize(sig)
        .map_err(|_| ContractError::BadFrostSignature)?;
    let message = guest_root_message(contract, epoch, leaf_count, root);
    vk.verify(&message, &parsed)
        .map_err(|_| ContractError::BadFrostSignature)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::Addr;
    use frost_ed25519 as frost;
    use frost::keys::dkg;
    use rand::rngs::OsRng;

    fn addr() -> Addr {
        Addr::unchecked("terp1xr3rq8yvd7qplsw5yx90ftsr2zdhg4e9z60h5duusgxpv72hud3skjau0s")
    }

    fn root() -> HexBinary {
        HexBinary::from([0x45u8; 32])
    }

    fn message_with(domain: &[u8], contract: &Addr, epoch: u32, leaf_count: u32, root: &HexBinary) -> Vec<u8> {
        let mut msg = Vec::with_capacity(domain.len() + contract.as_bytes().len() + 8 + root.len());
        msg.extend_from_slice(domain);
        msg.extend_from_slice(contract.as_bytes());
        msg.extend_from_slice(&epoch.to_le_bytes());
        msg.extend_from_slice(&leaf_count.to_le_bytes());
        msg.extend_from_slice(root.as_slice());
        msg
    }

    fn dkg_set() -> (frost::keys::PublicKeyPackage, std::collections::BTreeMap<u16, frost::keys::KeyPackage>) {
        let t = 2u16;
        let n = 3u16;
        let mut r1_secrets = std::collections::BTreeMap::new();
        let mut r1_pkgs = std::collections::BTreeMap::new();
        for id in 1u16..=n {
            let ident = frost::Identifier::try_from(id).unwrap();
            let (secret, pkg) = dkg::part1(ident, n, t, OsRng).unwrap();
            r1_secrets.insert(id, secret);
            r1_pkgs.insert(id, pkg);
        }
        let mut r2_secrets = std::collections::BTreeMap::new();
        let mut r2_pkgs: std::collections::BTreeMap<u16, std::collections::BTreeMap<frost::Identifier, _>> =
            std::collections::BTreeMap::new();
        for id in 1u16..=n {
            let mut pkgs = std::collections::BTreeMap::new();
            for (jid, pkg) in &r1_pkgs {
                if *jid != id {
                    pkgs.insert(frost::Identifier::try_from(*jid).unwrap(), pkg.clone());
                }
            }
            let (secret, out) = dkg::part2(r1_secrets[&id].clone(), &pkgs).unwrap();
            r2_secrets.insert(id, secret);
            r2_pkgs.insert(id, out);
        }
        let mut key_packages = std::collections::BTreeMap::new();
        let mut pubkey = None;
        for id in 1u16..=n {
            let ident = frost::Identifier::try_from(id).unwrap();
            let mut r1 = std::collections::BTreeMap::new();
            for (jid, pkg) in &r1_pkgs {
                if *jid != id {
                    r1.insert(frost::Identifier::try_from(*jid).unwrap(), pkg.clone());
                }
            }
            let mut r2 = std::collections::BTreeMap::new();
            for (jid, outs) in &r2_pkgs {
                if *jid == id {
                    continue;
                }
                if let Some(pkg) = outs.get(&ident) {
                    r2.insert(frost::Identifier::try_from(*jid).unwrap(), pkg.clone());
                }
            }
            let (kp, pk) = dkg::part3(&r2_secrets[&id], &r1, &r2).unwrap();
            key_packages.insert(id, kp);
            pubkey = Some(pk);
        }
        (pubkey.unwrap(), key_packages)
    }

    fn sign(
        message: &[u8],
        pubkey: &frost::keys::PublicKeyPackage,
        key_packages: &std::collections::BTreeMap<u16, frost::keys::KeyPackage>,
    ) -> HexBinary {
        let ids: Vec<u16> = vec![1, 2];
        let mut commitments = std::collections::BTreeMap::new();
        let mut nonces = std::collections::BTreeMap::new();
        for id in &ids {
            let (n, c) = frost::round1::commit(key_packages[id].signing_share(), &mut OsRng);
            commitments.insert(frost::Identifier::try_from(*id).unwrap(), c);
            nonces.insert(*id, n);
        }
        let pkg = frost::SigningPackage::new(commitments.clone(), message);
        let mut shares = std::collections::BTreeMap::new();
        for id in &ids {
            let share = frost::round2::sign(&pkg, &nonces[id], &key_packages[id]).unwrap();
            shares.insert(frost::Identifier::try_from(*id).unwrap(), share);
        }
        let sig = frost::aggregate(&pkg, &shares, pubkey).unwrap();
        HexBinary::from(sig.serialize().unwrap())
    }

    #[test]
    fn current_domain_is_sezs_guest_root_v1() {
        assert_eq!(DOMAIN, b"sezs-guest-root-v1");
        let contract = addr();
        let root = root();
        let msg = guest_root_message(&contract, 1, 4, &root);
        assert!(msg.starts_with(b"sezs-guest-root-v1"));
        assert_eq!(&msg[DOMAIN.len()..DOMAIN.len() + contract.as_bytes().len()], contract.as_bytes());
        // Addr bytes are the bech32 string, not a 20-byte canonical address.
        assert!(contract.as_bytes().starts_with(b"terp1"));
        let n = msg.len();
        assert_eq!(&msg[n - 32..n], [0x45u8; 32]);
        assert_eq!(&msg[n - 36..n - 32], 4u32.to_le_bytes()); // leaf_count
        assert_eq!(&msg[n - 40..n - 36], 1u32.to_le_bytes()); // epoch

    }

    #[test]
    fn publisher_sezs_message_does_not_match_legacy_itl_domain() {
        let contract = addr();
        let root = root();
        let sezs = message_with(b"sezs-guest-root-v1", &contract, 1, 4, &root);
        let itl = message_with(b"itl-guest-root-v1", &contract, 1, 4, &root);
        let current = guest_root_message(&contract, 1, 4, &root);
        assert_eq!(sezs, current);
        assert_ne!(sezs, itl);
        // "sezs-guest-root-v1" is one byte longer than "itl-guest-root-v1",
        // so every field after the domain tag is shifted — this is the
        // mismatch against a pre-rename (itl-event-v2) wasm.
        assert_eq!(sezs.len(), itl.len() + 1);
        assert!(itl.starts_with(b"itl-guest-root-v1"));
        assert_eq!(sezs.iter().zip(itl.iter()).position(|(a, b)| a != b), Some(0));
    }

    #[test]
    fn signature_over_sezs_message_verifies_and_fails_under_itl_domain() {
        let (pubkey, keys) = dkg_set();
        let vk = HexBinary::from(pubkey.verifying_key().serialize().unwrap());
        let contract = addr();
        let root = root();
        let sezs = guest_root_message(&contract, 1, 4, &root);
        let itl = message_with(b"itl-guest-root-v1", &contract, 1, 4, &root);
        let sig = sign(&sezs, &pubkey, &keys);

        verify_guest_root_sig(&contract, 1, 4, &root, &Some(vk.clone()), &sig).unwrap();

        let vk_bytes: [u8; 32] = vk.as_slice().try_into().unwrap();
        let parsed_vk = frost::VerifyingKey::deserialize(&vk_bytes).unwrap();
        let parsed_sig = frost::Signature::deserialize(sig.as_slice()).unwrap();
        assert!(parsed_vk.verify(&sezs, &parsed_sig).is_ok());
        assert!(parsed_vk.verify(&itl, &parsed_sig).is_err());
    }
}
