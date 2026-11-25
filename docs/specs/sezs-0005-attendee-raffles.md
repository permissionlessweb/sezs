```
ZIP: SEZS-0005
Title: Attendee Raffles (Verifiable Randomness)
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Contract
Created: 2026-11-25
License: Apache-2.0
```

Conformance keywords follow [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)), as adopted with the ZIP document conventions in [SEZS-0000](sezs-0000.md).

- **Attendee raffle.** A prize registered on the session contract whose
  entry set is the paid ticket leaf list of that session.
- **Randomness oracle.** The contract address configured with
  `SetRandomness`, from which `RandomnessReceive` is accepted.

## Abstract

This document specifies verifiable-randomness raffles for session attendees.
A session coordinator registers a prize on `cw-event-manifold`, closes it
against the paid leaf count, and requests a draw. The winner index is
derived from randomness supplied by a configured on-chain oracle. SEZS
reuses existing beacon primitives —
[`terp-beacon`](https://github.com/permissionlessweb/terp-rs/tree/main/contracts/nfts/terp-beacon)
(drand quicknet verifier) in [permissionlessweb/terp-rs](https://github.com/permissionlessweb/terp-rs) —
rather than introducing a new randomness source. Artist-sale raffles that
use [`nftfi-raffle`](https://github.com/permissionlessweb/terp-rs/tree/main/contracts/nfts/raffle)
are specified in [SEZS-0007](sezs-0007-private-auction.md). Session
coordinator authority is specified in
[SEZS-0003](sezs-0003-session-coordinator.md).

## Motivation

Attendees should be able to see that a prize draw is bound to the paid
guest list and to public randomness, not to an unpublished operator
choice. Reusing `terp-beacon` keeps SEZS on a chain primitive that already
verifies drand, instead of inventing a second beacon.

## Privacy Implications

Raffle registrations, winner indices, and the winning leaf commitment are
public contract state. They MUST NOT include ticket secrets. A winning
commitment identifies a leaf, not a buyer name; claiming a prize MUST NOT
require the ticketing process to learn a secret it is forbidden to store
([SEZS-0010](sezs-0010-ticketing-process.md)).

## Requirements

- Entry count for an attendee raffle MUST be the session's paid leaf count
  at close or draw, not an operator-supplied list of names.
- `RandomnessReceive` MUST be accepted only from the configured randomness
  oracle.
- A draw MUST fail closed when no oracle is configured, when the raffle has
  no entries, or when a draw is already pending or complete.
- SEZS MUST reuse an existing on-chain randomness primitive for the oracle;
  it MUST NOT specify a new beacon contract in this monorepo.

## Specification

### Configuring the oracle

A curator sets the oracle with `SetRandomness { addr }`. The address is
optional and unset until pointed at. Orchestration in this repository
instantiates
[`terp-beacon`](https://github.com/permissionlessweb/terp-rs/tree/main/contracts/nfts/terp-beacon)
as a drand quicknet verifier when that artifact is supplied, and may record
its address as the session's `randomness` field.

`cw-event-manifold` does not itself call `terp-beacon` `Provide`. A draw
records a job and expects a later `RandomnessReceive`. Closing that gap is
an Open Issue; this document does not invent a callback the contract does
not perform.

### Registering and closing a prize

A session coordinator registers a prize with `RegisterRafflePrize`. The
stored object includes `id`, `title`, an optional `note`, `entries`,
`status`, and an optional `draw`. Closing with `CloseRaffle { id }` sets
`entries` to the current paid leaf count (`paid_count`) and marks the
prize `Closed`.

### Requesting a draw

`RequestDraw { id }` is also session-coordinator-authorised. It:

1. requires a configured oracle, or fails with `NoOracle`;
2. refuses if the prize is already `Drawn` or already has a draw
   (`DrawBusy`), or if there are no paid leaves (`NotDrawable`);
3. sets `entries` to the current paid leaf count, marks the prize
   `Closed`, and records a pending `RaffleDraw` whose `job_id` is
   `{contract}/{id}/0` and whose `oracle` is the configured address.

### Receiving randomness and selecting a winner

`RandomnessReceive { job_id, randomness }` MUST come from the configured
oracle. The contract finds the pending draw with that `job_id`, computes
`winner_index` as a uniform integer in `[0, entries)` from the randomness
bytes, stores the randomness, and marks the prize `Drawn`.

`WinningLeaf { id }` returns that index and, when present, the paid leaf
commitment at that index. Clients MAY display this as the winning ticket
leaf.

### Claiming a prize

`ClaimPrize` is defined on the contract and currently always returns
`KnowledgeProofPending`. There is no implemented claim path in this
repository. Until a knowledge-proof claim is specified and implemented,
a drawn raffle identifies a winning leaf but does not settle a prize
on chain.

## Rationale

Binding entries to paid leaves reuses the guest list already required for
admission ([SEZS-0003](sezs-0003-session-coordinator.md)). Pointing
`SetRandomness` at `terp-beacon` reuses the same beacon the orchestrator
and `nftfi-raffle` already know, rather than a SEZS-specific source.

## Reference Implementation

- Session raffle messages: [`contracts/cw-event-manifold/`](https://github.com/permissionlessweb/sezs/tree/main/contracts/cw-event-manifold)
- Beacon: [`terp-beacon`](https://github.com/permissionlessweb/terp-rs/tree/main/contracts/nfts/terp-beacon) in [permissionlessweb/terp-rs](https://github.com/permissionlessweb/terp-rs)
- Orchestration notes: [`crates/sezs-orch/`](https://github.com/permissionlessweb/sezs/tree/main/crates/sezs-orch)

## Open Issues

- The manifold does not call `terp-beacon` `Provide`; a later
  `RandomnessReceive` must still be delivered. How that callback is
  authorised and scheduled is not specified here.
- `ClaimPrize` is unimplemented (pending a knowledge proof). The proof
  relation, who may claim, and how a prize is released are not decided.
- Whether a refunded or cancelled ticket (property P3 in
  [SEZS-0010](sezs-0010-ticketing-process.md)) MUST be excluded from
  `entries` after a leaf was published is not decided.
