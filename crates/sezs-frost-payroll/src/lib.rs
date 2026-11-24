//! Loopback FROST t-of-n helper for event payroll.
//!
//! The library exposes the same JSON `op` surface the Node ceremony uses
//! (`part1`…`verify`, `ping`) plus an in-process `run_ceremony` so the
//! one-bind SEZS server does not spawn a second process or frost inbox.
//! Never log secrets. The binary is stdin/stdout only; not a network service.
use frost::keys::dkg;
use frost::{Identifier, SigningPackage};
use frost_ed25519 as frost;
use rand::rngs::OsRng;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

fn ident(id: u16) -> Result<Identifier, String> {
    Identifier::try_from(id).map_err(|e| e.to_string())
}

fn parse_id(v: &Value) -> Result<u16, String> {
    v.get("id")
        .and_then(|x| x.as_u64())
        .ok_or_else(|| "missing id".into())
        .and_then(|n| u16::try_from(n).map_err(|_| "bad id".into()))
}

fn obj_map<'a>(v: &'a Value, key: &str) -> Result<&'a Map<String, Value>, String> {
    v.get(key)
        .and_then(|x| x.as_object())
        .ok_or_else(|| format!("missing {key}"))
}

fn to_pkg<T: serde::de::DeserializeOwned>(v: &Value) -> Result<T, String> {
    serde_json::from_value(v.clone()).map_err(|e| e.to_string())
}

fn js<T: serde::Serialize>(v: &T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

fn part1(req: &Value) -> Result<Value, String> {
    let id = parse_id(req)?;
    let t = req.get("t").and_then(|x| x.as_u64()).ok_or("missing t")? as u16;
    let n = req.get("n").and_then(|x| x.as_u64()).ok_or("missing n")? as u16;
    let identifier = ident(id)?;
    let (secret, package) = dkg::part1(identifier, n, t, OsRng).map_err(|e| e.to_string())?;
    Ok(json!({
        "ok": true,
        "id": id,
        "secret": js(&secret)?,
        "package": js(&package)?,
    }))
}

fn part2(req: &Value) -> Result<Value, String> {
    let id = parse_id(req)?;
    let _ = ident(id)?;
    let secret = to_pkg(req.get("secret").ok_or("missing secret")?)?;
    let mut packages = BTreeMap::new();
    for (k, v) in obj_map(req, "packages")? {
        let kid: u16 = k.parse().map_err(|_| "bad package id".to_string())?;
        packages.insert(ident(kid)?, to_pkg(v)?);
    }
    let (secret2, out) = dkg::part2(secret, &packages).map_err(|e| e.to_string())?;
    let n = req.get("n").and_then(|x| x.as_u64()).unwrap_or(3) as u16;
    let mut packages_out = Map::new();
    for dest in 1u16..=n {
        if let Ok(did) = ident(dest) {
            if let Some(v) = out.get(&did) {
                packages_out.insert(dest.to_string(), js(v)?);
            }
        }
    }
    Ok(json!({
        "ok": true,
        "id": id,
        "secret": js(&secret2)?,
        "packages": Value::Object(packages_out),
    }))
}

fn part3(req: &Value) -> Result<Value, String> {
    let id = parse_id(req)?;
    let _ = ident(id)?;
    let secret = to_pkg(req.get("secret").ok_or("missing secret")?)?;
    let mut r1 = BTreeMap::new();
    for (k, v) in obj_map(req, "round1")? {
        let kid: u16 = k.parse().map_err(|_| "bad round1 id".to_string())?;
        r1.insert(ident(kid)?, to_pkg(v)?);
    }
    let mut r2 = BTreeMap::new();
    for (k, v) in obj_map(req, "round2")? {
        let kid: u16 = k.parse().map_err(|_| "bad round2 id".to_string())?;
        r2.insert(ident(kid)?, to_pkg(v)?);
    }
    let (key_package, pubkey_package) = dkg::part3(&secret, &r1, &r2).map_err(|e| e.to_string())?;
    Ok(json!({
        "ok": true,
        "id": id,
        "key_package": js(&key_package)?,
        "pubkey_package": js(&pubkey_package)?,
    }))
}

fn sign1(req: &Value) -> Result<Value, String> {
    let key_package: frost::keys::KeyPackage =
        to_pkg(req.get("key_package").ok_or("missing key_package")?)?;
    let (nonces, commitments) = frost::round1::commit(key_package.signing_share(), &mut OsRng);
    Ok(json!({
        "ok": true,
        "nonces": js(&nonces)?,
        "commitments": js(&commitments)?,
    }))
}

fn sign2(req: &Value) -> Result<Value, String> {
    let key_package: frost::keys::KeyPackage =
        to_pkg(req.get("key_package").ok_or("missing key_package")?)?;
    let nonces = to_pkg(req.get("nonces").ok_or("missing nonces")?)?;
    let mut commitments = BTreeMap::new();
    for (k, v) in obj_map(req, "commitments")? {
        let kid: u16 = k.parse().map_err(|_| "bad commitment id".to_string())?;
        commitments.insert(ident(kid)?, to_pkg(v)?);
    }
    let msg = req
        .get("message")
        .and_then(|x| x.as_str())
        .ok_or("missing message")?;
    let message = hex::decode(msg).map_err(|e| e.to_string())?;
    let sign_package = SigningPackage::new(commitments, &message);
    let share =
        frost::round2::sign(&sign_package, &nonces, &key_package).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "share": js(&share)? }))
}

fn aggregate(req: &Value) -> Result<Value, String> {
    let pubkey_package: frost::keys::PublicKeyPackage =
        to_pkg(req.get("pubkey_package").ok_or("missing pubkey_package")?)?;
    let mut commitments = BTreeMap::new();
    for (k, v) in obj_map(req, "commitments")? {
        let kid: u16 = k.parse().map_err(|_| "bad commitment id".to_string())?;
        commitments.insert(ident(kid)?, to_pkg(v)?);
    }
    let mut shares = BTreeMap::new();
    for (k, v) in obj_map(req, "shares")? {
        let kid: u16 = k.parse().map_err(|_| "bad share id".to_string())?;
        shares.insert(ident(kid)?, to_pkg(v)?);
    }
    let msg = req
        .get("message")
        .and_then(|x| x.as_str())
        .ok_or("missing message")?;
    let message = hex::decode(msg).map_err(|e| e.to_string())?;
    let sign_package = SigningPackage::new(commitments, &message);
    let sig =
        frost::aggregate(&sign_package, &shares, &pubkey_package).map_err(|e| e.to_string())?;
    pubkey_package
        .verifying_key()
        .verify(&message, &sig)
        .map_err(|e| e.to_string())?;
    let sig_bytes = sig.serialize().map_err(|e| e.to_string())?;
    let vk_bytes = pubkey_package
        .verifying_key()
        .serialize()
        .map_err(|e| e.to_string())?;
    Ok(json!({
        "ok": true,
        "signature": js(&sig)?,
        "verifying_key": js(pubkey_package.verifying_key())?,
        "signature_hex": hex::encode(sig_bytes),
        "verifying_key_hex": hex::encode(vk_bytes),
    }))
}

fn export_vk(req: &Value) -> Result<Value, String> {
    let pubkey_package: frost::keys::PublicKeyPackage =
        to_pkg(req.get("pubkey_package").ok_or("missing pubkey_package")?)?;
    let vk_bytes = pubkey_package
        .verifying_key()
        .serialize()
        .map_err(|e| e.to_string())?;
    Ok(json!({
        "ok": true,
        "verifying_key_hex": hex::encode(vk_bytes),
        "verifying_key": js(pubkey_package.verifying_key())?,
    }))
}

fn verify(req: &Value) -> Result<Value, String> {
    let vk_hex = req
        .get("verifying_key_hex")
        .and_then(|x| x.as_str())
        .ok_or("missing verifying_key_hex")?;
    let sig_hex = req
        .get("signature_hex")
        .and_then(|x| x.as_str())
        .ok_or("missing signature_hex")?;
    let msg = req
        .get("message")
        .and_then(|x| x.as_str())
        .ok_or("missing message")?;
    let vk_bytes = hex::decode(vk_hex).map_err(|e| e.to_string())?;
    let sig_bytes = hex::decode(sig_hex).map_err(|e| e.to_string())?;
    let message = hex::decode(msg).map_err(|e| e.to_string())?;
    let vk = frost::VerifyingKey::deserialize(&vk_bytes).map_err(|e| e.to_string())?;
    let sig = frost::Signature::deserialize(&sig_bytes).map_err(|e| e.to_string())?;
    vk.verify(&message, &sig).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "valid": true }))
}

pub fn dispatch(req: &Value) -> Result<Value, String> {
    let op = req.get("op").and_then(|x| x.as_str()).ok_or("missing op")?;
    match op {
        "part1" => part1(req),
        "part2" => part2(req),
        "part3" => part3(req),
        "sign1" => sign1(req),
        "sign2" => sign2(req),
        "aggregate" => aggregate(req),
        "export_vk" => export_vk(req),
        "verify" => verify(req),
        "ping" => Ok(json!({ "ok": true, "service": "sezs-frost-payroll" })),
        _ => Err(format!("unknown op {op}")),
    }
}

/// Run a 2-of-3 (or `t`-of-`n`) DKG + sign ceremony in-process.
/// Same ops as the stdin helper; no relay, no network.
pub fn run_ceremony(message_hex: &str, t: u16, n: u16) -> Result<Value, String> {
    if t == 0 || n == 0 || t > n {
        return Err("bad_threshold".into());
    }
    hex::decode(message_hex).map_err(|e| e.to_string())?;
    let mut r1_secret = serde_json::Map::new();
    let mut r1_packages = serde_json::Map::new();
    for id in 1u16..=n {
        let out = part1(&json!({"id": id, "t": t, "n": n}))?;
        r1_secret.insert(id.to_string(), out["secret"].clone());
        r1_packages.insert(id.to_string(), out["package"].clone());
    }
    let mut r2_secret = serde_json::Map::new();
    let mut r2_from: BTreeMap<u16, serde_json::Map<String, Value>> = BTreeMap::new();
    for id in 1u16..=n {
        let mut packages = serde_json::Map::new();
        for (k, v) in &r1_packages {
            if k != &id.to_string() {
                packages.insert(k.clone(), v.clone());
            }
        }
        let out = part2(&json!({
            "id": id,
            "n": n,
            "secret": r1_secret[&id.to_string()],
            "packages": packages,
        }))?;
        r2_secret.insert(id.to_string(), out["secret"].clone());
        let dests = out
            .get("packages")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        r2_from.insert(id, dests);
    }
    let mut key_packages = serde_json::Map::new();
    let mut pubkey_package = Value::Null;
    for id in 1u16..=n {
        let mut r2 = serde_json::Map::new();
        for (from, dests) in &r2_from {
            if *from == id {
                continue;
            }
            if let Some(pkg) = dests.get(&id.to_string()) {
                r2.insert(from.to_string(), pkg.clone());
            }
        }
        // Node ceremony (payroll-ceremony.mjs) passes only the *other*
        // participants' round-1 packages, plus the received round-2 packages.
        let mut r1 = serde_json::Map::new();
        for (k, v) in &r1_packages {
            if k != &id.to_string() {
                r1.insert(k.clone(), v.clone());
            }
        }
        let out = part3(&json!({
            "id": id,
            "secret": r2_secret[&id.to_string()],
            "round1": r1,
            "round2": r2,
        }))?;
        key_packages.insert(id.to_string(), out["key_package"].clone());
        pubkey_package = out["pubkey_package"].clone();
    }
    let signers: Vec<u16> = (1u16..=t).collect();
    let mut nonces = serde_json::Map::new();
    let mut commitments = serde_json::Map::new();
    for id in &signers {
        let out = sign1(&json!({"key_package": key_packages[&id.to_string()]}))?;
        nonces.insert(id.to_string(), out["nonces"].clone());
        commitments.insert(id.to_string(), out["commitments"].clone());
    }
    let mut shares = serde_json::Map::new();
    for id in &signers {
        let out = sign2(&json!({
            "key_package": key_packages[&id.to_string()],
            "nonces": nonces[&id.to_string()],
            "commitments": commitments,
            "message": message_hex,
        }))?;
        shares.insert(id.to_string(), out["share"].clone());
    }
    let agg = aggregate(&json!({
        "pubkey_package": pubkey_package,
        "commitments": commitments,
        "shares": shares,
        "message": message_hex,
    }))?;
    Ok(json!({
        "ok": true,
        "sessionId": format!("local-{t}-of-{n}"),
        "signature": agg["signature"],
        "verifyingKey": agg["verifying_key"],
        "signature_hex": agg["signature_hex"],
        "verifying_key_hex": agg["verifying_key_hex"],
        "t": t,
        "n": n,
        "cipher": "in-process",
    }))
}

pub fn run_json_request(raw: &str) -> Value {
    let req: Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "error": e.to_string() }),
    };
    match dispatch(&req) {
        Ok(v) => v,
        Err(e) => json!({ "ok": false, "error": e }),
    }
}
