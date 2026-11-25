```
ZIP: SEZS-0021
Title: Bluetooth Outpost Server
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Protocol / Interface
Created: 2026-11-24
Last-Updated: 2026-11-25
License: Apache-2.0
```

Conformance keywords follow [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)), as adopted with the ZIP document conventions in [SEZS-0000](sezs-0000.md).

- **Outpost.** The door-side service that speaks Bluetooth to usher devices
  and forwards verified, wallet-signed consume transactions to the session
  contract. Ushers MUST NOT need the web app as a Bluetooth central.

## Abstract

The Bluetooth outpost is the door-side process for usher devices. It
implements the messages in [SEZS-0020](sezs-0020-zigner-usher-bluetooth.md),
verifies grants, and forwards wallet-signed consume transactions. Ushers
MUST NOT need the web app to handle ticket payment or consume flows. The
canonical implementation is
[`crates/sezs-outpost`](https://github.com/permissionlessweb/sezs/tree/main/crates/sezs-outpost).
The normative usher phone application is the zigner pin recorded in
[SEZS-0020](sezs-0020-zigner-usher-bluetooth.md):
[permissionlessweb/zigner](https://github.com/permissionlessweb/zigner/tree/sezs/usher-ble)
`sezs/usher-ble` @ `bf41e6162d09394a5e0ad567f982f5335f762f16`.

## Motivation

Browser Bluetooth is awkward on usher phones, is not available in every
browser, and ties admission to a page that also hosts the public site.
An outpost lets the phone speak to a dedicated process, including on a
self-hosted or local-only deployment as described in
[SEZS-0020](sezs-0020-zigner-usher-bluetooth.md).

## Privacy Implications

The outpost sees ticket frames at check-in and device identifiers for
the duration of a grant. It MUST NOT keep ticket openings after the
consume attempt is finished. It MUST NOT log grant private keys. Revoked
and expired grants are deleted, not retained. The Bluetooth radio is a
local, proximity channel.

## Requirements

- The outpost MUST implement the verification order in
  [SEZS-0020](sezs-0020-zigner-usher-bluetooth.md).
- It MUST NOT admit with a service key on the live path.
- It MUST NOT issue tickets (P2).
- It MUST NOT live in the zigner tree.

## Specification

### Desk interface

The outpost serves a desk API for device grants and ingest:

- `GET  /health`
- `GET  /v1/devices`
- `POST /v1/connect`
- `POST /v1/disconnect`
- `POST /v1/ingest`
- `POST /v1/simulate`
- `GET  /sezs/v2/door/device/grants`
- `GET  /sezs/v2/door/device/next`
- `POST /sezs/v2/door/device/grant`
- `POST /sezs/v2/door/device/ingest`
- `POST /sezs/v2/door/device/rename`
- `POST /sezs/v2/door/device/revoke`
- `POST /sezs/v2/door/device/verify`

### Bluetooth role

The outpost is the GATT central (or the documented equivalent in the
pinned zigner variant). The device is the peripheral. Connection, ingest
of a ticket frame, and disconnect are the radio operations required for
admission. Payment-flow support means the outpost can present invoice and
paid-leaf status to the device so the usher does not open the web app for
those steps; the exact device UI is out of scope here and is documented
in the zigner tree cited in
[SEZS-0020](sezs-0020-zigner-usher-bluetooth.md).

A `Transport` interface fronts the radio. A simulated transport MAY be
used so tests and the desk can run without radio hardware. A later GATT
central can implement the same interface.

### Placement

The canonical crate is
[`crates/sezs-outpost`](https://github.com/permissionlessweb/sezs/tree/main/crates/sezs-outpost).
It MAY be linked as an `OutpostProcess` on the SEZS service or run as a
sibling process on the same host. It MUST NOT live in the zigner tree.

Ticket openings are dropped from the ingest queue after a consume attempt
finishes.

## Rationale

A dedicated outpost process gives ushers a door-side peer that speaks the
pinned zigner protocol without making the public site a Bluetooth central,
and without putting radio or grant state into the session contract.

## Reference Implementation

- Canonical outpost: [`crates/sezs-outpost`](https://github.com/permissionlessweb/sezs/tree/main/crates/sezs-outpost)
- Phone app pin: [SEZS-0020](sezs-0020-zigner-usher-bluetooth.md),
  [permissionlessweb/zigner](https://github.com/permissionlessweb/zigner/tree/sezs/usher-ble)
  `sezs/usher-ble` @ `bf41e6162d09394a5e0ad567f982f5335f762f16`

## Open Issues

- The host Bluetooth stack (system API versus a helper daemon) is not
  chosen. A version MAY keep simulate/ingest and add radio later.
- Battery, range, and multi-usher pairing behaviour are unmeasured.
