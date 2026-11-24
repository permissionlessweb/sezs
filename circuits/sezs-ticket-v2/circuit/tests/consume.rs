use ff::Field;
use halo2_proofs::dev::MockProver;
use sezs_ticket_v2::{
    bundle::{self, Bundle, ProveInput},
    circuit::{rk_bytes_from_xy, rk_compressed, xy, Witness},
    commitment, consent,
    encode::{domain_fp, event_id_fp, fp_to_le, sku_fp},
    nullifier, os_rng,
    tree::{root_from_path, GuestTree},
    DEPTH, K, NULLIFIER, ROOT,
};
use pasta_curves::pallas;

fn setup() -> (GuestTree, pallas::Base, pallas::Base, pallas::Base, pallas::Base, usize) {
    let mut rng = os_rng();
    let (e, d, s) = (event_id_fp("speakez-sessions").unwrap(), domain_fp("http://127.0.0.1:3051"), sku_fp("ga").unwrap());
    let secret = pallas::Base::random(&mut rng);
    let mut t = GuestTree::new();
    for i in 0..13 {
        t.append(if i == 6 { commitment(secret, s, e) } else { pallas::Base::random(&mut rng) }).unwrap();
    }
    (t, secret, s, e, d, 6)
}

#[test]
fn mock_prover_accepts_and_rejects() {
    let (t, secret, sku, e, d, idx) = setup();
    let path = t.path(idx).unwrap();
    let w = Witness::<DEPTH> { secret, sku, event_id: e, domain: d, siblings: path.siblings, bits: path.bits, alpha: pallas::Scalar::random(&mut os_rng()) };
    let pi = w.public_inputs();
    assert_eq!(pi[ROOT], t.root());
    assert_eq!(pi[NULLIFIER], nullifier(secret, e));
    MockProver::run(K, &w.circuit(), vec![pi.to_vec()]).unwrap().assert_satisfied();
    for row in 0..6 {
        let mut bad = pi;
        bad[row] += pallas::Base::ONE;
        assert!(MockProver::run(K, &w.circuit(), vec![bad.to_vec()]).unwrap().verify().is_err(), "row {row} must bind");
    }
    // wrong sku → different leaf → root mismatch
    let w2 = Witness::<DEPTH> { sku: sku + pallas::Base::ONE, ..w.clone() };
    assert!(MockProver::run(K, &w2.circuit(), vec![pi.to_vec()]).unwrap().verify().is_err());
}

#[test]
fn tree_paths_and_rk_encoding() {
    let (t, ..) = setup();
    for i in 0..t.len() {
        assert_eq!(root_from_path(t.leaves()[i], &t.path(i).unwrap()), t.root());
    }
    assert_ne!(GuestTree::new().root(), t.root());
    let rk = sezs_ticket_v2::circuit::rk_point(&pallas::Scalar::random(&mut os_rng()));
    let (x, y) = xy(&rk);
    assert_eq!(rk_bytes_from_xy(&fp_to_le(&x), &fp_to_le(&y)), rk_compressed(&rk));
}

#[test]
fn prove_verify_sign_roundtrip() {
    let (t, secret, sku, e, d, idx) = setup();
    let mut rng = os_rng();
    let nonce = rand_nonce(&mut rng);
    let p = bundle::prove(&ProveInput { secret, sku, event_id: e, domain: d, path: t.path(idx).unwrap(), alpha_nonce: nonce }, &mut rng).unwrap();
    assert_eq!(p.bundle.proof.len(), 4192);
    assert_eq!(bundle::rsk(&secret, &d, &nonce), p.rsk, "rsk re-derives from secret + public nonce");
    let b = Bundle::from_bytes(&p.bundle.to_bytes()).unwrap();
    assert_eq!(b, p.bundle);
    bundle::verify(&b, e, d).unwrap();
    assert!(bundle::verify(&b, e, domain_fp("https://evil.example")).is_err(), "domain binds");
    let ch = consent::LiveChallenge::new(e, d, [7; 16], 1_700_000_000, "terp1usher").to_bytes();
    assert_eq!(consent::LiveChallenge::from_bytes(&ch).unwrap().usher, "terp1usher");
    let sig = consent::sign(&p.rsk, &ch, &mut rng).unwrap();
    assert!(consent::verify(&b.rk(), &ch, &sig));
    assert!(!consent::verify(&b.rk(), b"other", &sig));
    // A second proof for the same ticket: same N, fresh rk (unlinkable consent key).
    let p2 = bundle::prove(&ProveInput { secret, sku, event_id: e, domain: d, path: t.path(idx).unwrap(), alpha_nonce: rand_nonce(&mut rng) }, &mut rng).unwrap();
    assert_eq!(p2.bundle.nullifier, b.nullifier);
    assert_ne!(p2.bundle.rk(), b.rk());
}

#[test]
fn encodings() {
    assert!(event_id_fp("").is_err());
    assert!(event_id_fp(&"x".repeat(32)).is_err());
    assert_eq!(fp_to_le(&event_id_fp("ga").unwrap())[..2], *b"ga");
    assert_ne!(domain_fp("http://127.0.0.1:3051"), domain_fp("http://127.0.0.1:3052"));
}

#[cfg(feature = "keygen")]
mod host {
    use super::*;
    use sezs_ticket_v2_verify::{verify_consume, Consent, ConsumeInput, Ctx, DoorConfig, VerifyError, ZkHost};

    /// The chain host path, natively: zk-cosmwasm verify + reddsa SpendAuth.
    struct NativeHost(Vec<u8>);
    impl ZkHost for NativeHost {
        fn proof_instance_verify(&self, _z: u64, proof: &[u8], i: &[u8]) -> Result<bool, String> {
            Ok(sezs_ticket_v2::blob::host_verify(&self.0, proof, i).is_ok())
        }
        fn redpallas_spendauth_verify(&self, m: &[u8], s: &[u8], rk: &[u8]) -> Result<bool, String> {
            Ok(consent::verify(rk.try_into().unwrap(), m, s.try_into().unwrap()))
        }
    }

    #[test]
    fn contract_module_accepts_real_bundle() {
        let (t, secret, sku, e, d, idx) = setup();
        let mut rng = os_rng();
        let p = bundle::prove(&ProveInput { secret, sku, event_id: e, domain: d, path: t.path(idx).unwrap(), alpha_nonce: rand_nonce(&mut rng) }, &mut rng).unwrap();
        let host = NativeHost(sezs_ticket_v2::blob::build().unwrap().blob);
        let ch = consent::LiveChallenge::new(e, d, [1; 16], 1000, "terp1usher").to_bytes();
        let sig = consent::sign(&p.rsk, &ch, &mut rng).unwrap();
        let cfg = DoorConfig { zkid: 1, event_id_fp: fp_to_le(&e), domain_fp: fp_to_le(&d), door_auth_pubkey: b"door", challenge_ttl_s: 600 };
        let b = &p.bundle;
        let input = |c| ConsumeInput { proof: &b.proof, root: b.root, nullifier: b.nullifier, rk_x: b.rk_x, rk_y: b.rk_y, consent: c };
        verify_consume(&host, &cfg, &input(Consent::Live { challenge: &ch, sig: &sig }), Ctx { sender: "terp1usher", now_s: 1100 }).unwrap();
        let pm = consent::printed_message(e, d, &b.nullifier, b"door").unwrap();
        assert_eq!(pm, sezs_ticket_v2_verify::printed_message(&cfg.event_id_fp, &cfg.domain_fp, &b.nullifier, b"door"));
        let ps = consent::sign(&p.rsk, &pm, &mut rng).unwrap();
        verify_consume(&host, &cfg, &input(Consent::Printed { sig: &ps }), Ctx { sender: "x", now_s: 0 }).unwrap();
        let mut other = cfg.clone();
        other.domain_fp = fp_to_le(&domain_fp("https://evil.example"));
        let ch2 = consent::LiveChallenge::new(e, domain_fp("https://evil.example"), [1; 16], 1000, "terp1usher").to_bytes();
        let sig2 = consent::sign(&p.rsk, &ch2, &mut rng).unwrap();
        assert_eq!(
            verify_consume(&host, &other, &input(Consent::Live { challenge: &ch2, sig: &sig2 }), Ctx { sender: "terp1usher", now_s: 1000 }),
            Err(VerifyError::InvalidProof)
        );
    }
}

fn rand_nonce<R: rand_core::Rng>(rng: &mut R) -> [u8; 16] {
    let mut n = [0u8; 16];
    rng.fill_bytes(&mut n);
    n
}
