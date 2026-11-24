# Digital gallery

The live Speak-Ez Sessions gallery in `apps/sezs/src/gallery` is a showcase and collection viewer. Buying from the page is off. A listing with `listed: true` is a validation error until an escrow contract exists.

This document covers what is built, then the FROST multisig design, donation routing, and private auction. Design without shipping code is marked **Draft / Planned**.

Artists and vendors register to take part through a registration form (see below). The public event site is [permissionless.money/alpha/sezs](https://permissionless.money/alpha/sezs/).

## What is built today

- Collections and a public showcase (`ARCHITECTURE.md`, `showcase.ts`).
- Invite links that keep the invite fragment in the URL hash so it is not sent as a query string.
- Split helpers in `split.ts` for presenting charity and artist shares.
- No on-chain purchase, no deployed escrow, no live auction contract in this repository.

An older localStorage queue in `sprint/gallery/SPEC.md` is a 2025 sprint note. It is not the live app and should not be treated as current behaviour.

## Split parameters

The gallery split is a set of **modifiable parameters**, chosen per session by the event coordinators. It is not a fixed protocol constant.

The current defaults in `apps/sezs/src/gallery/split.ts` are an example of one session's starting values:

- `CHARITY_HALF = 0.111` — 11.1 percent of the gross price to a buyer-picked recipient, and 11.1 percent to an artist-picked recipient (together `CHARITY = 0.222`).
- The remainder, 77.8 percent, is the artist's share.

Coordinators may set different percentages for a later session. Until escrow exists, those percentages are display parameters, not on-chain enforcement.

## Artist registration form

To take part in an event, an artist, vendor, or staff member completes the registration form at [permissionless.money/alpha/sezs/register](https://permissionless.money/alpha/sezs/register/). Event coordinators issue a one-time registration commitment key (a password) from the Participants tab in the event admin panel. The participant includes that key when registering their wallet address or addresses in the form.

The backend stores only a hash of the key and marks it consumed on first use. Never publish a real commitment key, and never paste one into documentation.

## FROST multisig design and capability

**Built (loopback, not production custody):** the front-end FROST ceremony and inbox in `apps/sezs/src/frost` run a 2-of-3 signing set with seats labelled desk, steward, and spare (`ceremony.ts`). The admin UI is loopback-only and refuses `morocco-1`, cross-site use, a self-claimed admin role, and a same-vk shortcut. An inbox listens on `127.0.0.1:19091`. Chain authority for rotating the FROST public key is `rotate_frost_pubkey`. Ticket-paid is not offered from the admin page.

The `frost_escrow` crate in the workspace is a minimal restore so `cargo` resolves. It is not a production escrow.

**Draft / Planned (gallery escrow, 12 Oct 2026 note `GALLERY-ESCROW-SPEC-2026-10-12.md`):** a TIER 1 CosmWasm contract `sezs-art-escrow`, not deployed. The intended flow is a FROST-controlled per-sale diversified unified address, with funds released along the session's documented split once the sale completes. Timeouts in that note were working guesses and are not decided policy — they are not repeated here as figures.

An EVM market key would need a second secp256k1 distributed key generation. FROST keys on one curve are not reused on another.

What a 2-of-3 FROST set is for, once escrow exists: hold sale proceeds, co-sign a release to artist and charity addresses, and rotate the set without moving the event contract curator. What it does not do today: custody mainnet funds, settle a gallery purchase, or replace the service key on ticket root publish.

## Donation routing flow

**Draft / Planned.** The intended route, from the October 2026 escrow note and the gallery page, is:

1. A donor or buyer pays a FROST-controlled address created for that sale or campaign.
2. On completion (or on a documented release), the set co-signs payouts along the split the coordinators set for that session: the configured shares to the named recipients, and the remainder to the artist or vendor.
3. Until `sezs-art-escrow` is deployed, donations and purchases are not settled by this software. Do not treat the showcase as a till.

## Private auction flow

**Draft / Planned.** There is no complete SEZS auction contract in this source tree. Related writing exists in `notes/FROST-ESCROW-SERVICE-2026-10-12.md` and in earlier sealed-auction notes; those are design discussion, not an implemented protocol.

A private auction, when one is built, would need at least: a way to invite bidders without publishing the full bid book to every visitor, a binding payment or commitment that the FROST set or escrow can settle, a clear close condition, and an honest disclosure of what the operator can see. None of that is specified as decided contract messages here, and inventing one would be misleading. Follow-up work should start from those notes and from a written decision, then land next to its crate like the other specs.

## Honest limits

The gallery is a public display in a small event (the same 15–300 person setting as the tickets). Invite links and hash fragments reduce casual leakage; they are not anonymity against the operator or a determined observer.
