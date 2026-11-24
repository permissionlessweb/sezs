```
ZIP: SEZS-0004
Title: Metadata (NIP-52)
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Contract / Interface
Created: 2026-11-24
License: Apache-2.0
```

## Terminology

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "RECOMMENDED",
"OPTIONAL", and "REQUIRED" in this document are to be interpreted as described
in BCP 14 when, and only when, they appear in all capitals.

- **NIP-52 body.** The on-chain event definition stored by `SetNip52`.
  Field names follow the Nostr calendar event shape; storage is the
  contract, not a Nostr relay, unless an egress is separately configured.

## Abstract

Event metadata that the public site displays — title, kind, times, place,
content — is written to cw-event-manifold in a NIP-52-shaped body. On-chain
fields are authoritative. An optional `metadata_uri` (and content hash) MAY
point off-chain without changing the on-chain shape. This document specifies
the allowed kinds and the authority rule. Lineup presentation is a front-end
concern (`docs/specs/LINEUP-LANES.md`) and is not restated here.

## Motivation

Guests and integrators need a deterministic event definition that does not
depend on a particular front-end build. Using the NIP-52 shape lets the same
body be egressed to Nostr later without a second schema.

## Privacy Implications

On-chain metadata is public. It MUST NOT include ticket secrets, email
addresses, or registration keys. Off-chain metadata pointed to by
`metadata_uri` is public if the URI is. A content hash, when present, lets
clients detect substitution; it does not hide the document.

## Requirements

- On-chain NIP-52 fields MUST be authoritative over any off-chain copy.
- `SetNip52` MUST accept only the kinds listed below.
- Kind 31925 (RSVP) MUST NOT be used as the event's `kind` and MUST NOT
  be treated as consume or attendance.

## Specification

### Kinds

| Kind | Name | Meaning |
| --- | --- | --- |
| 31922 | `KIND_DATE_BASED` | Date-based event |
| 31923 | `KIND_TIME_BASED` | Time-based event (default) |
| 31924 | `KIND_CALENDAR` | Calendar |
| 31925 | `KIND_RSVP` | RSVP commitment only; never consume or attendance |

Instantiate and `SetNip52` MUST accept 31922, 31923, or 31924, and MUST
reject other values with `invalid nip-52 kind`. Title is the event `name`.

### Off-chain pointer

`SetMetadata { uri, content_hash }` MAY be used to point at a larger
document. The URI does not replace on-chain fields. If `content_hash` is
set, clients SHOULD reject a fetched document whose hash does not match.

### Egress

Hash-market documents a `calendar_nostr` capability (NIP-52 egress) as an
optional feature of that sidecar. Whether a given SEZS deployment enables
egress is an operational choice and is not required by this specification.

## Rationale

Storing a NIP-52-shaped body on the contract, rather than only on a relay,
keeps the event definition available from an LCD or indexer query (sezs-0011)
even if every relay is offline.

## Reference Implementation

- `contracts/cw-event-manifold/` (`SetNip52`, `SetMetadata`, `EventView`)
- Front-end layout contract: `docs/specs/LINEUP-LANES.md`

## Open Issues

- The exact field-by-field mapping from `Nip52Body` to a published Nostr
  event is not frozen in this document; it MUST be added here when egress
  is productised.
- Hash-market NIP-52 egress is optional and not automatically part of a
  SEZS deployment.
