# Ticketing (sezs_consume_v2)

Speak-Ez Sessions tickets are commitments in a Merkle tree. The buyer keeps a secret on their device. The contract only ever sees a proof, a nullifier, and a consent signature. **The backend never learns the ticket secret.** This is a firm rule, not a default that can be relaxed in production.

The circuit crate is `sezs-ticket-v2`. The on-chain verifier is `sezs-ticket-v2-verify`. The browser prover, worker, invoice, and door UI live in `sezs-app/apps/sezs`. Guests buy tickets on the public event site, [permissionless.money/alpha/sezs](https://permissionless.money/alpha/sezs/).

## User flow

1. The buyer opens the event page and chooses a tier. A v2 invoice asks them to pay in ZEC to a shielded address, with a memo that is only the commitment `C` (`sezs1:` plus hex). The invoice does **not** include a ticket public key or a nullifier.
2. The browser derives the secret locally (see below), computes `C`, and shows the memo the buyer should attach. They also get a backup they can print or store offline, and a way to move the ticket to another device they control.
3. After payment is observed, the commitment is inserted as a leaf in the public guest-list tree. The tree is published at `GET /sezs/v2/leaves` and is anchored on chain with `UpdateGuestRoot`.
4. The holder shows a single static ticket QR (v3, bech32m, prefix `sezs3`). It carries the ticket opening (the secret), the sku when it is not the default, and an 8-byte event tag. Typical size is about 80 characters, within a 90-character budget, so it fits a Version 4 QR at error-correction level M. A 3×3 printout of the same code is the paper fallback. Older `sezs1://ticket?…` URIs are still accepted.
5. At the door, a signed-in usher scans the QR. Their device fetches the public guest-list root and leaf list, finds the commitment, and builds the membership and nullifier proof in the browser with the same circuit the contract verifies. They authorize the consume in Zafu over the event, nullifier, root, proof hash, and an expiry. The contract verifies the proof and records the nullifier `N`. A second attempt with the same `N` is refused.

Transfers and backups stay with the holder. There is no server-side copy of the secret to recover a lost ticket.

## Circuit design

`sezs_consume_v2` is Halo2 IPA on Pasta, `K = 11`, standard Poseidon `P128Pow5T3`, Merkle depth 10.

Public inputs, in order:

`root ‖ N ‖ event_id_fp ‖ domain_fp ‖ rk_x ‖ rk_y`

The leaf and nullifier use this argument order (do not change it):

- `C = Poseidon(secret, sku_fp, event_id_fp)`
- `N = Poseidon(secret, event_id_fp)`

Encodings:

- `event_id_fp` and `sku_fp` are UTF-8, at most 31 bytes, zero-padded to 32, with the top two bits cleared.
- `domain_fp` is SHA-256 of `sezs-domain-v2\0` plus the domain string, with the top two bits cleared.

Bundle v2 is 4,321 bytes: `0x02`, then `root`, `N`, `rk_x`, `rk_y`, then a 4,192-byte proof. The verifying key hash `sha256(cs‖vk)` is `0b34842f8dabd9a347c7998cbf6e7f87a52bc98b8acd4bb449e629f1740eeff6`.

The contract binds `event_id` and `domain` to its config. Unknown roots are refused. Consume is fail-closed when `zkid` is unset.

Measured prove times and on-chain gas are on the [benchmark](/specs/event/benchmark) page.

## Ticket creation and use

### Secret and commitment

The secret is derived in the browser with a KDF. It is never sent to the event backend, the publisher, or any other service. From the secret, the sku, and the event id, the client computes `C` and builds the memo `sezs1:<hex C>`. Payment observers can see that memo; they cannot recover the secret from `C` alone.

### Backup and transfer

The holder can export a backup of the ticket material (the secret and enough event context to rebuild the proof later) and can transfer that material to another device they control. Anyone who holds the secret can prove and consent. Treat the backup like a key.

### Use at the door

The holder shows the compact ticket QR (or a printout of the same code). They do not build a proof. The usher’s device fetches the public tree, proves in a Web Worker, and authorizes the consume with Zafu. After a successful consume, `N` is spent. On a desktop Chromium build of this revision, the usher-device wasm prove took 2.6 seconds after a 4.3-second first-time parameter warm-up (bundle 4,321 bytes). With the CPU throttled 4× — a mid-range phone estimate — the prove took 10.8 seconds (warm-up 17.7 seconds). At 6× — a slower phone estimate — the prove took 16.3 seconds (warm-up 27.1 seconds). Warm-up runs once per page load; later guests on the same open door page only pay the prove time. These figures are desktop Chromium measurements with CPU throttling, not timings from a physical phone. Gas and public-chain figures remain on the [benchmark](/specs/event/benchmark) page.

## Admin-powered check-in and consumption

Ushers are members of the on-chain usher cw420 group. Only they may call `ConsumeTicket`.

### Challenge and consent

Two transports are built:

- **Live.** The usher issues a challenge: `sezs-door-v2\0` plus `event_id_fp`, `domain_fp`, a 16-byte nonce, `issued_at` as a big-endian `u64`, and the usher address. The holder signs under `rk`. The contract checks the window (±600 seconds) and that the transaction sender is that usher.
- **Printed.** The message is `sezs-print-v2\0` plus `event_id_fp`, `domain_fp`, `N`, and `door_auth_pubkey`. The client sends only the signature. The contract recomputes the message. The printed payload does not carry a client-supplied message field.

Consent is RedPallas under `rk`.

### Usher submit and nullifier

The usher's wallet submits `ConsumeTicket` with the proof, root, nullifier, event, domain, `rk`, and consent. On success the contract stores `N`. A later submit with the same `N` fails with `nullifier already spent`. The door UI shows a friendly already-admitted message for that case.

### What the backend sees — and what it does not

The backend sees payment memos (including `C`), the public leaf list, and the root it publishes. It may hold a service key used only to call `UpdateGuestRoot`. It does not receive the secret, does not store it, and does not need it to publish leaves or roots. If a service is found holding ticket secrets, that is a bug, not a fallback.

A FROST principal set is planned as the signer for root publish. A configured service key may publish roots until that is in place. That does not change the secret-handling rule.


### Usher authorization and the relayer

Ushers are required to use Zafu. The check-in page scans the guest QR (Zafu’s own scanner is for Zigner airgap signing and does not hand bytes to a web app). After the proof is built, Zafu authorizes the consume via `window.zafu.signAmino` or `signDirect` of the `ConsumeTicket` transaction — the most native Cosmos path Zafu already implements. Zafu does not implement Keplr `signArbitrary` (ADR-36); site-scoped `zafu_sign` is ed25519 over a challenge with the ZID key, which is not the usher’s on-chain Terp address.

The preferred relay is: the usher’s Zafu signs the execute, and the backend only broadcasts that signed transaction. The contract already requires the sender to be in the usher group, so a relayer cannot forge an admit. This revision also accepts a canonical authorization message (`SEZS-CONSUME-V3` over usher, event, nullifier, root, proof hash, expiry) and checks live usher membership, expiry, and replay before submitting. Broadcasting a Zafu-signed consume as the only path — so the backend cannot submit with a session key — is still TODO.

Trust model: services that register a ticket store only a commitment to the secret, never the secret. The guest reveals the opening to the usher only at check-in. Ushers are trusted for admission. The chain sees the nullifier, not the secret.

## What is still planned

- NFC transport is out of scope for v0.
- Uploading the static front end on-chain is later work.
- A public-chain fee and latency measurement for ushers has not been run.
