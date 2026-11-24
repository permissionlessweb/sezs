# cw-event-manifold schema `sezs-event-v2` (API 2)

One deterministic query, `EventView {}`, returns the full document the front end needs to instantiate from a contract address.

NIP-52 shape follows the in-tree Calendar DAO module (not an internet assumption):

- `<repo>/e2e/lab/sezs/sezs-docs/CALENDAR-DAO.md`
- `<repo>/e2e/lab/sezs/sezs-docs/sprint/calendar/SPEC.md`
- kinds 31922 date-based, 31923 time-based (lab nights), 31924 calendars, 31925 RSVPs as sale-window commitments never consume/attendance.

## Event fields (on-chain, authoritative)

`kind`, `d_tag`, `name` (title), `summary`, `content`, `start`, `end`, `timezone`, `location`, `geohash`, `image`, `tags`, plus lineup, timeline, sponsors, FAQ, raffles, tiers (ZEC / UM only; ETH and Base rejected on write), `domain`, `door_auth_pubkey`, `randomness`, `cw_ave`.

Optional off-chain metadata: `metadata_uri` + 32-byte `metadata_hash` (SHA-256). On-chain fields stay authoritative if both exist.

## Roles (cw420)

- **Principal admin / FROST coordinator set** (`coordinators` group, plus curator): programme edits, `SetZkid`, `SetUsherGroup`, `SetServiceKey`, domain, metadata.
- **Service key**: only `UpdateGuestRoot`. The backend runtime signs and broadcasts this (every 15 minutes and immediately at doors open / sales close). Epoch must increase; leaf count must not decrease. Historical roots stay in `ROOTS` and remain valid.
- **Usher group**: `ConsumeTicket` only.

## Consume (TICKET-V2-SPEC)

Public inputs `[root, N, event_id, domain, rk_x, rk_y]`. Consent is `Live` or `Printed`. Verification is behind `verify_ticket_proof`. Until the parallel circuit worker lands, that interface returns `VerifierStubbed` (`verifier: "stub"` on `ConsumeConfig`). `zkid == 0` is fail-closed. Unit tests may pass proof `b"stub-ok"` after membership, root, and nullifier checks.

## Queries

`EventView`, `EventInfo`, `Venue` / `VenueForHolder` (still hidden), `Lineup`, `Timeline`, `Sponsors`, `Tiers`, `Raffles`, `Faq`, `Roles`, `Roots`, `NullifierSpent`, `ConsumeConfig`, `ApiVersion`, `PaidLeaves`, `WinningLeaf`.


## NIP-52 tag extensions (inline or URI)

The contract's `tags` field is `Vec<String>`. A string that is a JSON array is
treated as a NIP-52 tag. Hashtags such as `music` stay plain strings.

The same tag language is used in an optional off-chain metadata URI that
points at a kind 31922/31923 Nostr event (or a document with that shape).
When `metadata_hash` is set, the front end verifies SHA-256 of the exact
bytes before using URI tags. On-chain EventView fields stay authoritative
when both sources set the same id.

| Tag | Fields | Use |
| --- | --- | --- |
| `stage` | id, name | Festival stage |
| `set` | stage id, artist, start, end, role?, slot id? | Set time on a stage |
| `prize` | id, title, note, entries?, status? | Raffle prize (chain `raffles` wins on id clash) |
| `door-price` | cents | Full cash-at-the-door list price |
| `vendor` | id, name, services, href?, address? | Vendor gallery / marketing |
| `gallery` | id, title, artist, price ZEC, img?, artist id?, about? | Works for sale in ZEC |
| `artist` | id, name, address?, about? | Artist allow-list for registration |
| `sponsor` | id, name, url?, logo?, tier?, note? | Collaborator listing (see also top-level `sponsors`) |
| `title`, `summary`, `location`, `image`, `start`, `end` | standard NIP-52 | Calendar fields |

`LineupSlot.lane` is the on-chain stage id. `TicketTier.list_cents` is the
authoritative door/list price when a tier exists.

## Sponsors in off-chain metadata

On-chain `EventView.sponsors` stays authoritative: `id`, `handle`, optional `note`, optional `href`.

The metadata document may also name sponsors in two places, used when the contract has no row for that `id` (or to fill `logo` and `tier`, which the contract does not store):

1. A top-level `sponsors` array: `{ id?, name, url?, logo?, tier?, note?, example? }`.
2. NIP-52 tags: `["sponsor", id, name, url?, logo?, tier?, note?]`.

`example: true` marks an invented listing used on a local event when no real sponsor list has been provided. The front end labels those rows as example listings.

The same union rule as raffles applies: on-chain fields win on an id clash.
