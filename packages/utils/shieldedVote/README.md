# shieldedVote — browser ElGamal encrypt (vote-sdk parity)

Client-side encrypt under election authority `ea_pk` for privacy-preserving cast.

## FE import

```ts
import {
  encryptVote,
  CIPHERTEXT_SIZE,
  PUBLIC_KEY_SIZE,
} from '@dao-dao/utils/shieldedVote'

// eaPk: 32-byte compressed Pallas from round query
const ciphertext = await encryptVote(eaPk, voteValue) // Uint8Array length 64
// Put ciphertext on wire as enc_share — NEVER send voteValue to a helper server
```

Package root export: `packages/utils` re-exports `./shieldedVote`.

## Rebuild wasm

```bash
cd crates/vote-sdk/crypto/elgamal-wasm
wasm-pack build --target nodejs \
  --out-dir ../../../../websites/dao-dao-ui/packages/utils/shieldedVote/pkg \
  --release
```

For webpack/Next bundler target:

```bash
wasm-pack build --target bundler --out-dir pkg-bundler --release
```

## Tests

```bash
# Rust goldens (native)
cargo test --manifest-path crates/vote-sdk/crypto/elgamal-wasm/Cargo.toml

# TS + wasm goldens
cd websites/dao-dao-ui/packages/utils
pnpm exec vitest run shieldedVote/encryptVote.test.ts
```

## Privacy

- Product path: `encryptVote(eaPk, voteValue)` in browser only
- Tests may pass fixed `r` for golden match
- See `docs/research/STATUS-V-UI-0-WIRE-FORMAT-2026-08-05.md`
