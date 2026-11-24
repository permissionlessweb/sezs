use sezs_circuit_orch::{prepare_artifacts, validate_store_circuit_blob, vk_path, CIRCUIT_ID, FOOTER_LEN};
use sezs_orch::{
    networks::{assert_deploy_allowed, NetworkChoice},
    seed::LanternNight,
};

#[test]
fn local_network_is_allowed() {
    assert_deploy_allowed(NetworkChoice::Local).unwrap();
}

#[test]
fn footer_blob_is_present_and_valid() {
    let path = vk_path();
    if !path.is_file() {
        eprintln!("skip: {} missing (run `just circuits`)", path.display());
        return;
    }
    let blob = std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let footer = validate_store_circuit_blob(&blob).expect("footer");
    assert!(blob.len() > FOOTER_LEN);
    assert_eq!(footer.k, 11);
    assert_eq!(footer.i, 6);
}

#[test]
fn prepare_artifacts_is_the_uploadable_blob() {
    // Keygen is optional and slow; default unit tests skip when the blob is absent.
    if !vk_path().is_file() {
        eprintln!("skip: {} missing (run `just circuits`)", vk_path().display());
        return;
    }
    let (path, footer) = prepare_artifacts().expect("prepare");
    assert!(path.ends_with(format!("{CIRCUIT_ID}_vk.bin")));
    assert_eq!(footer.k, 11);
    assert_eq!(footer.i, 6);
}

#[test]
fn lantern_night_seed_is_ready_for_instantiate() {
    let ev = LanternNight::default();
    let msg = ev.instantiate_msg(
        "terp1curator".into(),
        "terp1coords".into(),
        Some("terp1ushers".into()),
        Some("terp1service".into()),
        None,
        None,
        None,
    );
    assert!(msg["name"].as_str().unwrap().contains("Lantern Night"));
    assert_eq!(msg["timezone"], "Africa/Dakar");
}

// Daemon `upload_circuit()` is covered by `just deploy-local` against the
// walkthrough terpd. The fork implements `ZkTxHandler` only for
// `DaemonBase`, not Mock, so a live store-circuit cannot run in unit tests.
