# Ticket v2 interface (circuit ↔ manifold ↔ front end ↔ backend)

Date: 14 November 2026 (Africa/Dakar, UTC+0). Spec: `TICKET-V2-SPEC.md`.
This page is the hand-off between the ZK/backend worker and the
manifold/front-end worker. Nothing here is deployed; everything ran on a
local terpd at 127.0.0.1.

## 1. Circuit `sezs_consume_v2`

- Halo2 IPA on Pasta, Terp's zakura fork (`terp-core/crates/zakura-*`,
  5.0.0-rc.3), `Params<vesta::Affine>`, K = 11, Blake2b transcript,
  standard Poseidon `P128Pow5T3`, Merkle depth 10 (1,024 leaves; empty = 0).
- Source: `sezs-lab/sezs-ticket-v2/circuit` (crate `sezs-ticket-v2`).
- Public instance, 6 × 32 bytes little-endian, in this order:
  `root ‖ N ‖ event_id_fp ‖ domain_fp ‖ rk_x ‖ rk_y`.
- `C = Poseidon(secret, sku_fp, event_id_fp)`, `N = Poseidon(secret, event_id_fp)`.
- `ask = Poseidon("sezs-ticket-akv2" tag, secret, domain_fp)`, `ak = ask·G`,
  `rk = ak + alpha·G` (re-randomised per presentation; the circuit proves rk
  comes from the same secret as the leaf). `alpha = from_uniform(SHA512(
  "sezs-ticket-alpha-v2\0" ‖ secret ‖ alpha_nonce16))`, so the holder can
  re-derive `rsk = ask + alpha` from the secret plus a public nonce.
- Encodings: `event_id_fp` / `sku_fp` = UTF-8 (≤ 31 bytes) zero-padded to 32,
  top 2 bits cleared. `domain_fp = SHA256("sezs-domain-v2\0" ‖ domain)`, top 2
  bits cleared.
- On-chain circuit: `terpd tx wasm store-full-circuit <params> <vkbody> --k 11
  --circuit-type 0 --curve-type 0`; the zkid comes from the tx event. Lab vk
  key `sha256(cs‖vk) = 0b34842f8dabd9a347c7998cbf6e7f87a52bc98b8acd4bb449e629f1740eeff6`
  (same value the browser `vkHash()` returns; check it before trusting a page).
- Bundle v2 (what the holder shows): `0x02 ‖ root ‖ N ‖ rk_x ‖ rk_y ‖ proof`,
  4,321 bytes (proof 4,192).

## 2. Consent messages (signed RedPallas SpendAuth under `rk`)

- Live: `"sezs-door-v2\0" ‖ event_id_fp ‖ domain_fp ‖ nonce16 ‖ issued_at u64 BE ‖ usher_addr`
  (usher address 1–128 bytes). The usher must be the tx sender; `issued_at`
  within ±`challenge_ttl_s` (default 600 s) of block time.
- Printed (bearer, 5–9 QR grid fallback):
  `"sezs-print-v2\0" ‖ event_id_fp ‖ domain_fp ‖ N ‖ door_auth_pubkey`.
  The contract **recomputes** this from config; the client never sends it.
- RedPallas key bytes: `rk_x` with the parity of `rk_y` in the top bit.

## 3. Contract side: `sezs-ticket-v2-verify`

Path: `sezs-lab/cw-ave/packages/sezs-ticket-v2-verify` (no_std, no cosmwasm-std
dependency, so no version clash). From `contracts/cw-event-manifold`:

```toml
sezs-ticket-v2-verify = { path = "../../packages/sezs-ticket-v2-verify" }
```

It calls the zk-wasmvm imports `proof_instance_verify` and
`redpallas_spendauth_verify` directly (`TerpHost`). Build the contract with
`RUSTFLAGS="-C link-arg=--allow-undefined -C target-feature=-bulk-memory,-sign-ext,-reference-types"`
then `wasm-opt -Oz --signext-lowering` (Homebrew wasm-opt; `~/.cargo/bin/wasm-opt` is broken on the development machine).

Suggested drop-in for the manifold's stubbed `verify_ticket_proof`
(I did not edit the manifold; that file belongs to the other worker):

```rust
use sezs_ticket_v2_verify::{self as v2, TerpHost};

pub fn verify_ticket_proof(
    env: &Env, info: &MessageInfo, cfg: &Config,          // zkid, event_id_fp, domain_fp, door_auth_pubkey
    proof: &Binary, i: &ConsumePublicInputs, consent: &Consent,
) -> Result<v2::Verified, ContractError> {
    let a = |h: &HexBinary| -> Result<[u8; 32], ContractError> {
        h.as_slice().try_into().map_err(|_| ContractError::BadLength)
    };
    // event_id / domain in the msg must equal config (or drop them from the msg).
    if a(&i.event_id)? != a(&cfg.event_id_fp)? || a(&i.domain)? != a(&cfg.domain_fp)? {
        return Err(ContractError::WrongEvent);
    }
    let door = v2::DoorConfig {
        zkid: cfg.zkid,
        event_id_fp: a(&cfg.event_id_fp)?,
        domain_fp: a(&cfg.domain_fp)?,
        door_auth_pubkey: cfg.door_auth_pubkey.as_bytes(),   // empty = printed disabled
        challenge_ttl_s: v2::DEFAULT_CHALLENGE_TTL_S,
    };
    let c = match consent {
        Consent::Live { challenge, sig } => v2::Consent::Live { challenge, sig },
        Consent::Printed { sig, .. } => v2::Consent::Printed { sig },   // message ignored
    };
    let input = v2::ConsumeInput {
        proof, root: a(&i.root)?, nullifier: a(&i.nullifier)?,
        rk_x: a(&i.rk_x)?, rk_y: a(&i.rk_y)?, consent: c,
    };
    let ctx = v2::Ctx { sender: info.sender.as_str(), now_s: env.block.time.seconds() };
    v2::verify_consume(&TerpHost, &door, &input, ctx)
        .map_err(|e| ContractError::TicketRejected(e.to_string()))
}
```

The manifold still does, around that call: sender ∈ usher group (cw420,
lower-authority), `root ∈ ROOTS` (every published root, so a holder who proved
against an earlier root still gets in), `N ∉ NULLIFIERS`, then records `N`.
Recommendations: drop `Printed.message` from the msg (it is recomputed and
must not be trusted), and either drop `event_id`/`domain` from
`ConsumeTicket` or keep the equality check above.

`UpdateGuestRoot { root, leaf_count, epoch }`: sender = principal admin /
FROST set address (the manifold calls it `service_key`); epoch strictly
increasing; keep every root in `ROOTS`. `root` must be canonical (`v2::is_canonical`).

Reference implementation: `sezs-lab/sezs-ticket-v2/probe` (stand-in contract
used for every measurement below).

## 4. Measured on local terpd (terpd 6.3.0-20-g045d686f, 127.0.0.1 only)

| Step | Gas used |
| --- | --- |
| store-full-circuit (zkid 1) | 11,118,125 |
| UpdateGuestRoot (6 leaves) | 130,233 |
| ProofOnly, real proof → valid | 256,729 |
| ProofOnly, 1 byte flipped → invalid | 243,616 |
| SigOnly (RedPallas) | 124,776 |
| Consume live (proof + sig + record N) | 255,684 – 256,084 |
| Consume printed | 252,766 – 253,154 |
| Replay → "ticket already used" | refused |
| Wrong sender → "challenge was issued to another usher" | refused |
| Bad printed sig → "holder consent signature invalid" | refused |
| Ticket paid after last root → "unknown root", then accepted after the next publish | refused / ok |

Prove times: native multicore 212 ms; Node wasm single-thread ~2.6 s;
headless Chromium 131 on the development machine: keygen 4.26 s (once per page), prove
2.51–2.54 s, verify 51 ms, sign 2 ms.

## 5. Front end (browser WASM)

Build: `apps/sezs/scripts/build-ticket-v2-wasm.sh` →
`public/zk/sezs-ticket-v2/` (web pkg, `prover-worker.js`, `SOURCE_REV`) and
`.zk/sezs-ticket-v2/node/` (both gitignored).

`src/ticket/v2/index.mjs`:

- `loadTicketV2({ base })` → main-thread API; `createProver({ base })` → same
  calls inside a Web Worker (use this for `prove`, which takes ~2.5 s).
- `newSecret()`, `fitSecret(bytes)`, `eventIdFp(id)`, `domainFp(origin)`
- `commitment(secret, sku, eventId)` → C (put `sezs1:<hex C>` in the payment memo)
- `nullifier(secret, eventId)`, `treeRoot(leaves)`, `packLeaves(hexList)`
- `prove({ secret, sku, eventId, domain, leaves })` →
  `{ bundle, alphaNonce, root, nullifier, leafIndex }`
- `verifyBundle({ bundle, eventId, domain })`, `bundleFields(bundle)`,
  `consumeFields(bundle)` → hex `{ root, nullifier, rk_x, rk_y, proof }` for the msg
- `liveChallenge({ eventId, domain, usher })` (usher device), `parseChallenge(bytes)`
- `signLive({ secret, eventId, domain, alphaNonce, challenge })` (holder device, after approval)
- `printedMessage({ eventId, domain, nullifier, doorAuthPubkey })`, `signPrinted({ secret, eventId, domain, alphaNonce, nullifier, doorAuthPubkey })`
- `verifyConsent({ rk, message, sig })`, `vkHash()` → vk key (compare with §1), `info()`, `memo(C)`

Node: `src/ticket/v2/node.mjs` `loadTicketV2Node()` (tests and e2e).

## 6. Backend (lab splash server)

See `BACKEND-ROLE.md`. Routes (all on the existing loopback server):

- `POST /__splash/api/v2/invoice {rail, commitment, sku?, eventId?}` — refuses
  `ticketPubkey`, `nullifier`, `rk`, … (`v2_no_correlators`) and secret fields.
- `POST /__splash/api/v2/watch/pay {commitment|memo, amountCents}` — appends C.
- `GET /sezs/v2/leaves` → `{ eventId, suite, depth, leafCount, leaves, root, published }` (public list for proving).
- `POST /__splash/api/v2/envelope` / `GET /sezs/v2/envelope?invoice=` — sealed
  backups by invoice id only.
- `POST /__splash/api/v2/root/publish {reason}` — `doors-open`, `sales-close`,
  `force` publish now; otherwise at most every 15 minutes, unchanged roots skipped.
- Publisher env: `SEZS_V2_ROOT_CONTRACT`, `SEZS_V2_ROOT_SIGNER` (`cli` lab key
  | `frost` stub), `SEZS_V2_KEYRING_HOME`, `SEZS_V2_KEY_NAME`, `SEZS_V2_NODE`
  (loopback only), `SEZS_V2_CHAIN_ID`, `SEZS_V2_TERPD`.

## 7. Tests

- `cargo test` in `sezs-lab/sezs-ticket-v2` (circuit, 5 tests incl. the contract
  module accepting a real bundle); `cargo test` in the verify package (4).
- `node --test dev/splash/ticket-v2.test.mjs src/ticket/v2/ticket-v2.test.mjs` (8).
- Chain e2e: run `sezs-lab/sezs-ticket-v2/lab/p0-local-terpd.sh` (writes
  `lab/p0-env.json`), then `node e2e/ticket-v2-chain.e2e.mjs`.

## 8. Stubbed / open

- `frostSigner` returns `frost_signer_not_wired`; a lab keyring key stands in
  for the principal admin FROST set.
- The manifold's `verify_ticket_proof` is still the other worker's stub.
- `rsk` and the secret are handled by page JS for now (a Zafu capability later).
- v1 loopback path (`ticket-pay.mjs`, records N and ticket pubkey) is still
  present for the current front end; remove it once the door uses v2.
