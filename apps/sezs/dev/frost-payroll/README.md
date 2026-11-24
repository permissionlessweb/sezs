# sezs-frost-payroll (moved)

The FROST DKG/sign helper now lives at `crates/sezs-frost-payroll` in the
crates workspace (library + stdin/stdout binary). This directory is a
pointer so older docs do not go stale.

Build:

```
cargo build -p sezs-frost-payroll --release --manifest-path crates/Cargo.toml
```

The binary is `crates/target/release/sezs-frost-payroll`. Node ceremony
code looks there first, then honors `SEZS_FROST_PAYROLL_BIN`.
