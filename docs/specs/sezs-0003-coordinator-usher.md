```
ZIP: SEZS-0003
Title: Event Coordinator and Event Usher
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Contract
Created: 2026-11-24
License: Apache-2.0
```

## Terminology

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "RECOMMENDED",
"OPTIONAL", and "REQUIRED" in this document are to be interpreted as described
in BCP 14 when, and only when, they appear in all capitals.

- **cw-ave.** Audio-visual event contracts, including the factory, in
  `permissionlessweb/cw-ave`.
- **cw-420.** A group contract used twice per event: once for coordinators,
  once for ushers. Same wasm, two instances.
- **cw-event-manifold.** The SEZS event coordinator contract in this monorepo.
  Schema id `sezs-event-v2`, API version `2`.
- **Principal admin.** A member of the coordinators group, or the curator
  configured at instantiate.

## Abstract

This document specifies how an event is coordinated and how ushers are
authorised. cw-ave remains the ticket and door core that SEZS MUST reuse.
cw-420 holds coordinator and usher membership. cw-event-manifold is the
night-level contract: identity, programme, tiers, guest-list roots, and
`ConsumeTicket`. The backend MAY read roles; it MUST NOT execute membership
changes. Ushers MAY consume a ticket; they MUST NOT issue or forge one
(property P2).

## Motivation

A single night needs a public, deterministic event view and a fail-closed
door. Forking cw-ave to add programme metadata would mix two rates of
change. A thin coordinator module plus reused cw-ave / cw-420 keeps those
responsibilities apart.

## Privacy Implications

Roles on chain are Terp bech32 addresses. ZID, passkey, and Zigner device
keys are identities used at the edge (see also sezs-0010 and sezs-0020);
the contract groups store `terp1` only. Ticket secrets never appear in
coordinator or usher state. `VenueForHolder` MAY disclose venue data only
against a commitment and proof; other venue queries follow the contract's
configured policy. Nullifiers are stored; they MUST NOT be treated as buyer
identities.

## Requirements

- Ticket and door primitives MUST be reused from cw-ave; SEZS MUST NOT
  reimplement them.
- Only a current usher-group member MAY successfully execute `ConsumeTicket`.
- Ushers MUST NOT have a contract path that inserts a guest-list leaf or
  forges a commitment.
- Consume MUST fail closed when `zkid` is unset, when the root is unknown,
  or when the nullifier was already spent.
- The backend MUST NOT execute `update_members` on the groups.
- Identity kinds (`terp-bech32`, `ed25519/zid`, `p256/passkey`,
  `zigner-device-ed25519`, payment accounts) MUST NOT be treated as
  substitutes for one another.

## Specification

### cw-ave and cw-420

`cw_ave`, `cw_ave_factory`, and `cw420` live in `permissionlessweb/cw-ave`
(Apache-2.0) and are consumed as git dependencies. This monorepo MUST NOT
carry a third copy. Two cw-420 instances are used: coordinators and ushers.
cw-420 `update_members` is admin-gated. The ushers group admin is the
coordinator's `terp1`. Hooks do not grant execute rights, and the
coordinators group MUST NOT proxy a member's transaction.

### cw-event-manifold execute

Principal-admin messages include event identity (`UpdateEventInfo`,
`SetNip52`, `SetMetadata`, `SetVenue`, `SetDomain`), wiring (`SetCwAve`,
`SetCoordinators`, `SetRandomness`, `SetServiceKey`, `SetUsherGroup`,
`SetZkid`, `SetGuestRootVk`), programme (`Upsert*` / `Remove*` for FAQ,
lineup, timeline, sponsors, tiers), `RecordSale`, `RegisterPaidLeaf`, and
raffle admin (`RegisterRafflePrize`, `CloseRaffle`, `RequestDraw`).

`UpdateGuestRoot` publishes a guest-list root, leaf count, and epoch. The
message includes a `frost_signature`. The contract comments require a 2-of-3
admin FROST signature for this path. Root epochs MUST increase; leaf counts
MUST NOT decrease.

`ConsumeTicket` is usher-only. It carries the Halo2 proof, root, nullifier,
event id, domain, `rk`, and a `Consent` that is either `Live { challenge, sig }`
or `Printed { sig }`, as specified in sezs-0001. On success the contract
stores `N`. A later submit with the same `N` MUST fail with
`nullifier already spent`.

`RandomnessReceive` is accepted only from the configured randomness address.
`ClaimPrize` is defined but not implemented; it currently fails pending a
knowledge proof (see Open Issues).

### Queries

The deterministic front-end view is `EventView` plus `ApiVersion`. Additional
queries: `EventInfo`, `Venue`, `VenueForHolder`, `Lineup`, `Timeline`,
`Sponsors`, `Tiers`, `Raffles`, `Raffle`, `Faq`, `PaidLeaves`, `WinningLeaf`,
`Roles`, `Roots`, `NullifierSpent`, `ConsumeConfig`.

### Event status

`Draft`, `Announced`, `Onsale`, `Live`, `Closed`, `Settled`.

### Roles at the edge

A person MAY hold more than one identifier (Terp account, ZID, passkey,
device key, payment accounts). Default Zafu ZIDs are site-scoped, not
event-scoped: two events that share one front-end origin see the same ZID.
Payment identities (Zcash, Penumbra) are out of scope for event-role
execute. The backend reads `Roles` / group membership; usher add and remove
HTTP routes MUST refuse to execute and MAY return the `update_members`
message for the wallet to sign.

## Rationale

Keeping cw-ave as the reused core follows the standing preference for
existing primitives over new ticket ledgers. Putting consume on the
manifold, authorised by a cw-420 usher group, gives a single nullifier
set per night without making ushers into issuers. Requiring wallet-signed
membership changes keeps the backend out of the role-grant path.

## Reference Implementation

- `contracts/cw-event-manifold/`
- `permissionlessweb/cw-ave` (cw-ave, factory, cw-420)
- Orchestration: `crates/sezs-orch/`
- Properties: `docs/specs/quint/usher_authority.qnt`,
  `docs/specs/quint/ticket_lifecycle.qnt`

## Open Issues

- Informal notes still described a transitional service key as the
  `UpdateGuestRoot` signer. The contract message already carries
  `frost_signature` and comments require 2-of-3 FROST. Implementations
  MUST treat a disagreement between a running service and this message
  as a bug to be reconciled, not as a second official path.
- `ClaimPrize` always returns a pending-proof error.
- A randomness contract is optional and unset until pointed at.
- A proposed richer role-entry registry (binding ZID / passkey / device
  keys into the contract, as sketched in the former identity note) has
  not been agreed and MUST NOT be deployed until it is.
- ETH and Base rails exist in the `Rail` enum so historical records
  decode, and are rejected on write in v2.
