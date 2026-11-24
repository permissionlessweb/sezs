```
ZIP: SEZS-0001
Title: Ticketing Circuit
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Circuit
Created: 2026-11-24
License: Apache-2.0
```

## Terminology

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "RECOMMENDED",
"OPTIONAL", and "REQUIRED" in this document are to be interpreted as described
in BCP 14 when, and only when, they appear in all capitals.

- **Secret.** A field element derived on the holder's device. It is the ticket
  opening. It MUST NOT leave the holder's device except by being shown to an
  usher at check-in, or written to a backup the holder controls.
- **Commitment `C`.** `Poseidon(secret, sku_fp, event_id_fp)`.
- **Nullifier `N`.** `Poseidon(secret, event_id_fp)`.
- **Guest-list root.** The Merkle root of paid commitments, anchored on chain
  by `UpdateGuestRoot`.
- **`rk`.** The RedPallas spend-authorizing key used to sign door consent.

## Abstract

This document specifies the Halo2 circuit `sezs_consume_v2`: public inputs,
Poseidon argument order, encodings, proof bundle layout, and the rule that the
event backend never learns the ticket secret. It is the circuit half of
unlinkable check-in. The on-chain verifier is `sezs-ticket-v2-verify`. The
backend process that watches payment memos and publishes leaves is sezs-0010.
The contract that records nullifiers is sezs-0003.

A ticket is a commitment in a Merkle tree. At the door the usher's device
builds a membership and nullifier proof; the contract verifies it and stores
`N`. A second consume with the same `N` is refused (property P1 in
`docs/specs/quint/ticket_lifecycle.qnt`).

## Motivation

A naïve guest list would show the chain, and the backend, which paid leaf
was admitted. Binding admission to a nullifier derived from a holder-kept
secret lets the contract refuse double admission without naming the buyer.

## Privacy Implications

The backend, the publisher, and any payment observer MAY see the memo that
carries `C`. They MUST NOT be able to recover the secret from `C` alone.
The chain stores `N` and the root, not the secret and not a buyer identity.
Ushers are trusted for admission: the holder reveals the opening to the usher
at check-in. Printed tickets are bearer instruments by design. Transfers and
backups stay with the holder; there is no server-side recovery of a lost
secret. If a service is found holding ticket secrets, that is a bug, not a
fallback.

## Requirements

- The backend MUST NOT learn, store, or require the ticket secret.
- The circuit MUST bind consume to a guest-list root, a nullifier, an event,
  a domain, and an `rk`.
- The contract MUST refuse an unknown root and MUST fail closed when no
  circuit id (`zkid`) is set.
- The same nullifier MUST NOT be stored twice.

## Specification

### Circuit

`sezs_consume_v2` is Halo2 IPA on the Pasta curves, `k = 11`, standard
Poseidon `P128Pow5T3`, Merkle depth 10. The crate is `sezs-ticket-v2`.

Public inputs, in this order:

`root ‖ N ‖ event_id_fp ‖ domain_fp ‖ rk_x ‖ rk_y`

Commitments and nullifiers use this argument order (it MUST NOT be changed):

- `C = Poseidon(secret, sku_fp, event_id_fp)`
- `N = Poseidon(secret, event_id_fp)`

Encodings:

- `event_id_fp` and `sku_fp` are UTF-8, at most 31 bytes, zero-padded to 32,
  with the top two bits cleared.
- `domain_fp` is SHA-256 of `sezs-domain-v2\0` plus the domain string, with
  the top two bits cleared.

Bundle v2 is 4,321 bytes: a `0x02` version byte, then `root`, `N`, `rk_x`,
`rk_y`, then a 4,192-byte proof. The verifying-key hash `sha256(cs‖vk)`
currently used by the crate is
`0b34842f8dabd9a347c7998cbf6e7f87a52bc98b8acd4bb449e629f1740eeff6`.
A change to the circuit MUST update that hash and this document together.

The contract binds `event_id` and `domain` to its config.

### Invoice memo and QR

A v2 invoice asks the buyer to pay in ZEC to a shielded address with a memo
that is only the commitment: `sezs1:` plus hex of `C`. The invoice MUST NOT
include a ticket public key or a nullifier.

The holder shows a single static ticket QR (v3, bech32m, prefix `sezs3`) that
carries the ticket opening (the secret), the sku when it is not the default,
and an 8-byte event tag. Older `sezs1://ticket?…` URIs MAY still be accepted.
The secret is derived in the browser with a KDF; it is never sent to the
event backend.

### Consent

Consent is RedPallas under `rk`. Two transports are specified:

- **Live.** The usher issues a challenge: `sezs-door-v2\0` plus `event_id_fp`,
  `domain_fp`, a 16-byte nonce, `issued_at` as a big-endian `u64`, and the
  usher address. The holder signs under `rk`. The contract checks a time
  window of ±600 seconds and that the transaction sender is that usher.
- **Printed.** The message is `sezs-print-v2\0` plus `event_id_fp`,
  `domain_fp`, `N`, and `door_auth_pubkey`. The client sends only the
  signature. The contract recomputes the message. The printed payload MUST
  NOT carry a client-supplied message field.

Only an on-chain usher MAY submit `ConsumeTicket` (see sezs-0003). Ushers
MUST NOT be able to issue or forge a commitment or a nullifier (property P2
in `docs/specs/quint/usher_authority.qnt`).

## Rationale

Poseidon argument order puts the sku in `C` and keeps it out of `N`, so the
same secret cannot be reused across skus of one event without producing a
distinct leaf, while a single nullifier still covers the event. Merkle depth
10 is a capacity choice (up to 1,024 paid leaves per root epoch), not a
security parameter. Printed consent is bearer-by-design so a phone-less
guest can still be admitted; that is a deliberate privacy and safety trade.

## Reference Implementation

- Circuit: `circuits/sezs-ticket-v2/`
- On-chain verifier: `contracts/packages/sezs-ticket-v2-verify/`
- Formal properties: `docs/specs/quint/ticket_lifecycle.qnt`,
  `docs/specs/quint/usher_authority.qnt`

## Open Issues

- NFC transport is out of scope for v0.
- A public-chain fee and latency measurement for ushers has not been run.
- Desktop prove-time measurements exist; physical-phone timings have not
  been published in this repository.
- Whether older `sezs1://ticket?…` URIs remain accepted, and for how long,
  is not formally scheduled.
