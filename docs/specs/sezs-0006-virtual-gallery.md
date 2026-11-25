```
ZIP: SEZS-0006
Title: Virtual Gallery
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Interface
Created: 2026-11-25
License: Apache-2.0
```

Conformance keywords follow [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)), as adopted with the ZIP document conventions in [SEZS-0000](sezs-0000.md).

## Definitions

- **Virtual gallery.** The public showcase and collection viewer for session
  artwork and vendor work.
- **Split.** Session-coordinator-chosen shares presented for charity and
  artist proceeds. Until escrow exists, the split is a display parameter,
  not on-chain enforcement.

## Abstract

This document specifies the SEZS virtual gallery. What is implemented today
is a showcase and collection viewer: collections, a public exhibit, invite
links that keep the invite fragment in the URL hash, and helpers that
present a charity and artist split. Buying from the gallery is off. A
listing marked for sale is rejected until an escrow contract exists.
Intended settlement through FROST escrow is outlined as Draft, and is
tied to the FROST set already used for payroll in
[SEZS-0022](sezs-0022-frost-payroll.md). Private auction bids, offers, and
artist raffles are specified in [SEZS-0007](sezs-0007-private-auction.md).

## Motivation

A session needs a public place to show work without pretending the page is
a till. Specifying the showcase that exists, and clearly marking purchase
and escrow as not yet implemented, keeps reviewers from reading a planned
market into a display.

## Privacy Implications

The showcase is public. Invite links that place a token in the URL hash
reduce casual leakage of the invite through query logs; they are not
anonymity against the operator or a determined observer. The gallery MUST
NOT display ticket secrets, email addresses, or registration commitment
keys. Artist and recipient addresses shown in a split are public once
published.

## Requirements

- The gallery MUST function as a showcase when no escrow is deployed.
- A listing MUST NOT be treated as a live sale until an escrow contract
  exists. A `listed: true` record MUST be rejected as invalid until then.
- Split percentages MUST be treated as display parameters until escrow
  enforces them.
- The gallery MUST NOT take custody of sale proceeds in this monorepo's
  current FROST escrow crate, which is not a production escrow.

## Specification

### What is implemented

The gallery lives in `apps/sezs/src/gallery`. It presents collections and a
public showcase, including invite links whose invite fragment stays in the
URL hash so it is not sent as a query string. Split helpers in `split.ts`
present charity and artist shares.

Artists, vendors, or staff register through the session registration form.
A session coordinator issues a one-time registration commitment key from
the participants surface. The backend stores only a hash of the key and
marks it consumed on first use. Real commitment keys MUST NOT appear in
this specification or in public documentation.

There is no on-chain purchase and no deployed gallery escrow in this
repository.

### Split parameters

The split is a set of modifiable parameters, chosen per session by the
session coordinators ([SEZS-0003](sezs-0003-session-coordinator.md)). It is
not a fixed protocol constant. The current defaults in `split.ts` are an
example of one session's starting values: 11.1 percent of the gross price
to a buyer-picked recipient, 11.1 percent to an artist-picked recipient
(together 22.2 percent), and the remainder to the artist. Session
coordinators MAY choose different percentages. Until escrow exists, those
figures are display only.

### FROST escrow (Draft)

A production gallery escrow is not deployed. The `frost_escrow` crate in
the workspace is a minimal restore so the build resolves; it is not
production custody.

The intended design, not yet implemented, is a CosmWasm contract
(`sezs-art-escrow`) in which a FROST-controlled per-sale address holds
proceeds and the set co-signs a release along the session's documented
split once the sale completes. A 2-of-3 FROST set, once escrow exists,
would hold sale proceeds, co-sign a release to artist and charity
addresses, and rotate without moving the session contract curator. Timeouts
and other unagreed figures from informal notes are not restated here.

What this does not do today: custody mainnet funds, settle a gallery
purchase, or replace the service key on ticket root publish
([SEZS-0003](sezs-0003-session-coordinator.md)). FROST keys on one curve
MUST NOT be reused on another; an EVM market key would need a second
distributed key generation.

Donation routing, when built, would pay a FROST-controlled address created
for that sale or campaign and, on a documented release, co-sign payouts
along the split. Until `sezs-art-escrow` is deployed, donations and
purchases are not settled by this software. The showcase MUST NOT be
treated as a till.

## Rationale

Shipping a viewer first, and refusing `listed: true` until escrow exists,
avoids a gallery that looks like it can take money it cannot settle.
Tying future settlement to the existing FROST set keeps one threshold
policy for session proceeds
([SEZS-0022](sezs-0022-frost-payroll.md)).

## Reference Implementation

- Showcase and collections: [`apps/sezs/src/gallery/`](https://github.com/permissionlessweb/sezs/tree/main/apps/sezs/src/gallery)
- FROST payroll and ceremony context: [SEZS-0022](sezs-0022-frost-payroll.md)

## Open Issues

- `sezs-art-escrow` is not specified as a message set in this repository
  and is not deployed. Timeouts and release conditions are not decided.
- Whether the same 2-of-3 set used for payroll is also the gallery escrow
  set, or a distinct set with the same parameters, is not decided.
- The gallery is a public display in a small session (the same 15–300
  person setting as the tickets). Stronger privacy for invitees is not
  specified.
