# SEZS usher BLE helper (moved)

The first Rust outpost lives at `crates/sezs-outpost`. It speaks the
sezs-0020 messages and the sezs-0021 loopback HTTP paths (including the
legacy `/v1/*` helper surface on `127.0.0.1:3061`).

This Node helper is kept only as a reference. Prefer:

```
cargo run -p sezs-outpost --manifest-path crates/Cargo.toml
```

Bind remains loopback-only (`SEZS_BLE_HELPER_PORT` or `SEZS_OUTPOST_PORT`,
default 3061). Tests use a simulated transport; no BLE radio is required.
