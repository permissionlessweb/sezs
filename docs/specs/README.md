# SEZS specifications

These documents are the technical specifications for Speak-Ez Sessions.
They follow the document structure of [ZIP-0000](https://zips.z.cash/zip-0000)
(preamble, abstract, motivation, privacy implications, requirements,
specification, rationale, reference implementation), as recorded in
[SEZS-0000](sezs-0000.md). They are SEZS specifications, not Zcash
Improvement Proposals, and they are not governed by the Zcash ZIP editors.

Conformance keywords follow [BCP 14](https://www.rfc-editor.org/info/bcp14)
([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119),
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)), as adopted with the ZIP
document conventions in [SEZS-0000](sezs-0000.md). The [ZIP-0001](https://zips.z.cash/zip-0001)
document in that series is Zcash network-upgrade policy and is not adopted
by SEZS.

The audience is grant reviewers and implementers. Where a fact is not yet decided
or not yet implemented, the document says so in an Open Issues section instead of
filling the gap with invention.

## Index

| ID | Title | Notes |
| --- | --- | --- |
| [SEZS-0000](sezs-0000.md) | Specification process | Process |
| [SEZS-0001](sezs-0001-ticketing-circuit.md) | Ticketing Circuit | Halo2 `sezs_consume_v2` |
| [SEZS-0002](sezs-0002-dao-module.md) | DAO module | dao-dao compatibility; dao-calendar and DAO core in scope |
| [SEZS-0003](sezs-0003-session-coordinator.md) | Session Coordinator and Usher | cw-ave, cw-420, cw-event-manifold |
| [SEZS-0004](sezs-0004-metadata-nip52.md) | Metadata (NIP-52) | On-chain session definition; [NIP-52](https://github.com/nostr-protocol/nips/blob/master/52.md) |
| [SEZS-0005](sezs-0005-attendee-raffles.md) | Attendee Raffles (Verifiable Randomness) | Draft. Session prizes; `terp-beacon` |
| [SEZS-0006](sezs-0006-virtual-gallery.md) | Virtual Gallery | Draft. Showcase implemented; escrow planned |
| [SEZS-0007](sezs-0007-private-auction.md) | Private Auction and Artist Raffles | Draft. `nftfi-raffle` listings; auction planned |
| [SEZS-0010](sezs-0010-ticketing-process.md) | Ticketing Process | Invoices, QR, consent, verification, backend |
| [SEZS-0011](sezs-0011-indexer-process.md) | Indexer Process | [Argus](https://github.com/noahsaso/argus) fork (separate workstream); this repo specifies the formula API only |
| [SEZS-0012](sezs-0012-email-process.md) | Email Process | Backend |
| [SEZS-0020](sezs-0020-zigner-usher-bluetooth.md) | Zigner usher variant (Bluetooth) | Wire protocol; pinned `sezs/usher-ble` zigner |
| [SEZS-0021](sezs-0021-bluetooth-outpost.md) | Bluetooth outpost server | Canonical `crates/sezs-outpost` |
| [SEZS-0022](sezs-0022-frost-payroll.md) | FROST payroll | Hash-market payroll FROST module |

## Properties

Quint models in [`quint/`](quint/) state three properties of ticketing and ushering:

- **P1.** A ticket is admitted at most once.
- **P2.** Ushers cannot issue or forge tickets.
- **P3.** A cancellation or refund MUST NOT leave a ticket both valid and refunded.

Check them with:

```
just specs-quint
```

That recipe typechecks and tests the three models, then simulates them with
`quint run` against P1, P2, and P3. Symbolic model checking (`quint verify`)
needs Apalache, which is not assumed to be installed.

## Absorbed informal documents

Earlier draft notes are stubs that point here, so there is a single source of truth:

- `circuits/sezs-ticket-v2/docs/SPEC.md` → [SEZS-0001](sezs-0001-ticketing-circuit.md)
- `apps/sezs/docs/TICKET-V2-SPEC.md`, `TICKET-V2-INTERFACE.md`, `TICKET-PROOF-DESIGN.md` → [SEZS-0001](sezs-0001-ticketing-circuit.md) and [SEZS-0010](sezs-0010-ticketing-process.md)
- `contracts/cw-event-manifold/docs/SPEC.md`, `apps/sezs/docs/EVENT-MANIFOLD-API.md` → [SEZS-0003](sezs-0003-session-coordinator.md) and [SEZS-0004](sezs-0004-metadata-nip52.md)
- `docs/specs/IDENTITY-AND-ROLES.md` → [SEZS-0003](sezs-0003-session-coordinator.md) (roles) and [SEZS-0010](sezs-0010-ticketing-process.md) (session)
- `docs/specs/EMAIL-AUTH-GAP.md` → [SEZS-0012](sezs-0012-email-process.md)
- `apps/sezs/docs/USHER-BLE-AUTH.md` → [SEZS-0020](sezs-0020-zigner-usher-bluetooth.md) and [SEZS-0021](sezs-0021-bluetooth-outpost.md)

`LINEUP-LANES.md` is a front-end layout contract and stays beside these specifications.
`GUIDES-AND-DEMO-ENGINE.md` is a narration/tooling note, not a protocol specification.
