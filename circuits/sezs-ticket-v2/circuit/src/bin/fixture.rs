//! Lab fixture: build a guest tree with a random holder secret, prove, and sign
//! live + printed consent. The secret is generated in-process and never written out.
//!
//! `sezs-v2-fixture key=value ...`
//!   event=speakez-sessions sku=ga domain=http://127.0.0.1:3051
//!   usher=<bech32 usher addr> door=<door_auth_pubkey string> issued_at=<unix s>
//!   leaves=37 index=23 out=fixture.json
use ff::Field;
use sezs_ticket_v2::{
    bundle::{self, ProveInput},
    commitment, consent,
    encode::{domain_fp, event_id_fp, sku_fp, to_hex},
    os_rng, GuestTree,
};
use pasta_curves::pallas;
use std::{collections::HashMap, time::Instant};

fn main() {
    let a: HashMap<String, String> = std::env::args()
        .skip(1)
        .filter_map(|s| s.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
        .collect();
    let g = |k: &str, d: &str| a.get(k).cloned().unwrap_or_else(|| d.to_string());
    let event = g("event", "speakez-sessions");
    let sku = g("sku", "ga");
    let domain = g("domain", "http://127.0.0.1:3051");
    let usher = g("usher", "terp1usher");
    let door = g("door", "lab-door-auth");
    let issued_at: u64 = g("issued_at", "0").parse().unwrap();
    let n_leaves: usize = g("leaves", "37").parse().unwrap();
    let index: usize = g("index", "23").parse().unwrap();
    let out = g("out", "fixture.json");

    let (e, d, s) = (event_id_fp(&event).unwrap(), domain_fp(&domain), sku_fp(&sku).unwrap());
    let mut rng = os_rng();
    let secret = pallas::Base::random(&mut rng);
    let c = commitment(secret, s, e);
    let mut tree = GuestTree::new();
    for i in 0..n_leaves {
        tree.append(if i == index { c } else { pallas::Base::random(&mut rng) }).unwrap();
    }
    let path = tree.path(index).unwrap();

    let t = Instant::now();
    sezs_ticket_v2::keys::get();
    let keygen_ms = t.elapsed().as_millis();
    let t = Instant::now();
    let proven = bundle::prove(&ProveInput { secret, sku: s, event_id: e, domain: d, path, alpha_nonce: rand_nonce(&mut rng) }, &mut rng).unwrap();
    let prove_ms = t.elapsed().as_millis();
    let t = Instant::now();
    bundle::verify(&proven.bundle, e, d).unwrap();
    let verify_ms = t.elapsed().as_millis();
    assert_eq!(proven.bundle.root, sezs_ticket_v2::fp_to_le(&tree.root()));

    let mut nonce = [0u8; 16];
    rand_core::Rng::fill_bytes(&mut rng, &mut nonce);
    let ch = consent::LiveChallenge::new(e, d, nonce, issued_at, &usher).to_bytes();
    let live_sig = consent::sign(&proven.rsk, &ch, &mut rng).unwrap();
    let pmsg = consent::printed_message(e, d, &proven.bundle.nullifier, door.as_bytes()).unwrap();
    let print_sig = consent::sign(&proven.rsk, &pmsg, &mut rng).unwrap();
    let rk = proven.bundle.rk();
    assert!(consent::verify(&rk, &ch, &live_sig));
    assert!(consent::verify(&rk, &pmsg, &print_sig));
    let b = &proven.bundle;
    let inst = b.instance(e, d).unwrap();
    let leaves: Vec<String> = tree.leaves().iter().map(|x| format!("\"{}\"", to_hex(&sezs_ticket_v2::fp_to_le(x)))).collect();
    let json = format!(
        "{{\n \"event\": \"{event}\", \"sku\": \"{sku}\", \"domain\": \"{domain}\", \"usher\": \"{usher}\", \"door\": \"{door}\",\n \"event_id_fp\": \"{}\", \"domain_fp\": \"{}\",\n \"leaf_count\": {}, \"root\": \"{}\", \"nullifier\": \"{}\", \"rk_x\": \"{}\", \"rk_y\": \"{}\", \"rk\": \"{}\",\n \"proof\": \"{}\", \"instance\": \"{}\", \"bundle\": \"{}\",\n \"challenge\": \"{}\", \"live_sig\": \"{}\", \"print_msg\": \"{}\", \"print_sig\": \"{}\",\n \"leaves\": [{}],\n \"keygen_ms\": {keygen_ms}, \"prove_ms\": {prove_ms}, \"verify_ms\": {verify_ms}, \"proof_bytes\": {}, \"bundle_bytes\": {}\n}}\n",
        to_hex(&sezs_ticket_v2::fp_to_le(&e)),
        to_hex(&sezs_ticket_v2::fp_to_le(&d)),
        tree.len(),
        to_hex(&b.root),
        to_hex(&b.nullifier),
        to_hex(&b.rk_x),
        to_hex(&b.rk_y),
        to_hex(&rk),
        to_hex(&b.proof),
        to_hex(&inst),
        to_hex(&b.to_bytes()),
        to_hex(&ch),
        to_hex(&live_sig),
        to_hex(&pmsg),
        to_hex(&print_sig),
        leaves.join(","),
        b.proof.len(),
        b.to_bytes().len()
    );
    std::fs::write(&out, json).unwrap();
    #[cfg(feature = "keygen")]
    {
        let sc = sezs_ticket_v2::blob::build().unwrap();
        let t = Instant::now();
        sezs_ticket_v2::blob::host_verify(&sc.blob, &b.proof, &inst).unwrap();
        println!("zk_cosmwasm_host_verify_ok ms={}", t.elapsed().as_millis());
    }
    println!("fixture {out} keygen_ms={keygen_ms} prove_ms={prove_ms} verify_ms={verify_ms} proof_bytes={} bundle_bytes={}", b.proof.len(), b.to_bytes().len());
}

fn rand_nonce<R: rand_core::Rng>(rng: &mut R) -> [u8; 16] {
    let mut n = [0u8; 16];
    rng.fill_bytes(&mut n);
    n
}
