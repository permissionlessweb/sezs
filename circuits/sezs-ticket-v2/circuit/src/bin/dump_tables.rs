//! Re-search the SpendAuthG fixed-base tables (~100 s) and compare with the embedded copy.
fn main() {
    let t = std::time::Instant::now();
    let v = sezs_ticket_v2::tables::search();
    let same = v == sezs_ticket_v2::tables::embedded();
    if let Some(p) = std::env::args().nth(1) {
        std::fs::write(&p, &v).unwrap();
    }
    println!("tables_bytes={} search_ms={} matches_embedded={same}", v.len(), t.elapsed().as_millis());
    if !same {
        std::process::exit(1);
    }
}
