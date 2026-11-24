# cw-event-manifold

The event contract for Speak-Ez Sessions. One instantiate holds the night: identity, programme, ticket tiers, guest-list roots, and door consume. The front end is meant to be created from `EventView` plus a chain config (contract address, LCD, chain id). Schema id: `sezs-event-v2`. API version: `2`.

This crate lives at `cw-ave/contracts/cw-event-manifold`. The public event site is [permissionless.money/alpha/sezs](https://permissionless.money/alpha/sezs/).

## Roles and permissions

`must_write` is the curator **or** a member of the coordinators cw420 group with weight greater than zero. The coordinator group is the on-chain stand-in for the principal admin FROST set. A configured service key only publishes roots. Members of the usher cw420 group only consume tickets.

| Message | Who may call it |
| --- | --- |
| `UpdateEventInfo`, `SetVenue`, `SetCwAve`, `SetCoordinators`, `SetRandomness` | Curator |
| `UpsertTier`, `RemoveTier`, `RecordSale`, `RegisterPaidLeaf` | Curator |
| `SetDomain`, `SetNip52`, `SetMetadata`, `SetServiceKey`, `SetUsherGroup`, `SetZkid` | `must_write` |
| Programme upserts and removes (FAQ, lineup, timeline, sponsors) | `must_write` |
| `RegisterRafflePrize`, `CloseRaffle`, `RequestDraw` | `must_write` |
| `UpdateGuestRoot` | The configured `service_key` only |
| `ConsumeTicket` | A member of the configured usher group |
| `RandomnessReceive` | The configured randomness contract only |
| `ClaimPrize` | Not implemented. Always returns `knowledge proof is pending`. |

A sender who is not allowed gets `unauthorized`. Consume is fail-closed when `zkid` is `0`.

## Instantiate

`InstantiateMsg` requires a coordinators group address and an event `id`, `name`, `status`, `start`, `end`, `timezone`, and `domain` (scheme + host + optional port). Optional fields: curator (defaults to the instantiate sender), `cw_ave`, randomness, venue name, door-auth public key, NIP-52 body fields, metadata URI and hash, service key, usher group, and circuit public inputs (`zkid`, `event_id_fp`, `domain_fp`).

`kind` defaults to `31923` (time-based). `d_tag` defaults to `id`. `zkid` may be omitted and set later; consume stays fail-closed until it is set.

## Execute

### Event identity

- `UpdateEventInfo` — curator may change id, name, status, schedule, timezone, summary, and content.
- `SetNip52` — write the NIP-52 fields as a group.
- `SetMetadata` — optional off-chain metadata. On-chain fields stay authoritative. When a hash is set, it must be SHA-256 of the bytes at the URI.
- `SetVenue` — curator. The public venue query stays hidden; EventView tells guests that the location is shared with ticket holders unless it is revealed.
- `SetCwAve`, `SetCoordinators`, `SetRandomness` — curator. Pointers to related contracts.
- `SetDomain` — origin for ZID and ticket signatures, and the 32-byte door-auth public key used to recompute printed consent.

### Circuit and guest list

- `SetServiceKey` — the key that may call `UpdateGuestRoot`.
- `SetUsherGroup` — the cw420 whose members may call `ConsumeTicket`.
- `SetZkid` — registers the zk-wasmvm circuit id and the two field elements that bind a proof to this event and domain.
- `UpdateGuestRoot` — append-only history. The epoch must strictly increase. Leaf count must not decrease. `is_canonical` is required. Older roots stay valid for proofs already issued against them. Unknown roots are refused at consume.

### Door

- `ConsumeTicket` — usher only. The contract checks `event_id` and `domain` against config, requires a canonical known root, and calls `verify_consume` from `sezs-ticket-v2-verify` (Halo2 IPA via `proof_instance_verify`, and RedPallas under `rk`). Consent is either live (`challenge` and `sig`, bound to this event, domain, a nonce, issued-at, and the usher as tx sender, with issued-at within ±600 seconds) or printed (`sig` only — the printed message is recomputed on chain from event, domain, `N`, and `door_auth_pubkey`). A spent nullifier is refused. The consume config reports verifier `zk-wasmvm` once `zkid` is set.

### Programme, tickets, raffles

- FAQ, lineup, timeline, and sponsors: upsert and remove by coordinators (`must_write`).
- Tiers and `RecordSale`: curator. Ethereum and Base rails are rejected.
- `RegisterPaidLeaf` — curator. Appends a 32-byte commitment to the on-chain paid-leaf map (also used as a raffle entry). The v2 guest-list leaves used for proving are published by the backend and anchored with `UpdateGuestRoot`.
- Raffles: register and close as coordinators. `RequestDraw` asks the configured randomness contract. `RandomnessReceive` completes a draw. `ClaimPrize` is not built.

## Query

`EventView` is the full deterministic document: event info, venue, lineup, timeline, sponsors, tiers, raffles, FAQ, roles, consume config, and root history.

Also: `ApiVersion`, `EventInfo`, `Venue`, `VenueForHolder`, `Lineup`, `Timeline`, `Sponsors`, `Tiers`, `Raffles`, `Raffle`, `Faq`, `PaidLeaves`, `WinningLeaf`, `Roles`, `Roots`, `NullifierSpent`, `ConsumeConfig`.

`Roles` returns curators, coordinator members and group address, usher members and group, and the service key. `ConsumeConfig` returns `zkid`, field elements, domain, current root, epoch, leaf count, door-auth key, and `verifier`. `Roots` is append-only.

## NIP-52

The Calendar DAO module uses these NIP-52 kinds:

| Kind | Constant | Use |
| --- | --- | --- |
| 31922 | `KIND_DATE_BASED` | Date-based event |
| 31923 | `KIND_TIME_BASED` | Time-based event (default) |
| 31924 | `KIND_CALENDAR` | Calendar |
| 31925 | `KIND_RSVP` | RSVP commitment only — never consume or attendance |

Instantiate and `SetNip52` accept 31922, 31923, or 31924 (`invalid nip-52 kind` otherwise). Kind 31925 is defined for RSVP and is not a valid event `kind`. Optional `metadata_uri` lets metadata live off-chain without changing the on-chain shape.

## State

Storage: `CONFIG`; maps for lineup, timeline, sponsors, tiers, raffles, and FAQ; `PAID_LEAVES` plus `PAID_NEXT`; `ROOTS` (keyed by the 32-byte root); `NULLIFIERS` (keyed by the 32-byte `N`).

Event status: `Draft`, `Announced`, `Onsale`, `Live`, `Closed`, `Settled`.

## Events (attributes)

Responses set `action` to the snake_case message name, including `update_event_info`, `set_venue`, `set_domain`, `set_zkid`, `update_guest_root` (with `epoch` and `leaf_count`), and `consume_ticket`.

## Errors

`unauthorized`, `unknown id`, `bad rail`, `bad leaf`, `leaf already registered`, `raffle not drawable`, `randomness contract is not configured`, `draw already pending or finished`, `knowledge proof is pending`, `invalid domain`, `invalid door-auth public key`, `eth and base rails are not accepted`, `invalid metadata hash`, `invalid nip-52 kind`, `zkid is unset; consume is fail-closed`, `service key is not configured`, `usher group is not configured`, `unknown or historical root is missing`, `root epoch must increase`, `leaf count must not decrease`, `nullifier already spent`, `bad field element or public input`, `public input length is invalid`, `event or domain does not match this contract`, and `ticket rejected` with a reason.

## What is still planned

- `ClaimPrize` is not implemented and always returns `knowledge proof is pending`.
- A randomness contract is optional and unset until pointed at.
- A FROST principal set is planned as the signer for `UpdateGuestRoot`. Today a configured service key publishes roots.
