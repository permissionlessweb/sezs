```
ZIP: SEZS-0010
Title: Ticketing Process
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Interface
Created: 2026-11-24
License: Apache-2.0
```

## Terminology

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "RECOMMENDED",
"OPTIONAL", and "REQUIRED" in this document are to be interpreted as described
in BCP 14 when, and only when, they appear in all capitals.

- **Ticketing process.** The backend service that issues invoices, watches
  payment, publishes paid leaves and guest-list roots, and serves public
  ticket-v2 reads. It does not admit guests; admission is `ConsumeTicket`
  (sezs-0003).
- **Valid ticket.** A ticket that is paid and issued, has not been
  cancelled or refunded, and has not been admitted.

## Abstract

This document specifies the Ticketing Process: the server-side behaviour
that sits between a ZEC (or other accepted rail) payment and an on-chain
guest-list leaf. The process may see commitment memos and the public leaf
list. It MUST NOT learn ticket secrets. Combined with sezs-0001 and
sezs-0003, it is the subject of Quint properties P1 (admit at most once)
and P3 (cancel/refund exclusive with valid). Session login is specified
here only as the staff authentication used at the door and admin surfaces;
email login is sezs-0012.

## Motivation

The current Node implementation spreads ticketing across a loopback
"splash" server and earlier hash-market ITL routes. A single process
specification lets the Rust port (`crates/sezs-server`) and the
hash-market `TicketingProcess` trait be judged against the same rules.

## Privacy Implications

The process observes payment memos that include `C`, builds the public
leaf list, and publishes roots. It MUST NOT receive, store, or log the
ticket secret, nullifier openings, or holder consent keys. Root
publication MAY use a service key until the admin FROST path in sezs-0003
is the only path; that does not relax the secret-handling rule. Session
cookies and passkey material are staff or guest login state, not ticket
openings, and are specified under Session below.

## Requirements

- The process MUST NOT store ticket secrets.
- After observed payment of an invoice whose memo is `C`, the process
  MUST register that leaf and MUST publish a guest-list root that includes
  it, subject to the contract's epoch rules.
- The process MUST NOT mark a ticket admitted; only a successful
  `ConsumeTicket` does that.
- A cancellation or refund MUST take a ticket out of the valid set and
  MUST NOT leave it both valid and refunded (P3).
- All listeners MUST bind to 127.0.0.1 unless an explicit, documented
  deployment front (a single nginx) is in use. There MUST NOT be a second
  proxy.

## Specification

### Invoice, watch, and leaves

The process issues a v2 invoice as in sezs-0001 (memo is only `sezs1:` plus
hex of `C`). It watches the configured rail for that memo. After payment is
observed as a server-side fact (the browser MUST NOT be trusted to assert
payment), it:

1. records the paid commitment,
2. serves the public leaf list at `GET /sezs/v2/leaves`,
3. publishes the root with `UpdateGuestRoot` (see sezs-0003 for the
   signature rule).

Related routes used by the current tree, which the Rust port MUST
preserve or advertise a mapping for:

- `GET /sezs/v2/envelope`, `GET /sezs/v2/paid`
- `POST /sezs/v2/door/prepare`, `POST /sezs/v2/door/consume`
- `GET /sezs/v2/door/config`

Door consume on this process, if present, is a relay of a wallet-signed
`ConsumeTicket` or a refused shortcut. The process MUST NOT admit with a
service key on the live path.

### Cancellation and refund

A cancelled or refunded ticket MUST be removed from the valid set. If a
leaf was already published, the process MUST NOT silently keep treating
that ticket as admissible. The exact on-chain compensation (a later root
that omits the leaf, a spent-nullifier of a coordinator-authorised kind,
or a refused consume at the door only) is an Open Issue; whatever path is
chosen MUST satisfy P3.

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
third-party custody. The Rust port MUST keep this schema or provide a
migration. Email binding is sezs-0012.

### Binding and process shape

The Ticketing, Session, and Email processes MUST share one bind address
and be nested on a single server (the thin `sezs-server` binary, which
implements `SezsService` on hash-market). They MUST NOT each default to
the same port as independent listeners.

## Rationale

Splitting "watch payment and publish leaves" from "verify a proof and
store `N`" keeps the backend out of admission. Property P3 is stated here
because refund is a backend and policy action; the circuit only knows
nullifiers.

## Reference Implementation

- Current Node: `apps/sezs/dev/splash/` (ticket-pay, ticket-v2, consume)
  and `apps/sezs/server/` (session)
- Target Rust: `crates/sezs-server`, traits in hash-market
- Models: `docs/specs/quint/ticket_lifecycle.qnt`,
  `docs/specs/quint/door_consume.qnt`

## Open Issues

- The on-chain representation of refund after a leaf is published is not
  decided.
- Hash-market still contains earlier `/itl/*` pay and door routes, some
  of which were loopback-only. The port MUST rename them to `/sezs/*` and
  MUST NOT treat a loopback watcher as a production payment fact.
- Accepted production rails are ZEC and, where configured, Penumbra.
  Historical ETH/Base rails are rejected on write by the contract (sezs-0003).
