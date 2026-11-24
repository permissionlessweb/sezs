# SEZS specifications

These documents are the technical specifications for Speak-Ez Sessions.
They follow the document structure of [ZIP-0000](https://zips.z.cash/zip-0000#zip-format-and-structure)
(preamble, terminology, abstract, motivation, privacy implications, requirements,
specification, rationale, reference implementation). They are SEZS specifications,
not Zcash Improvement Proposals, and they are not governed by the Zcash ZIP editors.

Language uses the RFC 2119 / BCP 14 words MUST, MUST NOT, SHOULD, SHOULD NOT, MAY,
RECOMMENDED, OPTIONAL, and REQUIRED, and only when those words appear in all capitals.

The audience is grant reviewers and implementers. Where a fact is not yet decided
or not yet implemented, the document says so in an Open Issues section instead of
filling the gap with invention.

## Index

| ID | Title | Notes |
| --- | --- | --- |
| [sezs-0000](sezs-0000.md) | Specification process | Process |
| [sezs-0001](sezs-0001-ticketing-circuit.md) | Ticketing Circuit | Halo2 `sezs_consume_v2` |
| [sezs-0002](sezs-0002-dao-module.md) | DAO module | Minimal DAO DAO set; dao-calendar stays in its own repo |
| [sezs-0003](sezs-0003-coordinator-usher.md) | Event Coordinator and Event Usher | cw-ave, cw-420, cw-event-manifold |
| [sezs-0004](sezs-0004-metadata-nip52.md) | Metadata (NIP-52) | On-chain event definition |
| [sezs-0010](sezs-0010-ticketing-process.md) | Ticketing Process | Backend |
| [sezs-0011](sezs-0011-indexer-process.md) | Indexer Process | Argus fork (separate workstream); this repo specifies the formula API only |
| [sezs-0012](sezs-0012-email-process.md) | Email Process | Backend |
| [sezs-0020](sezs-0020-zigner-usher-bluetooth.md) | Zigner usher variant (Bluetooth) | Wire protocol. The phone app is owned by the Signer App Lead |
| [sezs-0021](sezs-0021-bluetooth-outpost.md) | Bluetooth outpost server | Replaces web-app Bluetooth for ushers |
| [sezs-0022](sezs-0022-frost-payroll.md) | FROST payroll | Built on the former hash-market `itl_frost` design, renamed SEZS |

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

- `circuits/sezs-ticket-v2/docs/SPEC.md` → sezs-0001
- `apps/sezs/docs/TICKET-V2-SPEC.md`, `TICKET-V2-INTERFACE.md`, `TICKET-PROOF-DESIGN.md` → sezs-0001 and sezs-0010
- `contracts/cw-event-manifold/docs/SPEC.md`, `apps/sezs/docs/EVENT-MANIFOLD-API.md` → sezs-0003 and sezs-0004
- `docs/specs/IDENTITY-AND-ROLES.md` → sezs-0003 (roles) and sezs-0010 (session)
- `docs/specs/EMAIL-AUTH-GAP.md` → sezs-0012
- `apps/sezs/docs/USHER-BLE-AUTH.md` → sezs-0020 and sezs-0021

`LINEUP-LANES.md` is a front-end layout contract and stays beside these specifications.
`GUIDES-AND-DEMO-ENGINE.md` is a narration/tooling note, not a protocol specification.
