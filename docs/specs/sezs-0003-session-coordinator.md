```
ZIP: SEZS-0003
Title: Session Coordinator and Usher
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Contract
Created: 2026-11-24
Last-Updated: 2026-11-25
License: Apache-2.0
```

Conformance keywords follow [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)), as adopted with the ZIP document conventions in [SEZS-0000](sezs-0000.md).

## Definitions

- **Session.** The night being hosted.
- **Session coordinator.** The curator configured at instantiate, or a member
  of the session coordinators group. Session coordinators write session
  parameters and decide who may authorise attendance.
- **Usher.** A member of the usher group. An usher MAY submit a verified
  consume; an usher MUST NOT issue or forge a ticket.
- **Ticket leaf.** A paid commitment `C` registered on the session contract
  and included in a published guest-list root.
- **cw-ave.** Audio-visual event contracts, including the factory, in
  [permissionlessweb/cw-ave](https://github.com/permissionlessweb/cw-ave).
- **cw-420.** A group contract used twice per session: once for session
  coordinators, once for ushers. Same wasm, two instances.
- **cw-event-manifold.** The SEZS session contract in this monorepo. Schema
  id `sezs-event-v2`, API version `2`.

## Abstract

This document specifies how a session is coordinated and how ushers are
authorised to admit attendees. Speak-Ez Sessions uses "session" for the
night being hosted. cw-ave remains the ticket and door core that SEZS MUST
reuse. cw-420 holds session-coordinator and usher membership. cw-event-manifold
is the session contract: identity, programme, tiers, guest-list roots, and
`ConsumeTicket`. The backend MAY read roles; it MUST NOT execute membership
changes. Ushers MAY consume a ticket; they MUST NOT issue or forge one
(property P2). Ticket proofs, and the authenticity they guarantee, are
specified here together with [SEZS-0001](sezs-0001-ticketing-circuit.md) and
[SEZS-0010](sezs-0010-ticketing-process.md).

## Motivation

Session management parameters MUST be deterministic, interoperable, and
auditable. It MUST be clear which roles may authorise attendance, and who
decides who can authorise attendance. A modular smart-contract design
compatible with dao-modules, as required by
[SEZS-0002](sezs-0002-dao-module.md), gives exactly those properties:
membership and authority live in inspectable group contracts, session
parameters live in the session contract, and neither is an informal
off-chain list.

Those same properties are why a ticket proof can be treated as authentic to
a stated guarantee. A consume proof is a Halo2 membership and nullifier proof
against a guest-list root that a session coordinator (under the FROST rule
in this document) published. The on-chain verifier selected for the session
checks the proof. Only a current usher-group member may submit
`ConsumeTicket`. Together these yield: the leaf was on the published list,
the opening matches that leaf, the nullifier has not been spent, and the
submitter was authorised to admit. They do not identify the buyer, and they
do not make an usher into an issuer (property P2 in
`docs/specs/quint/usher_authority.qnt`).

## Privacy Implications

Roles on chain are Terp bech32 addresses. ZID, passkey, and Zigner device
keys are identities used at the edge (see also
[SEZS-0010](sezs-0010-ticketing-process.md) and
[SEZS-0020](sezs-0020-zigner-usher-bluetooth.md)); the contract groups store
`terp1` only. Ticket secrets never appear in session-coordinator or usher
state. `VenueForHolder` MAY disclose venue data only against a commitment
and proof; other venue queries follow the contract's configured policy.
Nullifiers are stored; they MUST NOT be treated as buyer identities.

## Requirements

- Ticket and door primitives MUST be reused from cw-ave; SEZS MUST NOT
  reimplement them.
- Only a current usher-group member MAY successfully execute `ConsumeTicket`.
- Ushers MUST NOT have a contract path that inserts a guest-list leaf or
  forges a commitment.
- Consume MUST fail closed when `zkid` is unset, when the root is unknown,
  or when the nullifier was already spent.
- Neither the backend nor the session contract MUST execute membership
  changes on the coordinator or usher groups. Membership updates are
  wallet-signed `update_members` messages on those groups.
- Identity kinds (`terp-bech32`, `ed25519/zid`, `p256/passkey`,
  `zigner-device-ed25519`, payment accounts) MUST NOT be treated as
  substitutes for one another.

## Specification

### Authority and groups

cw-ave, the factory, and cw-420 live in
[permissionlessweb/cw-ave](https://github.com/permissionlessweb/cw-ave)
(Apache-2.0) and are consumed as git dependencies. This monorepo MUST NOT
carry a third copy.

Two cw-420 instances are used for each session:

1. **Session coordinators.** Members, together with the curator set at
   instantiate, may write session parameters. The curator or this group
   administers the usher group: they decide who can authorise attendance.
2. **Ushers.** Members may submit `ConsumeTicket`. They authorise attendance
   at the door; they do not issue tickets.

cw-420 `update_members` is admin-gated. The ushers group admin is the
session coordinator's `terp1`. Hooks do not grant execute rights, and the
session coordinators group MUST NOT proxy a member's transaction.

The backend reads `Roles` and group membership. HTTP routes that add or
remove ushers or session coordinators MUST refuse to execute and MAY return
the `update_members` message for a wallet to sign.

A person MAY hold more than one identifier (Terp account, ZID, passkey,
device key, payment accounts). Default Zafu ZIDs are site-scoped, not
session-scoped: two sessions that share one front-end origin see the same
ZID. Payment identities (Zcash, Penumbra) are out of scope for
session-role execute.

### Opening a session

A curator instantiates `cw-event-manifold` with the initial identity, the
session coordinators group, and optional wiring (cw-ave, usher group,
service key, verifier). The session starts in status `Draft`. Instantiation
is the moment the curator becomes the first session coordinator of record.

### Publishing session identity

A session coordinator writes the public definition with `SetNip52` and, if
needed, `SetMetadata`, `SetVenue`, `SetDomain`, and `UpdateEventInfo`. The
NIP-52-shaped body and authority rule are specified in
[SEZS-0004](sezs-0004-metadata-nip52.md). From this point the public view
(`EventView`) is deterministic: any client or indexer following
[SEZS-0011](sezs-0011-indexer-process.md) can render the same session
parameters from chain state.

### Wiring capability and programme

Still as a session coordinator, the same actor may attach reused primitives
and fill the programme:

- `SetCwAve`, `SetCoordinators`, `SetUsherGroup`, `SetZkid`,
  `SetGuestRootVk`, `SetServiceKey`, and `SetRandomness` (the randomness
  address used in [SEZS-0005](sezs-0005-attendee-raffles.md) is optional
  and unset until pointed at).
- `Upsert*` / `Remove*` for FAQ, lineup, timeline, sponsors, and ticket
  tiers.
- Status advances through `Draft`, `Announced`, `Onsale`, `Live`,
  `Closed`, and `Settled`.

These messages change auditable session parameters. They do not change
group membership.

### Selling and publishing the guest list

When the session is on sale, the ticketing process in
[SEZS-0010](sezs-0010-ticketing-process.md) observes payment and interacts
with the contract as follows:

1. `RecordSale` and `RegisterPaidLeaf` record a paid commitment `C`.
2. `UpdateGuestRoot` publishes a guest-list root, leaf count, and epoch.
   The message includes a `frost_signature`. The contract comments require
   a 2-of-3 admin FROST signature for this path. Root epochs MUST increase;
   leaf counts MUST NOT decrease.

The published root is the binding a later consume proof is checked against.

### Admitting an attendee

Admission is an interactive flow, not a backend privilege:

1. The holder presents the ticket opening to an usher, as specified in
   [SEZS-0010](sezs-0010-ticketing-process.md).
2. A consume bundle is built for the circuit in
   [SEZS-0001](sezs-0001-ticketing-circuit.md), including holder consent
   under `rk` (live challenge or printed signature).
3. A current usher-group member submits `ConsumeTicket` with the Halo2
   proof, root, nullifier, session id, domain, `rk`, and a `Consent` that
   is either `Live { challenge, sig }` or `Printed { sig }`.
4. The contract fails closed if `zkid` is unset, if the root is unknown,
   or if the proof does not verify. On success it stores `N`. A later
   submit with the same `N` MUST fail with `nullifier already spent`.

The authenticity guarantee of a successful consume is exactly the
conjunction of those checks: membership in a coordinator-published root,
a valid circuit proof, an unspent nullifier, and an authorised usher as
transaction sender.

Device-assisted admission over Bluetooth is specified in
[SEZS-0020](sezs-0020-zigner-usher-bluetooth.md) and
[SEZS-0021](sezs-0021-bluetooth-outpost.md). The outpost and the ticketing
process MAY relay a wallet-signed `ConsumeTicket`; they MUST NOT admit with
a service key on the live path.

### Queries

The deterministic front-end view is `EventView` plus `ApiVersion`. Additional
queries used through the lifecycle: `EventInfo`, `Venue`, `VenueForHolder`,
`Lineup`, `Timeline`, `Sponsors`, `Tiers`, `Raffles`, `Raffle`, `Faq`,
`PaidLeaves`, `WinningLeaf`, `Roles`, `Roots`, `NullifierSpent`,
`ConsumeConfig`.

Attendee raffles (`RegisterRafflePrize`, `CloseRaffle`, `RequestDraw`,
`RandomnessReceive`, `ClaimPrize`, `WinningLeaf`) are specified in
[SEZS-0005](sezs-0005-attendee-raffles.md).

## Rationale

Keeping cw-ave as the reused core follows the standing preference for
existing primitives over new ticket ledgers. Putting consume on the
manifold, authorised by a cw-420 usher group, gives a single nullifier
set per session without making ushers into issuers. Requiring wallet-signed
membership changes keeps the backend out of the role-grant path.
Describing each capability as a lifecycle step makes the authority and
authenticity rules reviewable without reducing the contract to an API list.

## Reference Implementation

- Session contract: [`contracts/cw-event-manifold/`](https://github.com/permissionlessweb/sezs/tree/main/contracts/cw-event-manifold)
- Reused ticket and group primitives: [permissionlessweb/cw-ave](https://github.com/permissionlessweb/cw-ave) (cw-ave, factory, cw-420)
- Orchestration: [`crates/sezs-orch/`](https://github.com/permissionlessweb/sezs/tree/main/crates/sezs-orch)
- Properties: [`docs/specs/quint/usher_authority.qnt`](quint/usher_authority.qnt),
  [`docs/specs/quint/ticket_lifecycle.qnt`](quint/ticket_lifecycle.qnt)

## Open Issues

- Informal notes still described a transitional service key as the
  `UpdateGuestRoot` signer. The contract message already carries
  `frost_signature` and comments require 2-of-3 FROST. Implementations
  MUST treat a disagreement between a running service and this message
  as a bug to be reconciled, not as a second official path.
- `ClaimPrize` always returns a pending-proof error. See
  [SEZS-0005](sezs-0005-attendee-raffles.md).
- A randomness contract is optional and unset until pointed at. See
  [SEZS-0005](sezs-0005-attendee-raffles.md).
- A proposed richer role-entry registry (binding ZID / passkey / device
  keys into the contract) has not been agreed and MUST NOT be deployed
  until it is.
- ETH and Base rails exist in the `Rail` enum so historical records
  decode, and are rejected on write in v2.
