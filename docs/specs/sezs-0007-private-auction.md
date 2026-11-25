```
ZIP: SEZS-0007
Title: Private Auction and Artist Raffles
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Contract / Interface
Created: 2026-11-25
License: Apache-2.0
```

Conformance keywords follow [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)), as adopted with the ZIP document conventions in [SEZS-0000](sezs-0000.md).

- **Artist raffle.** A raffle listing on the configured
  [`nftfi-raffle`](https://github.com/permissionlessweb/terp-rs/tree/main/contracts/nfts/raffle)
  contract, used for artist or vendor sales rather than attendee prizes.
- **Private auction.** A planned sale in which bids or offers are not
  published as a full bid book to every visitor. It is not implemented in
  this repository.

## Abstract

This document specifies artist-sale raffles and the intended private
auction for gallery work. Artist raffles reuse
[`nftfi-raffle`](https://github.com/permissionlessweb/terp-rs/tree/main/contracts/nfts/raffle)
and the same
[`terp-beacon`](https://github.com/permissionlessweb/terp-rs/tree/main/contracts/nfts/terp-beacon)
randomness wiring described in
[SEZS-0005](sezs-0005-attendee-raffles.md). The front end can read configured
listings. Private auction bids and offers, and settlement of either path
through FROST escrow, are Draft: there is no auction contract in this
source tree, and gallery purchase is off until escrow exists
([SEZS-0006](sezs-0006-virtual-gallery.md)).

## Motivation

Artists should be able to offer work by raffle or by a private bid without
SEZS inventing a second randomness source or a second custody path.
Reusing `nftfi-raffle` and, when escrow exists, the FROST set already
specified in [SEZS-0022](sezs-0022-frost-payroll.md) keeps those sales on
primitives the stack already has.

## Privacy Implications

On-chain `nftfi-raffle` listings and their randomness verifier are public
contract state. A private auction, when one is built, MUST invite bidders
without publishing the full bid book to every visitor, and MUST disclose
what the operator can see. Invite fragments and hash links, as used by the
gallery, reduce casual leakage; they are not anonymity against the operator.
These flows MUST NOT carry ticket secrets.

## Requirements

- Artist raffles MUST use the configured `nftfi-raffle` contract when one
  is set; they MUST NOT be specified as a second raffle contract in this
  monorepo.
- When `nftfi-raffle` is wired to a randomness verifier, that verifier
  SHOULD be the same class of on-chain beacon used for attendee raffles
  ([SEZS-0005](sezs-0005-attendee-raffles.md)).
- A listing MUST NOT be settled as a gallery purchase until escrow exists
  ([SEZS-0006](sezs-0006-virtual-gallery.md)).
- This document MUST NOT invent auction messages that are not implemented
  or agreed.

## Specification

### Artist raffles (implemented read path)

The front end reads listings from a configured `nftfi-raffle` address
(`apps/sezs/src/event/raffle-client.ts`). Queries follow that contract
(`config`, `raffle`, `ticket_count`). The configured randomness verifier,
when present, is taken from the raffle contract's callback or from session
boot.

Orchestration in this repository may instantiate `nftfi-raffle` and point
its randomness at `terp-beacon` when those artifacts are supplied. That
wiring is the preferred reuse of the existing beacon primitive.

This path lists raffles. It does not, by itself, settle a gallery sale or
replace the attendee raffle messages on `cw-event-manifold`.

### Private bids and offers (Draft)

There is no complete SEZS auction contract in this source tree. Informal
notes describe a private auction; they are design discussion, not an
implemented protocol, and their unagreed figures are not restated here.

A private auction, when one is built, would need at least:

- a way to invite bidders without publishing the full bid book to every
  visitor;
- a binding payment or commitment that the FROST set or gallery escrow
  can settle, once that escrow exists
  ([SEZS-0006](sezs-0006-virtual-gallery.md),
  [SEZS-0022](sezs-0022-frost-payroll.md));
- a clear close condition;
- an honest disclosure of what the operator can see.

None of that is specified as decided contract messages here.

## Rationale

Splitting attendee raffles ([SEZS-0005](sezs-0005-attendee-raffles.md)) from
artist raffles avoids collapsing two entry sets (paid leaves versus raffle
tickets on `nftfi-raffle`) into one contract. Leaving the auction as Draft
with open questions is more useful to an implementer than a invented API.

## Reference Implementation

- Artist raffle contract: [`nftfi-raffle`](https://github.com/permissionlessweb/terp-rs/tree/main/contracts/nfts/raffle)
- Beacon: [`terp-beacon`](https://github.com/permissionlessweb/terp-rs/tree/main/contracts/nfts/terp-beacon)
- Front-end listings client: [`apps/sezs/src/event/raffle-client.ts`](https://github.com/permissionlessweb/sezs/blob/main/apps/sezs/src/event/raffle-client.ts)
- Gallery and escrow context: [SEZS-0006](sezs-0006-virtual-gallery.md)
- FROST payroll: [SEZS-0022](sezs-0022-frost-payroll.md)

## Open Issues

- Auction message types, bid hiding, close conditions, and operator
  visibility are not agreed and MUST be written here before any auction
  contract is treated as specified.
- How an artist raffle or a winning bid is released through `sezs-art-escrow`
  is not decided; that escrow is itself Draft
  ([SEZS-0006](sezs-0006-virtual-gallery.md)).
- Whether attendee raffles and artist raffles may share a single beacon
  instance, or MUST use distinct instances, is not decided.
