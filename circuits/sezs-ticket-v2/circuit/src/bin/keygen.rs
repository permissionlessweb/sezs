//! `sezs-v2-keygen <out_dir>` → `sezs_consume_v2.params`, `sezs_consume_v2.vkbody`, `sezs_consume_v2_vk.bin`.
use std::time::Instant;

fn main() {
    let out = std::path::PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| "artifacts".into()));
    std::fs::create_dir_all(&out).unwrap();
    let t = Instant::now();
    let sc = sezs_ticket_v2::blob::build().unwrap_or_else(|e| {
        eprintln!("keygen: {e}");
        std::process::exit(1)
    });
    std::fs::write(out.join("sezs_consume_v2.params"), &sc.params).unwrap();
    std::fs::write(out.join("sezs_consume_v2.vkbody"), &sc.vk_body).unwrap();
    std::fs::write(out.join("sezs_consume_v2_vk.bin"), &sc.blob).unwrap();
    let f = &sc.footer;
    println!(
        "keygen_ms={} k={} i={} param_len={} cs_len={} vk_len={} blob={} param_key={} vk_key={}",
        t.elapsed().as_millis(),
        f.k,
        f.i,
        f.param_len,
        f.cs_len,
        f.vk_len,
        sc.blob.len(),
        f.param_filename(),
        f.vk_filename()
    );
}
