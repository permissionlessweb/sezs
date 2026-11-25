```
ZIP: SEZS-0020
Title: Zigner Usher Variant (Bluetooth)
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Protocol
Created: 2026-11-24
Last-Updated: 2026-11-25
License: Apache-2.0
```

Conformance keywords follow [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)), as adopted with the ZIP document conventions in [SEZS-0000](sezs-0000.md).

- **Usher device.** A phone running the SEZS Zigner variant that speaks the
  messages below over Bluetooth to the outpost
  ([SEZS-0021](sezs-0021-bluetooth-outpost.md)), not to a web page.
- **Device sign key.** An ed25519 key unique to the selected key set on
  the device. It is not the Terp bech32 address that a key set may also
  derive.

## Abstract

This document specifies the wire protocol for the SEZS Zigner usher
variant over Bluetooth. It defines the domain-separated messages,
verification order, and the rule that contract roles remain `terp1`
addresses. The normative phone application is
[permissionlessweb/zigner](https://github.com/permissionlessweb/zigner/tree/sezs/usher-ble)
on the `sezs/usher-ble` branch, at commit
`bf41e6162d09394a5e0ad567f982f5335f762f16`. That branch is built on
rotkonetworks zigner v0.15.0. It derives SEZS device keys from the zigner
key set, presents an usher tab, pairs over Bluetooth Low Energy on a
TICKET GATT characteristic with device-key frames, and scans tickets for
admission at the door. The design document in that repository is
`docs/sezs-usher-ble-camera.md`. This repository MUST NOT modify that tree.

## Motivation

Ushers should not need the web app to complete a ticket payment or
consume flow at the door. A documented message set lets the outpost
([SEZS-0021](sezs-0021-bluetooth-outpost.md)) and the phone variant be
built in parallel.

SEZS SHOULD also be self-hostable. As far as possible it SHOULD NOT even
require cellular data or a general internet connection at the door: usher
and outpost communication MAY use a mesh or other local network, and the
stack SHOULD support modular communication protocols so operators can
choose a transport that maximises usability in the room they have.

## Privacy Implications

Bluetooth proximity reveals that a device and an outpost were near each
other. Messages MUST NOT carry ticket secrets except the opening that
the holder has already chosen to show at check-in (the ticket frame).
Device grants are admin-signed and are not membership on chain. Revoked
grants MUST be deleted, not retained for history.

## Requirements

- This repository MUST NOT modify `zigner` sources. Implementations MUST
  target the pinned `sezs/usher-ble` revision cited in the Abstract.
- Domain-separated messages MUST use the labels below, byte-for-byte.
- Device grants MUST be checked against the on-chain session coordinator
  set (admin ADR-36).
- Door consume MUST be a wallet-signed `ConsumeTicket` on the live path
  ([SEZS-0003](sezs-0003-session-coordinator.md)). A relay-as-usher
  shortcut MUST stay off on the live path.
- Contract roles MUST store `terp1` only.
- The protocol MUST NOT assume a wide-area network is available at the
  door.

## Specification

### Messages

Texts are UTF-8, one field per line, labels as shown. Canonical field
layouts are those used by the outpost codec in
[`crates/sezs-outpost`](https://github.com/permissionlessweb/sezs/tree/main/crates/sezs-outpost)
(UTF-8, LF, no trailing newline). Non-canonical texts MUST be rejected.
Device frame signatures are ed25519 over the raw text bytes. Admin and
usher ADR-36 checks are supplied to the outpost through a `RoleChecks`
interface so the door uses a single role source.

**`SEZS-DEVICE-GRANT-V1`** — a session coordinator authorises a device
sign key for a session, with expiry and nonce. Verified as admin ADR-36
against the on-chain session coordinator set.

**`SEZS-TICKET-FRAME-V1`** — the frame that carries a scanned ticket
opening (and sku / event tag as needed) from the device to the outpost.
The opening is the holder's secret, revealed only at check-in.

**`SEZS-CONSUME-V3-DEVICE`** — device-signed consume authorisation
binding usher, session, nullifier, root, proof hash, and expiry.

**`SEZS-USHER-REG-V1`** — registration of a device to an usher:

```
SEZS-USHER-REG-V1
event: <event id>
usher: <terp1>
terp: <terp1 or ->
zid: <->
expiry: <unix seconds>
nonce: <64-hex>
```

A future revision of this document SHOULD include the exact ABNF once
those layouts are frozen.

### Verification order

1. The device grant is valid, unexpired, and unrevoked.
2. The signer is the granted device key.
3. The usher `terp1` is in the on-chain usher group.
4. Session, root, and nullifier match the consume being submitted.
5. The consume transaction is signed by that usher, not by a backend
   session key.

### What this document does not cover

Key derivation inside Zigner, camera UX, and firmware are documented in
the pinned zigner tree (`docs/sezs-usher-ble-camera.md`) and are out of
scope here.

## Rationale

Writing the protocol here, pinning the phone application by revision, and
leaving that tree unmodified, is how the door can be specified without
vendoring zigner. Self-hosting and modular local transports follow from
the same goal: admission should work in the room, not only when a public
network is available.

## Reference Implementation

- Phone app (normative pin): [permissionlessweb/zigner](https://github.com/permissionlessweb/zigner/tree/sezs/usher-ble)
  `sezs/usher-ble` @ `bf41e6162d09394a5e0ad567f982f5335f762f16`
- Outpost codec and verification: [SEZS-0021](sezs-0021-bluetooth-outpost.md),
  [`crates/sezs-outpost`](https://github.com/permissionlessweb/sezs/tree/main/crates/sezs-outpost)

## Open Issues

- Exact ABNF for grant, frame, and consume-device messages is not yet
  frozen in this document.
- Concrete mesh and alternative transport profiles (beyond Bluetooth Low
  Energy to the outpost) are not specified here.
- Device key derivation is documented in the zigner workstream, not here.
