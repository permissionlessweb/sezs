# Usher device authentication

App-level authentication for usher Bluetooth phones. A connected radio is
never treated as proof that a ticket may be admitted. Two signatures are
required, and the splash backend checks the whole chain on every consume.

## Design choices (t44u)

**Transport.** The local demo uses a native helper on loopback
(`127.0.0.1:3061`, `LoopbackHelperTransport`). The helper is the GATT
central and holds the Noise XX session, following the existing KMS
`ble-scan.swift` / `noise.go` / `mesh.go` pattern. The SEZS page never
trusts the helper: it only receives an already-signed ticket frame.

Web Bluetooth in Chrome on desktop can be a GATT central from the SEZS
page (not from the Zafu extension). It is implemented behind the same
`Transport` interface but is **not** the demo default: macOS support is
uneven, there is no background reconnect, a seven-phone mesh is
unrealistic in a tab, and Noise XX would have to live in JavaScript.

Tests and the modal preview use `SimulatedTransport`, a loopback mock
with the same session shape.

**Grant storage.** Grants are stored by the splash backend in a `0600`
JSON file (backend-only). The admin ADR-36 signature is the source of
truth. This is the safer, simpler local option. The schema is stable so
a later cw-orch change can mirror the same records into the cw420 usher
set or the event contract. That on-chain mirror is not in this slice.

**Device key.** The phone generates an ed25519 *signing* key, distinct
from the Noise X25519 static. The grant binds both. Encryption and
signing keys are not mixed.

## Domain-separated messages

All texts are UTF-8, LF, no trailing spaces, no trailing newline. The
first line is the domain tag. Canonical encode/decode is in
`apps/sezs/src/ble/messages.mjs`.

### `SEZS-DEVICE-GRANT-V1`

Signed by the event admin with Zafu `signArbitrary` (ADR-36).

```
SEZS-DEVICE-GRANT-V1
device_sign_pubkey: <64 hex ed25519>
device_noise_static: <64 hex x25519>
usher: <terp1...>
event: <event id>
contract: <terp1... or ->
capabilities: scan-ticket
expiry: <unix seconds>
nonce: <64 hex>
```

`grant_hash` is `sha256` of these canonical bytes, 64 hex chars.

### `SEZS-TICKET-FRAME-V1`

Signed by the device ed25519 key over the raw canonical bytes (pure
Ed25519, domain tag included).

```
SEZS-TICKET-FRAME-V1
grant_hash: <64 hex>
device_sign_pubkey: <64 hex>
event: <event id>
event_tag: <16 hex, sha256(event id)[0:8]>
seq: <positive integer, per grant>
ts: <unix seconds>
payload: <sezs3... bech32m>
```

The desk and the backend refuse a frame whose `seq` is not strictly
greater than the last accepted counter for that grant, whose timestamp
is skewed by more than five minutes, whose event does not match the
grant, or whose payload was changed after signing.

### `SEZS-CONSUME-V3-DEVICE`

Signed by the usher (or admin) with ADR-36, or with the existing lab
`secp256k1-sha256` typ used by the walkthrough. This is a *new* domain,
so the on-page camera path (`SEZS-CONSUME-V3`) is unchanged.

```
SEZS-CONSUME-V3-DEVICE
usher: <terp1...>
event: <event id>
nullifier: <64 hex>
root: <64 hex>
proof_hash: <64 hex>
expiry: <unix seconds>
grant_hash: <64 hex>
frame_hash: <64 hex sha256 of the frame text>
frame_sig: <128 hex ed25519>
frame_seq: <positive integer>
```

## Verification order

`POST /sezs/v2/door/consume` when a BLE frame is present:

1. Load the grant, refuse unknown, revoked, or expired devices.
2. Verify the admin ADR-36 signature and that the signer is in the
   on-chain coordinator / admin set on the event contract.
3. Verify the device frame signature, event binding, freshness, and
   replay counter.
4. Verify the usher (or admin) consume signature, membership, and that
   the consume binds the same grant, frame hash, frame signature, and
   seq, plus the proof fields already required by `SEZS-CONSUME-V3`.
5. Remember the frame counter, then relay `ConsumeTicket` as today.

The ticket opening (the 32-byte door secret) never reaches the backend.

## Lab flag

`SEZS_ALLOW_V3_RELAY_AUTH` is off by default. When it is `1` on
loopback, `/sezs/v2/door/consume` may relay `ConsumeTicket` with the
session usher key (`executeAs`) for headless walkthroughs that cannot
run `window.zafu`. The flag does not relax grant, role, or coordinator
checks: those always use the on-chain coordinator / usher set.

## HTTP (loopback)

- `GET /sezs/v2/door/device/grants`
- `POST /sezs/v2/door/device/grant`
- `POST /sezs/v2/door/device/rename`
- `POST /sezs/v2/door/device/revoke`
- `POST /sezs/v2/door/device/ingest` (helper → desk queue)
- `GET /sezs/v2/door/device/next`
- `POST /sezs/v2/door/device/verify`

Helper process: `node apps/sezs/dev/ble-helper/server.mjs` on
`127.0.0.1:3061`.

## Event roles (on-chain terp addresses)

The event coordinator and ushers are Terp bech32 addresses held on the
event contract (`Roles` / cw420 groups). cw420 `update_members` is
admin-gated and the admin is a single address (hooks do not grant
execute rights, and the coordinators group contract cannot proxy a
member’s tx). The ushers group admin is therefore the coordinator’s
`terp1`. That coordinator signs and broadcasts `update_members` in
Zafu from the Admin Phones tab. The backend only reads on-chain roles;
it never executes membership changes.

Device grants remain admin ADR-36, checked against the on-chain
coordinator set. Door consume is a Zafu-signed `ConsumeTicket` tx
broadcast by the usher (the `SEZS_ALLOW_V3_RELAY_AUTH` executeAs
shortcut stays off in the live session).

`window.zafu` does not sign as a Zcash unified address. Contract roles
can only store `terp1`.

To fund both addresses, add them to the groups, and set the ushers
group admin to the coordinator (loopback, existing local event):

```
NETWORK=local SEZS_COORDINATOR=terp1… SEZS_USHER=terp1… make event-roles
```

That target funds each address from the session curator if needed,
then `sezs-orch-roles` loads `STATE_FILE` / `terp-boot.json`, adds the
coordinator to the coordinators group, adds the usher to the ushers
group, and transfers the ushers group admin to the coordinator.

### `SEZS-USHER-REG-V1`

```
SEZS-USHER-REG-V1
event: <event id>
usher: <terp1>
terp: <terp1 or ->
zid: <->
expiry: <unix seconds>
nonce: <64-hex>
```

HTTP:

- `GET /sezs/v2/event/roles` — on-chain coordinators, ushers, and group addresses
- `POST /sezs/v2/event/roles/usher` — refused (`use_wallet_execute`); returns the `update_members` message for the wallet to sign
- `POST /sezs/v2/event/roles/usher/remove` — same; membership is not executed by the backend

Revoked device grants are deleted from the store, not retained.
The usher-phones UI lives only on the Admin page, as the Phones tab.
