# vote-elgamal-wasm

Browser-ready Pallas ElGamal encrypt matching Go `vote-sdk/crypto/elgamal`.

## Generator

Uses **Orchard SpendAuthG** (`elgamal.PallasGenerator()`), not the standard
Pallas generator. Required for ciphertext parity with vote-sdk chain crypto
and ZKP #2 ElGamal constraints.

## Build (wasm)

```bash
cd crates/vote-sdk/crypto/elgamal-wasm
# Node/vitest:
wasm-pack build --target nodejs --out-dir ../../../websites/dao-dao-ui/packages/utils/shieldedVote/pkg --release
# Bundler (Next/webpack):
wasm-pack build --target bundler --out-dir pkg-bundler --release
```

## Test goldens (native, no wasm)

```bash
cargo test --manifest-path crates/vote-sdk/crypto/elgamal-wasm/Cargo.toml --no-default-features
# or with wasm feature still on (default):
cargo test --manifest-path crates/vote-sdk/crypto/elgamal-wasm/Cargo.toml
```

Goldens generated from Go:

```bash
cd crates/vote-sdk
go test -run TestExportEncryptGoldens -v ./crypto/elgamal/
# → crypto/elgamal/testdata/encrypt_goldens.json
```

## API

| Rust | JS (wasm-bindgen) |
|------|-------------------|
| `encrypt_vote(ea_pk, v)` | `encryptVote(eaPk, voteValue)` |
| `encrypt_with_randomness(ea_pk, v, r)` | `encryptVoteWithRandomness(eaPk, voteValue, r)` |

Output: **64-byte** `C1 \|\| C2` compressed Pallas points.
