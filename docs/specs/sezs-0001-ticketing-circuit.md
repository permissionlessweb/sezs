```
ZIP: SEZS-0001
Title: Ticketing Circuit
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Circuit
Created: 2026-11-24
Last-Updated: 2026-11-25
License: Apache-2.0
```

Conformance keywords follow [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)), as adopted with the ZIP document conventions in [SEZS-0000](sezs-0000.md).

- **Secret.** A field element derived on the holder's device. It is the ticket
  opening. It MUST NOT leave the holder's device except by being shown to an
  usher at check-in, or written to a backup the holder controls.
- **Commitment `C`.** `Poseidon(secret, sku_fp, event_id_fp)`.
- **Nullifier `N`.** `Poseidon(secret, event_id_fp)`.
- **Guest-list root.** The Merkle root of paid commitments, anchored on chain
  by `UpdateGuestRoot` as specified in [SEZS-0003](sezs-0003-session-coordinator.md).
- **`rk`.** The RedPallas spend-authorizing key bound into the circuit as a
  public input. Holder consent under `rk` is specified in
  [SEZS-0010](sezs-0010-ticketing-process.md).

## Abstract

This document specifies the Halo2 circuit `sezs_consume_v2`: public inputs,
Poseidon argument order, field encodings, Merkle construction, proof bundle
layout, and the verifying-key hash. It is the circuit half of unlinkable
check-in. Invoice memos, ticket QR presentation, holder consent transports,
and on-chain verification of a consume proof are specified in
[SEZS-0010](sezs-0010-ticketing-process.md). The session contract that stores
nullifiers and selects the verifier is specified in
[SEZS-0003](sezs-0003-session-coordinator.md).

A ticket is a commitment in a Merkle tree. At the door a membership and
nullifier proof is built against a published root; a second consume with the
same `N` is refused (property P1 in `docs/specs/quint/ticket_lifecycle.qnt`).

## Motivation

A naïve guest list would show the chain, and the ticketing process, which paid
leaf was admitted. Binding admission to a nullifier derived from a holder-kept
secret lets a verifier refuse double admission without naming the buyer, and
without putting the opening in the public inputs.

## Privacy Implications

Anyone who sees a payment memo that carries `C` MUST NOT be able to recover
the secret from `C` alone. The circuit's public inputs are the root, the
nullifier, the session and domain fields, and `rk`; they MUST NOT include the
secret. Ushers are trusted for admission: the holder reveals the opening to
the usher at check-in. Printed tickets are bearer instruments by design.
Transfers and backups stay with the holder; there is no server-side recovery
of a lost secret. If a service is found holding ticket secrets, that is a bug,
not a fallback.

## Requirements

- The circuit MUST bind consume to a guest-list root, a nullifier, a session
  identifier, a domain, and an `rk`.
- The secret MUST be a private witness. It MUST NOT appear among the public
  inputs.
- Commitments and nullifiers MUST use the Poseidon argument order defined
  below, which MUST NOT be changed.
- A change to the circuit MUST update the verifying-key hash recorded here
  and the published verification key together.

## Specification

### Circuit

`sezs_consume_v2` is Halo2 IPA on the Pasta curves, `k = 11`, standard
Poseidon `P128Pow5T3`, Merkle depth 10. The crate is `sezs-ticket-v2`.

Public tree roots MUST be computed by this crate's `GuestTree` (standard
`P128Pow5T3`, empty leaf `0`, parent = `Poseidon(left, right)`). A process or
client MUST NOT substitute a different hash.

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

Merkle depth 10 is a capacity choice (up to 1,024 paid leaves per root
epoch), not a security parameter.

## Rationale

Poseidon argument order puts the sku in `C` and keeps it out of `N`, so the
same secret cannot be reused across skus of one session without producing a
distinct leaf, while a single nullifier still covers the session. Keeping
invoice presentation, consent transports, and verifier selection out of this
document leaves the circuit as a stable object that a second prover or
verifier can implement from these encodings alone.

## Reference Implementation

- Circuit: [`circuits/sezs-ticket-v2/`](https://github.com/permissionlessweb/sezs/tree/main/circuits/sezs-ticket-v2)
- Formal properties: `docs/specs/quint/ticket_lifecycle.qnt`,
  `docs/specs/quint/usher_authority.qnt`, `docs/specs/quint/door_consume.qnt`

On-chain verification of a bundle against a published root is specified in
[SEZS-0003](sezs-0003-session-coordinator.md) and
[SEZS-0010](sezs-0010-ticketing-process.md).

## Open Issues

- NFC transport is out of scope for v0.
- A public-chain fee and latency measurement for ushers has not been run.
- Desktop prove-time measurements exist; physical-phone timings have not
  been published in this repository.
