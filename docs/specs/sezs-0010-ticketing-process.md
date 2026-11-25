```
ZIP: SEZS-0010
Title: Ticketing Process
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Interface
Created: 2026-11-24
Last-Updated: 2026-11-25
License: Apache-2.0
```

Conformance keywords follow [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)), as adopted with the ZIP document conventions in [SEZS-0000](sezs-0000.md).

## Definitions

- **Ticketing process.** The backend service that issues invoices, watches
  payment, publishes [ticket leaves](sezs-0003-session-coordinator.md) and
  guest-list roots, and serves public ticket-v2 reads. It does not admit
  guests; admission is `ConsumeTicket`
  ([SEZS-0003](sezs-0003-session-coordinator.md)).
- **Valid ticket.** A ticket that is paid and issued, has not been
  cancelled or refunded, and has not been admitted.

## Abstract

This document specifies the Ticketing Process: the server-side behaviour
that sits between an accepted-rail payment and an on-chain guest-list leaf,
together with the holder-facing flows that accompany the circuit in
[SEZS-0001](sezs-0001-ticketing-circuit.md) — invoice memo encoding, ticket
QR presentation, holder consent at the door, and on-chain verification of
a consume proof against a published root. The process may see commitment
memos and the public leaf list. It MUST NOT learn ticket secrets. Combined
with [SEZS-0001](sezs-0001-ticketing-circuit.md) and
[SEZS-0003](sezs-0003-session-coordinator.md), it is the subject of Quint
properties P1 (admit at most once) and P3 (cancel/refund exclusive with
valid). Staff and holder login sessions are specified here; email login is
[SEZS-0012](sezs-0012-email-process.md).

## Motivation

A single process specification lets the ticketing implementation
(`crates/sezs-server` and the hash-market `TicketingProcess` trait) be
judged against one set of rules: what the server may observe, how a paid
leaf becomes a published root, and how a holder presents and consents to
consume a ticket without giving the process the opening.

## Privacy Implications

The process observes payment memos that include `C`, builds the public
leaf list, and publishes roots. It MUST NOT receive, store, or log the
ticket secret, nullifier openings, or holder consent keys. Root
publication MAY use a service key until the admin FROST path in
[SEZS-0003](sezs-0003-session-coordinator.md) is the only path; that does
not relax the secret-handling rule. Login-session cookies and passkey
material are staff or guest login state, not ticket openings, and are
specified under Session below.

## Requirements

- The process MUST NOT store ticket secrets.
- After observed payment of an invoice whose memo is `C`, the process
  MUST register that leaf and MUST publish a guest-list root that includes
  it, subject to the contract's epoch rules.
- The process MUST NOT mark a ticket admitted; only a successful
  `ConsumeTicket` does that.
- A cancellation or refund MUST take a ticket out of the valid set and
  MUST NOT leave it both valid and refunded (P3).
- The Ticketing, Session, and Email processes MUST be offered as one
  service surface. They MUST NOT run as competing independent listeners
  for the same routes.

## Specification

### Invoice memo and QR

A v2 invoice asks the buyer to pay in ZEC to a shielded address with a memo
that is only the commitment: `sezs1:` plus hex of `C`. The invoice MUST NOT
include a ticket public key or a nullifier. The secret is derived on the
holder's device with a KDF; it is never sent to the ticketing process.

The holder shows a single static ticket QR (v3, bech32m, prefix `sezs3`)
that carries the ticket opening (the secret), the sku when it is not the
default, and an 8-byte event tag. Older `sezs1://ticket?…` URIs MAY still
be accepted; how long that compatibility remains is an Open Issue.

Public leaf lists advertise a `root` computed by `sezs-ticket-v2::GuestTree`
(`P128Pow5T3`), as specified in
[SEZS-0001](sezs-0001-ticketing-circuit.md). Test vectors that were computed
against a different Poseidon constant set MUST be left as a lock on that
legacy module; they MUST NOT be rewritten to look like production roots,
and they are not a second source of truth for the circuit.

### Invoice, watch, and leaves

The process issues a v2 invoice as above. It watches the configured rail
for that memo. After payment is observed as a server-side fact (the
browser MUST NOT be trusted to assert payment), it:

1. records the paid commitment,
2. serves the public leaf list at `GET /sezs/v2/leaves`,
3. publishes the root with `UpdateGuestRoot` (see
   [SEZS-0003](sezs-0003-session-coordinator.md) for the signature rule).

Related routes, which implementations MUST preserve or advertise a mapping
for:

- `GET /sezs/v2/envelope`, `GET /sezs/v2/paid`
- `POST /sezs/v2/door/prepare`, `POST /sezs/v2/door/consume`
- `GET /sezs/v2/door/config`

### Consent and on-chain verification

Consent is RedPallas under `rk`, the spend-authorizing key bound into the
circuit as a public input ([SEZS-0001](sezs-0001-ticketing-circuit.md)).
Two transports are specified:

- **Live.** The usher issues a challenge: `sezs-door-v2\0` plus
  `event_id_fp`, `domain_fp`, a 16-byte nonce, `issued_at` as a big-endian
  `u64`, and the usher address. The holder signs under `rk`. The session
  contract checks a time window of ±600 seconds and that the transaction
  sender is that usher.
- **Printed.** The message is `sezs-print-v2\0` plus `event_id_fp`,
  `domain_fp`, `N`, and `door_auth_pubkey`. The client sends only the
  signature. The contract recomputes the message. The printed payload
  MUST NOT carry a client-supplied message field.

Only an on-chain usher MAY submit `ConsumeTicket` (see
[SEZS-0003](sezs-0003-session-coordinator.md)). The session contract
verifies the Halo2 bundle with the on-chain verifier selected for the
session (`zkid` / `SetGuestRootVk`). Consume MUST fail closed when no
verifier is set or when the root is unknown. Ushers MUST NOT be able to
issue or forge a commitment or a nullifier (property P2 in
`docs/specs/quint/usher_authority.qnt`).

Door consume on this process, if present, is a relay of a wallet-signed
`ConsumeTicket` or a refused shortcut. The process MUST NOT admit with a
service key on the live path.

### Cancellation and refund

A cancelled or refunded ticket MUST be removed from the valid set. If a
leaf was already published, the process MUST NOT silently keep treating
that ticket as admissible. The exact on-chain compensation (a later root
that omits the leaf, a spent-nullifier of a session-coordinator-authorised
kind, or a refused consume at the door only) is an Open Issue; whatever
path is chosen MUST satisfy P3.

### Session (staff and holder login)

Session routes:

- `POST /sezs/session/challenge`
- `POST /sezs/session/verify`
- `GET /sezs/session/me`
- `POST /sezs/session/logout`
- `GET /sezs/session/health`

Challenges are single-use. Verifiers exist for passkey (WebAuthn P-256)
and ZID (ed25519 over a domain-separated challenge). Sessions are stored
in a local SQLite WAL (challenges, passkeys, sessions, rate limits). No
third-party custody. Implementations MUST keep this schema or provide a
migration. Email binding is [SEZS-0012](sezs-0012-email-process.md).

## Rationale

Splitting "watch payment and publish leaves" from "verify a proof and
store `N`" keeps the backend out of admission. Property P3 is stated here
because refund is a backend and policy action; the circuit only knows
nullifiers. Invoice memos, QR, consent, and verifier use belong here
because they are process and contract-interaction flows, not circuit
encodings.

## Reference Implementation

- Ticketing and session: [`crates/sezs-server`](https://github.com/permissionlessweb/sezs/tree/main/crates/sezs-server),
  with traits in hash-market.
- Client libraries: `apps/sezs/src/ticket/`
- Circuit encodings: [SEZS-0001](sezs-0001-ticketing-circuit.md)
- Models: `docs/specs/quint/ticket_lifecycle.qnt`,
  `docs/specs/quint/door_consume.qnt`

## Open Issues

- The on-chain representation of refund after a leaf is published is not
  decided.
- Whether older `sezs1://ticket?…` URIs remain accepted, and for how long,
  is not formally scheduled.
- Accepted production rails are ZEC and, where configured, Penumbra.
  Historical ETH/Base rails are rejected on write by the contract
  ([SEZS-0003](sezs-0003-session-coordinator.md)).
