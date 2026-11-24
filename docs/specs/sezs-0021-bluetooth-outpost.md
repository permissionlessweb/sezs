```
ZIP: SEZS-0021
Title: Bluetooth Outpost Server
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Protocol / Interface
Created: 2026-11-24
License: Apache-2.0
```

## Terminology

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "RECOMMENDED",
"OPTIONAL", and "REQUIRED" in this document are to be interpreted as described
in BCP 14 when, and only when, they appear in all capitals.

- **Outpost.** A local Rust service that speaks Bluetooth to usher devices
  and HTTP to the SEZS backend. It replaces the requirement that an usher
  use the web app as a Bluetooth central.

## Abstract

The Bluetooth outpost is the door-side process for usher devices. It
implements the messages in sezs-0020, verifies grants, and forwards
wallet-signed consume transactions. Ushers MUST NOT need the web app to
handle ticket payment or consume flows. A first Rust version replaces
`apps/sezs/dev/ble-helper`.

## Motivation

Web Bluetooth is awkward on usher phones, is not available in every
browser, and ties admission to a page that also hosts the public site.
An outpost lets the phone speak to a dedicated process.

## Privacy Implications

The outpost sees ticket frames at check-in and device identifiers for
the duration of a grant. It MUST NOT keep ticket openings after the
consume attempt is finished. It MUST NOT log grant private keys. Revoked
grants are deleted. The outpost binds to loopback HTTP for the desk; the
Bluetooth radio is a local, proximity channel.

## Requirements

- The outpost MUST implement the verification order in sezs-0020.
- It MUST NOT admit with a service key on the live path.
- It MUST NOT issue tickets (P2).
- HTTP, if exposed for the admin desk, MUST bind to 127.0.0.1.
- The first Rust version SHOULD accept the same HTTP paths as the
  current loopback helper so the desk can switch without a new UI.

## Specification

### HTTP (desk / loopback)

Current helper (`apps/sezs/dev/ble-helper`, default port 3061):

- `GET  /health`
- `GET  /v1/devices`
- `POST /v1/connect`
- `POST /v1/disconnect`
- `POST /v1/ingest`
- `POST /v1/simulate`

Door routes already used by the splash desk, which the outpost or the
nested `sezs-server` MAY serve:

- `GET  /sezs/v2/door/device/grants`
- `GET  /sezs/v2/door/device/next`
- `POST /sezs/v2/door/device/grant`
- `POST /sezs/v2/door/device/ingest`
- `POST /sezs/v2/door/device/rename`
- `POST /sezs/v2/door/device/revoke`
- `POST /sezs/v2/door/device/verify`

### Bluetooth role

The outpost is the GATT central (or the documented equivalent in the
Signer App Lead's variant). The device is the peripheral. Connection,
ingest of a ticket frame, and disconnect are the only radio operations
required in the first version. Payment-flow support means the outpost
can present invoice and paid-leaf status to the device so the usher does
not open the web app for those steps; the exact device UI is out of
scope.

### Placement

The first Rust crate is `crates/sezs-outpost` in this monorepo. It MAY
be linked as an `OutpostProcess` on the `SezsService` server or run as a
sibling binary on the same host. It MUST NOT live in the Zigner tree.

## Rationale

Replacing a Node loopback helper with a Rust outpost matches the
backend port and gives a place to attach a real Bluetooth stack later
without changing the message set.

## Reference Implementation

- Current helper: `apps/sezs/dev/ble-helper/`
- Target: `crates/sezs-outpost` (first version after the session and
  ticketing ports)

## Open Issues

- The host Bluetooth stack (system API versus a helper daemon) is not
  chosen. The first version MAY keep HTTP simulate/ingest and add radio
  later.
- Battery, range, and multi-usher pairing behaviour are unmeasured.
