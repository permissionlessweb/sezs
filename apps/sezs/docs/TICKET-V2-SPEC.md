# Speakez tickets v2: unlinkable check-in with a pre-made Halo2 proof

Date: 14 November 2026 (Africa/Dakar, UTC+0).
Status: specification plus a measured spike. Nothing here is deployed, and no app code changed in this pass.
Decisions this builds on (user, t20u):
- Take the Valar "Proof-2" route, not blind tokens.
- No separate event chain. Verify on Terp **testnet** through zk-wasmvm.
- The payment service builds and publishes a simple Merkle root of the commitments `C`.
- The backend seeing `C` in incoming memos is accepted.
- Demo size is 15–300 people.
- The proof is made **before** reaching the door and carried in the QR, animated if it is too big.
- No ETH. Only ushers submit.

Companions: `VOTE-SDK-TICKETS-ASSESSMENT.md`, `DOOR-PRIVACY-DECISION.md` (v1, superseded the door by this doc), `BACKEND-ROLE.md`, `TICKET-PROOF-DESIGN.md`, `EVENT-MANIFOLD-API.md`.

---

## 0. Summary

- **The verifier exists and fits.** Terp's zk-wasmvm exposes `deps.api.proof_instance_verify(zkid, proof, instances)`. It is Halo2 **IPA over Pasta**, using `Params<vesta::Affine>` for circuits over the Pallas base field, with a Blake2b transcript. The host also has `redpallas_spendauth_verify` and `poseidon_hash_pallas`. Our circuit and the RedPallas consent signature can both be checked inside a CosmWasm contract (§1).
- **I could not confirm it is live on the public testnet today.** Every documented testnet endpoint returned an nginx 404 on 14 Nov 2026 (§1.5).
- **Spike (real numbers, §8):**
  - Proof size: **4,192 bytes** both tree depth 8 and depth 10 (K=11).
  - Prove time, Apple M1 Pro: native multicore **~0.33–0.41 s**; native single-thread **~1.5 s**; **WASM single-thread (Node 24 WASI) ~6.0 s**.
  - Verify time: 5–12 ms native multicore, ~29 ms native single-thread, ~112 ms WASM.
  - The QR bundle is 4,448 bytes, which is **more than the 2,953-byte single-QR limit**, so it needs animated frames (or several printed codes).
- **Consent without a correlator.**
  - The proof exposes a re-randomised key `rk = [ask + alpha]·SpendAuthG`, where `ask` is derived inside the circuit from the ticket secret.
  - At the door the holder signs the usher's live challenge with RedPallas under `rk`. That takes milliseconds, so the slow proof can be made ahead of time and the live binding is still fresh.
  - The contract verifies both the proof and the signature on-chain.
  - The spike confirmed the circuit's `rk` matches a stock `reddsa::orchard::SpendAuth` key and signature.

---

## 1. Terp testnet zk-wasmvm verify API (findings)

The CosmWasm fork used here is permissionlessweb/cosmwasm at `adace180be362e03c5aabed4b705c37c7f633d94` (release 4.1.0).

### 1.1 Contract-side API
- `crates/cosmwasm/packages/std/src/traits.rs`, `Api::proof_instance_verify(&self, zkid: u64, proof: &[u8], i: &[u8]) -> Result<bool, VerificationError>`. The verifying key is looked up from x/wasm by `zkid`.
  - `proof_instance_batch_verify(zkids, proofs, instances)` also exists, most 32 items per call (`vm/src/imports.rsMAX_COUNT_PROOF_INSTANCE_BATCH`).
- The wasm import is `proof_instance_verify` (`std/src/exports/imports.rs`). The host side is `do_proof_instance_verify` (`vm/src/imports.rs` ~L1410).
  - Instances are routed by the circuit footer's `curve_id`.
  - The instance count must equal footer `i` (check H-05).
  - A cryptographic reject comes back as `Ok(false)`; a format error is a VM error.
- Instance encoding, from existing use in `crates/cw-ave/contracts/cw-ave/src/zk.rs`: concatenated **32-byte little-endian Pasta Fp limbs**.
- Other host functions in the same fork (`std/src/traits.rs` ~L400–470), compiled into libwasmvm by default (`x/wasm/wasmvm/libwasmvm/Cargo.toml` features `zk, hash-blake, hash-poseidon, redpallas`):
  - `redpallas_spendauth_verify(message, signature, public_key)`
  - `poseidon_hash_pallas(inputs)`: the standard `P128Pow5T3`, ConstantLength, n in 1..=16.

### 1.2 Proof systems supported
`crates/cosmwasm/packages/zk/src/curves.rs`, `CurveType`:

| ID | What |
| --- | --- |
| 0 | `Pasta`: generic Plonkish / Halo2 IPA, `vesta::Affine` params. Used by `curves/vesta.rs`. |
| 1–3 | Valar vote-sdk circuits (delegation, vote commitment, share reveal), `curves/vote.rs` |
| 4 | BN254 Groth16 (feature-gated) |
| 5 | Stwo / M31 |
| … | Halo2-axiom KZG (BN256, feature `halo2-kzg`), and Flock |

Notes:
- The prover type is in the footer: `CircuitType` Plonkish=0, Groth16=1, Stwo=2, Flock=3 (`zk/src/circuits.rs`).
- The generic Pasta path stores a **serialized ConstraintSystem** together with the VK (the "V2 CS-inclusive" footer, `zk/src/footer.rs`, 80-byte footer). The host rebuilds it through `DynamicCircuit`, which takes "gates and lookups from the CS" (`zk/src/circuits.rs` ~L535).
- So a custom circuit with lookups (ours) is in scope **if** it is serialized with the fork's halo2 (`zakura-halo2-proofs`, `crates/zakura-common/crates/halo2_proofs`, patched in x/wasm/wasmvm/libwasmvm/Cargo.toml` L38–80).
- **Not yet verified:** that a proof from crates.io `halo2_proofs 0.3.5` (the spike) verifies against a VK serialized by the fork. `curves/vote.rs` says the vote-sdk's crates.io halo2 0.3 "shares the same byte-level serialization format" as the fork. Phase 0 tests this.

### 1.3 VK registration flow (x/wasm Go side)
- Messages, from `x/wasm/types/tx.pb.go` and `x/wasm/keeper/msg_server.go`:
  - `/cosmwasm.wasm.v1.MsgStoreVkParam`: reusable params for a given `K`.
  - `/cosmwasm.wasm.v1.MsgStoreCircuit`: a cs+vk+footer body that references a stored param key.
  - `/cosmwasm.wasm.v1.MsgStoreFullCircuit`: params and body in one message; returns `zk_id` and checksums.
  - `MsgPinCircuits` / `MsgUnpinCircuits`, `MsgPayCircuitDeposit` (`proto/cosmwasm/wasm/v1/circuit_deposit.proto`).
  - `MsgAdd/RemoveCircuitUploadParamsAddresses`.
- Queries: `QueryCircuitInfo`, `QueryCircuit`, `QueryPinnedCircuits`.
- Upload permission is the governance param `circuit_upload_access`. The **source default** is `AllowEverybody` (`x/wasm/types/params.go` L93). The live testnet value is unknown.
- The old `MsgStoreCodeWithCircuit` is commented out in `msg_server.go` (L95–117). Use `MsgStoreFullCircuit`, then store the zkid in the contract config, as cw-ave already does (`state.rs` "0 = unset (fail closed)").

### 1.4 Gas (from source)
- Units per verify = `1 + max(1, ceil(proof/1024)) + ceil(instances/32)` (`vm/src/imports.rs` L1288).
- Our proof is 4,192 B (5 units) and our instances are 6 × 32 B (6 units), so 12 units.
- Cost is `halo2_proof_instance_verify_cost` = base 2,700 µs + 200 µs per unit, in VM gas (`GAS_PER_US = 1_000_000`, `vm/src/environment.rs` L82, L132). That is about 5.1 × 10⁹ VM gas.
- The conversion to SDK gas depends on Terp's wasm gas multiplier, which **I didn't verify**. At the stock wasmd 140,000 it would be about 36k SDK gas.

### 1.5 Is it live on testnet?
- Docs claim it is: `terp-core/docs/artifacts-to-organize-into-brain-maps/old-zcash-grant/zcash/blog-post-drafts.md` says "Deployed on our public testnet". Chain id `120u-1` appears in `cmd/terpd/cmd/bootstrap.go` and in the `docker/localterp` scripts.
- Read-only checks on 14 Nov 2026 (about 21:55–22:20 UTC+0), from both the box and the laptop:
  - Every one of these returned **HTTP 404 (nginx)**: `https://testnet-rpc.terp.network/status`, `https://rpc-testnet.terp.network/status`, `https://testnet-api.terp.network/cosmos/base/tendermint/v1beta1/node_info`, `https://api-testnet.terp.network/...`, `https://testnet-faucet.terp.network/status`.
  - The chain-registry `terpnettestnet2` (`90u-2`, itrocket) did not answer.
- **So it is not confirmed live.** Until you point me a working testnet endpoint, plan on a **local** `terpd` built from this terp-core: `docker/localterp`, or the ict-rs Docker harness already used by `sezs_consume_e2e` (`the build machine-ro/crates/ict-rs/ict-rs-cw-orch/examples/sezs_consume_e2e.rs`).

---

## 2. Circuit `sezs_consume_v2`

### 2.1 Statement
- Private inputs: `secret`, `sku`, Merkle `siblings[D]` and `bits[D]`, and `alpha` (a Pallas scalar).
- Public inputs, in this order: `[root, N, event_id, domain, rk_x, rk_y]`.

`
C   = Poseidon(secret, sku, event_id)          // leaf shape unchanged
root = MerkleRoot_D(C, siblings, bits)          // parent = Poseidon(left, right)
N   = Poseidon(secret, event_id)               // door nullifier, unchanged
ask = Poseidon(TAG_AK, secret, domain)         // never leaves the holder
rk  = [ask]·SpendAuthG + [alpha]·SpendAuthG     // base-field fixed mul + full-width fixed mul + complete add
`

- `SpendAuthG` is the Orchard generator `hash_to_curve("z.cash:Orchard")(b"G")`, so `rk` is a standard RedPallas SpendAuth verification key. The signing key is `rsk = ask + alpha`.
- `event_id` and `domain` are public, so a proof for one event or domain can't be used another.
- `sku` stays **private**, so the anonymity set isn't split by tier.
- Nothing about `ask` or `rk` is ever sent to the backend.

### 2.2 Gadgets and parameters
- Spike: `halo2_gadgets 0.5.0Pow5Chip<P128Pow5T3>`, `EccChip` with `CircuitVersion::AnchoredBase`, a custom one-row Merkle swap gate, and a 10-bit lookup table. **K = 11.**
  - `AnchoredBase` is the fixed version after the Orchard incomplete-addition bug. The legacy `InsecureUnanchoredBase` must never be used for proving.
- Fixed-base tables (the windowed z/u values) take about 101 s to search for natively. They must ship as precomputed constants (28,256 bytes in the spike), the way Orchard does.
- **Tree depth: 10** (1,024 leaves). Depth 8 and depth 10 cost the same in the spike: same K, same proof size, and prove time within noise for single-thread and WASM.

### 2.3 Poseidon constants (flag)
- zk-wasmvm doesn't care which Poseidon constants we use, because they live in the VK's fixed columns. **No constant switch is needed for verifier compatibility.**
- There are two good reasons to switch the SEZS Poseidon to the **standard `P128Pow5T3`** before any real sale:
  1. The contract could recompute or check roots on-chain with the host `poseidon_hash_pallas`, which is the standard instance. That would remove trust in the service's root arithmetic.
  2. We'd reuse audited `halo2_gadgets` / Orchard / Valar Poseidon chips instead of the lab's custom chip (`terp/work/onboard-authz/src/poseidon.rs`, constants `SHA256("sezs-poseidon-pallas-t3-v1"||i)`).
- The cost is that every `C`, `N` and root value changes. The leaf **shape** `(secret, sku, event_id)` stays the same.
- No real tickets exist yet (lab and testnet only), so the cost is just updating test vectors.
- **Recommendation:** switch. Your call (open question 1).

---

## 3. Guest list (root) and epochs

- The payment service appends `C` when a shielded ZEC or UM payment with memo `sezs1:<C>` and the right amount confirms. It is the only writer.
- **Publishing.** The service calls `UpdateGuestRoot { root, leaf_count, epoch }` on the manifold with its **service key**.
  - It publishes after each batch: most every 15 minutes, and immediately when sales close or doors open.
  - The full leaf list (≤ 1,024 × 32 B) is public: served by the service and mirrored by `PaidLeaves` on the contract.
- **Root history.** The contract keeps every root for the event (`ROOTS: Map<root, epoch>`). Any historical root is accepted, which is safe because the tree is append-only: an older root proves membership in a subset.
  - A proof made home stays valid even if the root moves before doors open.
- **Why not a coinholder-style snapshot plus PIR?** Valar uses a snapshot root and PIR because Zcash has ~10⁸ nullifiers and voters must not reveal which one they are asking about. With ≤ 1,024 public leaves, the holder **downloads the whole list** and builds the path locally. That gives the same "don't reveal your leaf when fetching a witness" property with no PIR server. An epoch-root plus full-list download is the best fit within that approach.
- **Late buyers.**
  - The app always proves against the **newest** root proving time. The anonymity set is then every ticket in that root, not just the latest batch.
  - What leaks is "bought on or before epoch k". You accepted that.
  - Someone who pays the door and checks in a minute later can be linked by physical timing. You accepted that too.
  - Optional: re-prove the evening before doors open to join the largest set.
- **Integrity.** The service key could insert an unpaid `C`. That's a payment-integrity risk, not a privacy one, and it's the same as v1. Optional hardening: `RegisterPaidLeaf` per leaf, with the contract recomputing the root via `poseidon_hash_pallas`. That needs the standard constants (§2.3).

---

## 4. Contract changes (`cw-event-manifold`)

Path: `<repo>/e2e/lab/cw-ave/contracts/cw-event-manifold` (sezs-lab `bdb1451`). Today it has `RegisterPaidLeaf`, `SetDomain { domain, door_auth_pubkey }`, the coordinator group (cw420), and raffle messages. v1 consume lives in cw-ave `VerifyConsume`. For v2, move door consume into the manifold, so one contract owns roots, nullifiers and consent, and cw-ave stays the event core.

New or changed config:
- `service_key: Addr`: the only sender allowed for `UpdateGuestRoot`. Set by the coordinators.
- `usher_group: Addr`: a cw4/cw420 group. Membership is checked with a `Member { addr }` query on `ConsumeTicket`.
- `zkid: u64`: the `sezs_consume_v2` circuit id from `MsgStoreFullCircuit`. 0 means fail closed.
- `event_id_fp`, `domain_fp`: the field encodings of `event_id` and the contract `domain`, fixed setup.
- `door_auth_pubkey`: already exists. Used for printed tickets.

Execute messages:
- `UpdateGuestRoot { root: HexBinary(32), leaf_count: u32, epoch: u32 }`: service key only. Appends to `ROOTS`. Epochs and leaf counts must be monotonic.
- `ConsumeTicket { proof: Binary, root, nullifier, rk_x, rk_y, consent: Consent }`. Only members of the usher group may send it. It checks, in order:
  1. Sender is in the usher group.
  2. `root` is in `ROOTS`.
  3. `nullifier` is not in `NULLIFIERS`.
  4. Build the instances `root‖N‖event_id_fp‖domain_fp‖rk_x‖rk_y` (6 × 32 B LE), and call `deps.api.proof_instance_verify(zkid, proof, instances)`.
  5. Derive the 32-byte RedPallas key from `(rk_x, rk_y)`: `rk_x` little-endian with the parity of `rk_y` in the top bit. No curve math is needed. Then verify consent under it with `deps.api.redpallas_spendauth_verify` (§5).
  6. Write `NULLIFIERS[N] = (block height, usher)` and emit `ticket_consumed { nullifier }`. **No `C` and no rk index.**
- `Consent`:
  - `Live { challenge: Binary, sig: Binary(64) }`. The contract requires that `challenge` decodes to `(event_id, domain, usher == info.sender, nonce, issued_at)` with `issued_at` within ±10 minutes of block time.
  - `Printed { sig: Binary(64) }`. The signed message is fixed: `("sezs-print-v2", event_id, domain, door_auth_pubkey, N)`.

Queries:
- `Roots {}`
- `NullifierSpent { nullifier }`
- `PaidLeaves { start_after, limit }` (already exists)
- `ConsumeConfig {}`: zkid, usher group, service key.

Tests: `cosmwasm_std::testing` lets tests register a circuit verifier for `proof_instance_verify` (`std/src/testing/mock.rs` L68). Unit tests use that. The real check is a local `terpd` e2e with a stored circuit.

---

## 5. QR flow and consent

### 5.1 At home: make the proof ahead of time
1. The app has the ticket secret: from the browser, or decrypted from the ZID-sealed backup **fetched by invoice id in advance**, never by `C` near the door.
2. It downloads the full leaf list plus the newest root from the contract or service, finds its own `C` locally, and builds the path.
3. It samples `alpha` and proves (§8: about 6 s in WASM single-thread).
4. It stores the bundle `(proof, root, N, rk)` and keeps `alpha` locally, so it can sign the door.

### 5.2 At the door, live (default)
1. The holder shows the **pre-made bundle** as an animated QR (§6). The usher's device reassembles it and checks it locally: proof verification took ~112 ms in WASM in the spike; the device also checks the root is in `Roots` and `NullifierSpent` is false.
2. The usher's device shows a small **challenge QR**: `(event_id, domain, usher addr, 16-byte nonce, unix time)`.
3. The holder's app scans it, shows "Approve check-in <event> by <usher>?", and RedPallas-signs it with `rsk = ask + alpha`. It then shows **one small QR** of about 120 bytes: the signature plus a hash of the challenge.
4. The usher submits `ConsumeTicket { …, consent: Live }`.

What this protects against:
- **Photographed bundle.** Someone who photographs the bundle can't use it, because they can't sign a new challenge without `secret` and `alpha`.
- **Ticket used without the holder.** An usher can't admit a ticket without the holder's live approval, because the contract checks the signature against the usher's own address and the current time.

### 5.3 Printed or offline (bearer, by design)
- At print time the app proves and also signs the fixed `Printed` message under `rsk`.
- Paper can't animate. Print a **grid of static fountain-coded QR codes**, so that any `k` of them rebuild the bundle:
  - Zigner's RaptorQ framing with 1,072-byte chunks gives 5 source plus 4 repair codes. Any 5 are enough.
  - Or about 4 × 1,500-byte codes.
- The usher scans the codes and submits with `consent: Printed`. Whoever holds the paper gets in once, because `N` is spent. The print screen says so.

### 5.4 What is never on the wire
- `secret`, `ask`, `alpha`, `C`, and any ticket public key registered purchase.
- The raw-secret QR `sezs1://ticket?k=…` stays **refused** the door. That's unchanged from v1.

---

## 6. Multi-frame QR framing

Both of Zafu's and Zigner's existing schemes are in your tree:

| Scheme | Where | Frame format | Notes |
| --- | --- | --- | --- |
| BC-UR fountain (`ur:<type>/<seq>-<n>/…` bytewords) | Zafu: `apps/extension/src/shared/components/animated-qr-display.tsx` (display, density 100/140/**200 default**/300 B per frame, ~300 ms per frame), `animated-qr-scanner.tsx` (`MAX_UR_PARTS = 4096`, `MAX_UR_PART_BYTES = 2048`), `workers/ur-decode-worker.ts`, wasm `ur_encode_frames(cbor, ur_type, fragment_size)` / `ur_decode_frames` (`packages/zcash-wasm/zafu_wasm.d.ts` L1075–1083), parser `packages/wallet/src/ur-parser.ts`. Zigner: `rust/signer` uses crate `ur = "0.4"`. | CBOR payload, UR fountain parts | Same family as Keystone, Zodl and Vizor. The density presets are tuned to Vizor's voting flow. |
| Zigner RaptorQ |  `make_data_packs` (`raptorq 1.8.1`), decoder `rust/qr_reader_phone/src/process_payload.rs`; `CHUNK_SIZE = 1072`, 1/15 s per frame (`rust/constants/src/lib.rs` L216–246) | 4-byte BE length with the top bit set, plus a serialized RaptorQ `EncodingPacket`; repair packets ≈ source packets | Fewer, denser frames. Used for Zigner and cw-orch-kms (`packages/cw-orch-kms/src/ui_shared.rszigner_frames`, per `docs/issues/approval-tx-multiframe-qr.md`). |

**Recommendation:**
- Live phone-to-usher transfer: **BC-UR** with type `ur:sezs-ticket-v2`, a CBOR map `{v:2, proof, root, n, rk}`, using Zafu's density presets.
  - At 300 B per fragment, the 4,448-byte bundle is 15 source parts; the 200 B default it is 23.
  - A phone camera usually needs a few seconds about 3 fps. **I haven't measured scan time.**
- Paper: **RaptorQ** 1,072-byte chunks (9 printed codes, any 5 suffice) or 1,500-byte chunks (≈ 3 + 2).
- Both encoders exist as Rust and wasm in your tree. Reusing Zafu's wasm means no new QR code to maintain.

---

## 7. Backend changes (payment service)

1. **Stop** accepting or recording `N` and the ticket public key invoice time. Invoice input becomes `{ commitment C, rail, sku, eventId }` only.
   - The v1 consent path registered both; that's removed for v2.
   - `BACKEND-ROLE.md` "What the backend does" step 1 and the "accepted v1 trade" sentence need updating when v2 lands.
2. Keep: match memo `C` to the invoice and amount, append `C`, and never see the secret.
3. **New:**
   - A tree builder (depth 10, append-only, persisted).
   - `UpdateGuestRoot` publisher with the service key (testnet or local only).
   - `GET /leaves?event=` returning the full leaf list and current root.
4. Sealed ZID backup: store and serve by **invoice id**. The client fetches it right after purchase or well before the event, never keyed by `C` check-in.
5. The door no longer touches the backend. Admission is the contract. The backend may show a read-only "consumed count".
6. Keep the logging rules: no secrets, no raw QR, and short retention for invoice IP logs.

---

## 8. Spike (measured, 14 Nov 2026, the build machine)

Code: `<repo>/e2e/lab/spikes/spike-v2/` (untracked, not committed). It contains `src/lib.rs` (circuit), `src/bin/spike.rs`, `src/bin/dump_tables.rs` and `run-wasi.mjs`. Build output goes to `<repo>/e2e/lab/spikes/target`.

Setup:
- Machine: Apple M1 Pro, 10 cores.
- Toolchain: rustc 1.98.0-nightly (2026-06-06).
- Crates: halo2_proofs 0.3.5, halo2_gadgets 0.5.0, pasta_curves 0.5.2, reddsa 0.5.2.
- IPA params `Params<vesta::Affine>`, K=11, Blake2b transcript.
- Poseidon: standard P128Pow5T3. The SEZS custom constants would cost the same.
- 3 proofs per configuration, each with a fresh `alpha`.

Correctness:
- MockProver: satisfied depth 8 and 10.
- A wrong nullifier is rejected.
- Real prove and verify succeeded.
- The `rk` from the circuit is byte-equal to `reddsa::VerificationKey<orchard::SpendAuth>` built from `rsk = ask + alpha`.
- A RedPallas signature over a challenge verifies under it (64-byte signature).

| Run | Depth | Prove (3 runs, ms) | Verify (ms) | Proof (bytes) |
| --- | --- | --- | --- | --- |
| Native, multicore | 8 | 333 / 332 / 347 | 12 / 5 / 5 | 4,192 |
| Native, multicore | 10 | 402 / 408 / 386 | 7 / 6 / 6 | 4,192 |
| Native, 1 thread (`RAYON_NUM_THREADS=1`) | 8 | 1,495 / 1,489 / 1,485 | 29 | 4,192 |
| Native, 1 thread | 10 | 1,498 / 1,512 / 1,585 | 29 | 4,192 |
| **WASM** (wasm32-wasip1, no SIMD/threads, Node v24.18.0 WASI) | 8 | **6,016 / 5,968 / 5,965** | 114 / 112 / 111 | 4,192 |
| **WASM** | 10 | **6,020 / 5,976 / 5,970** | 114 / 111 / 112 | 4,192 |

One-time costs:
- Params generation: 433–455 ms native multicore, ~1.6 s single-thread, **~6.3 s WASM**. Serialized params are 131,140 bytes, so they can be downloaded instead of generated.
- Keygen (vk + pk): ~0.47–0.51 s native multicore, ~0.9 s single-thread, **~3.4 s WASM**.
- Fixed-base table search: 101 s native, so these must be precomputed constants (28,256 bytes).
- WASM binary: 2.34 MB, unoptimised, no `wasm-opt`.

QR:
- Bundle = 4,192 proof + 6 × 32 publics + 64 signature = **4,448 bytes**. That's more than the 2,953 B v40-L binary limit, so it needs **animated or multiple codes**.
- Even without the signature (the live-path bundle), 4,384 bytes is still too big.

Not measured:
- A real browser (Chrome with wasm-bindgen; threads via `wasm-bindgen-rayon` like Zafu's parallel voting-wasm build).
- Phones.
- QR scan time.
- Verifying the spike proof inside zk-wasmvm (Phase 0).

The WASM number is single-threaded V8, the same engine family as Chrome. A phone will likely be slower, and a threaded browser build faster. Because the proof is made ahead of time, about 6–10 s on first use (keygen plus prove) is acceptable for a pre-event step.

Prior art for in-browser proving: Zafu already ships Valar's voting proofs in WASM through an offscreen prover (`apps/extension/public/voting-wasm/`, `apps/extension/src/state/voting-wasm.ts`, `packages/zcash-wasm/BUILD_PROVENANCE.md` "voting-wasm" section). A later `zafu_prove_ticket` method could reuse that path and keep the secret inside the wallet.

---

## 9. Privacy properties and limits

What holds, assuming the conditions in this doc:
- The backend never learns `secret`, `ask`, `alpha`, `N` or `rk`. It sees `C` per invoice; you accepted that.
- **The operator and the chain can't tell which `C` (so which invoice: amount, rail, pay time) was used the door.** Consume reveals only `(root, N, rk, proof, consent signature)`, and `rk` is freshly re-randomised.
- Double entry is blocked: `N` is fixed by the secret and spent once on-chain.
- Live consent: an usher can't admit without the holder's signature on that usher's challenge, that time. The contract checks it.
- No ETH, so no payer address is ever tied to a ticket. ZEC and UM payments are shielded.

Limits you accepted, or that are inherent:
- The usher, operator and chain see **who physically attends, when, which door, and through which usher**.
- The root used reveals "bought on or before epoch k". With 15–300 people the set is small, and someone who buys the door and enters right away can be linked by timing.
- Paper is bearer.
- A transferred ticket stays usable by anyone who holds the secret; first use wins.
- The service key can insert unpaid leaves (integrity, not privacy).
- `alpha` must be fresh for each proof. Reusing a bundle two doors just gets the second rejected by `N`.
- Network metadata: proving needs no backend call (the leaf list is public and downloaded in full), but fetching the backup by invoice id links the client's IP to that invoice fetch time. Do it right after purchase.

---

## 10. Phased plan (rough, one engineer)

| Phase | Work | Effort |
| --- | --- | --- |
| **P0: compatibility** | Rebuild the spike against the fork (`zakura-halo2-proofs` / `crates/zakura-common`). `MsgStoreFullCircuit` on a local `terpd` (localterp or the ict-rs harness). A test contract calls `proof_instance_verify` and `redpallas_spendauth_verify` on the spike's proof and signature. Measure real gas. | 2–4 days |
| **P1: circuit** | Production `sezs_consume_v2`: Poseidon decision (§2.3), constants module, test vectors, negative tests (wrong root, N, domain, event, alpha/rk mismatch), VK artifact plus footer. | 1.5–2.5 weeks |
| **P2: client prover** | wasm-bindgen Web Worker, optionally threaded. Params download or generation and pk cache. Full-leaf-list witness builder. Bundle CBOR. Measure on phones. | 1–1.5 weeks |
| **P3: contract** | Manifold: `UpdateGuestRoot`, `ROOTS`, `ConsumeTicket`, `NULLIFIERS`, usher-group check, zkid config, consent verify, queries. Unit tests with the mock verifier. | ~1 week |
| **P4: backend** | Drop `N` and pubkey from invoices. Tree builder, root publisher, `/leaves`, envelope by invoice id. Update `BACKEND-ROLE.md`. | 3–5 days |
| **P5: door UX** | BC-UR animated display and scan through Zafu's wasm, challenge QR, holder approve-and-sign, printed RaptorQ grid. | 3–5 days |
| **P6: e2e** | Local terpd plus local minirelay e2e. Then deploy to testnet when an endpoint is confirmed **and you give the go-ahead**. | ~1 week |
| Review | Independent review of the circuit and contract before any real-money event. | External |

Total: about **5–7 weeks** to a reviewed testnet demo. P0 de-risks the one unknown in the verifier.

---

## 11. Open questions

1. Switch to standard `P128Pow5T3` Poseidon now? (Recommended. All `C` values change; the leaf shape doesn't.)
2. Which testnet endpoint is live? All documented `terp.network` testnet hosts returned 404 on 14 Nov 2026. Is `120u-1` the target chain id?
3. Who holds the **service key** (root publisher) and the coordinator key that sets `zkid`, the usher group and the service key on testnet?
4. Who registers the circuit (`circuit_upload_access` on testnet)? Is a circuit deposit (`MsgPayCircuitDeposit`) required there?
5. Root publish cadence: is 15 minutes plus a doors-open snapshot OK?
6. Printed tickets: a grid of 5–9 static codes on the print, or keep paper optional?
7. Should we later ask Zafu for a `zafu_prove_ticket` and `zafu_sign_ticket_challenge` capability, so the secret, `alpha` and `rsk` never sit in page JS?
