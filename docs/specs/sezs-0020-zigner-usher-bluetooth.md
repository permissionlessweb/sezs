```
ZIP: SEZS-0020
Title: Zigner Usher Variant (Bluetooth)
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Protocol
Created: 2026-11-24
License: Apache-2.0
```

## Terminology

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "RECOMMENDED",
"OPTIONAL", and "REQUIRED" in this document are to be interpreted as described
in BCP 14 when, and only when, they appear in all capitals.

- **Usher device.** A phone running a Zigner variant that speaks the
  messages below over Bluetooth to the outpost (sezs-0021), not to a
  web page.
- **Device sign key.** An ed25519 key unique to the selected key set on
  the device. It is not the Terp bech32 address that a key set may also
  derive.

## Abstract

This document specifies the wire protocol for a custom Zigner variant
used by event ushers over Bluetooth. It defines the domain-separated
messages, verification order, and the rule that contract roles remain
`terp1` addresses. It does not specify the phone application. The Signer
App Lead owns the Zigner checkout and the variant implementation. Work
in this repository MUST NOT modify that tree.

## Motivation

Ushers should not need the web app to complete a ticket payment or
consume flow at the door. A documented message set lets the outpost
(sezs-0021) and the phone variant be built in parallel.

## Privacy Implications

Bluetooth proximity reveals that a device and an outpost were near each
other. Messages MUST NOT carry ticket secrets except the opening that
the holder has already chosen to show at check-in (the ticket frame).
Device grants are admin-signed and are not membership on chain. Revoked
grants MUST be deleted, not retained for history.

## Requirements

- This repository MUST NOT modify `zigner` sources.
- Domain-separated messages MUST use the labels below, byte-for-byte.
- Device grants MUST be checked against the on-chain coordinator set
  (admin ADR-36).
- Door consume MUST be a wallet-signed `ConsumeTicket` on the live path.
  A relay-as-usher shortcut MUST stay off on the live path.
- Contract roles MUST store `terp1` only.

## Specification

### Messages

Texts are UTF-8, one field per line, labels as shown.

**`SEZS-DEVICE-GRANT-V1`** — coordinator authorises a device sign key
for an event, with expiry and nonce. Verified as admin ADR-36 against
the on-chain coordinator set.

**`SEZS-TICKET-FRAME-V1`** — the frame that carries a scanned ticket
opening (and sku / event tag as needed) from the device to the outpost.
The opening is the holder's secret, revealed only at check-in.

**`SEZS-CONSUME-V3-DEVICE`** — device-signed consume authorisation
binding usher, event, nullifier, root, proof hash, and expiry.

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

Field-by-field byte layouts for the first three messages are those
already used by the loopback helper and door code; a future revision of
this document SHOULD include the exact ABNF once the Signer App Lead
confirms they are stable.

### Verification order

1. The device grant is valid, unexpired, and unrevoked.
2. The signer is the granted device key.
3. The usher `terp1` is in the on-chain usher group.
4. Event, root, and nullifier match the consume being submitted.
5. The consume transaction is signed by that usher (Zafu or the device
   path the Signer App Lead defines), not by a backend session key.

### What this document does not cover

Key derivation inside Zigner, camera UX, and firmware are out of scope.
Those belong in the Signer App Lead's documentation.

## Rationale

Writing the protocol here, and leaving the app elsewhere, is the only
way to specify the door without touching the Zigner tree.

## Reference Implementation

- Message use in this repo: `apps/sezs/docs` stubs, `apps/sezs/dev/ble-helper/`,
  `apps/sezs/dev/splash/ble-routes.mjs` (to be replaced by sezs-0021)
- Phone app: not in this repository

## Open Issues

- Exact ABNF for grant, frame, and consume-device messages needs a
  confirmation pass with the Signer App Lead.
- Device key derivation is documented in the Zigner workstream, not here.

## Implementation decisions (Rust port)

- Canonical field layouts for grant, frame, consume-device, and usher-reg
  are those already used by `apps/sezs/src/ble/messages.mjs`. The first
  Rust codec in `crates/sezs-outpost` matches them byte-for-byte
  (UTF-8, LF, no trailing newline) and rejects non-canonical texts.
- Device frame signatures are ed25519 over the raw text bytes. Admin and
  usher ADR-36 stay behind a `RoleChecks` trait so the outpost can link
  the desk's live predicates without pulling in a second role source.
