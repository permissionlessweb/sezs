# Event manifold module — deterministic API (final thin shape)

Date: 13 November 2026 (Africa/Dakar, UTC+0). Complements **cw-ave** the way a DAO proposal module complements **dao-dao-core**.

The user has answered the design questions. This document is the decided shape, not a menu of options.

**Decided:**

- Tickets on-chain are a commitment / nullifier only. No ticket NFT.
- Programme edits are gated by a **cw420 (cw4) coordinator group**. No custom coordinator map.
- Raffle draw goes through a **pluggable randomness address plus callback**, pending the user’s existing randomness contract. Do not pick Nois. Do not build a randomness contract in this crate.
- Zafu payment supports **both** shielded ZEC (ZIP-321 URI/QR with memo) and UM (Penumbra provider); the guest picks. See `TICKET-PROOF-DESIGN.md`.
- The manifold is a **small companion**: programme data only, pointing at cw-ave for admission.

## Reuse inventory (read this first)

The manifold is a **thin layer that composes existing primitives**, not a new monolith.

### Ticket and door core — reuse `cw-ave`, do not reimplement

Path: `<repo>/e2e/lab/cw-ave/contracts/cw-ave` (plus `cw-ave-factory`).

cw-ave already is the event *core*: curator config, `GuestDetails` / ticket types with `ticket_cost` as `Coin`s, supply limits, `EventSegment` windows, `PurchaseTickets`, homie claims, refunds, and the door source of truth (`UpdateGuestRoot`, `VerifyConsume`, `IsUsher`, `NullifierSpent`).

**Tickets in cw-ave are not CW721 NFTs.** They are commitments in a Merkle `guest_root` plus Poseidon nullifiers at the door. A payment-memo flow (see `TICKET-PROOF-DESIGN.md`) inserts leaf `C = Poseidon(ticketSecret, sku, event_id)` without a buyer Cosmos address. Treating tickets as collection tokens would invent a second source of truth. The manifold *links* (`cw_ave: Option<Addr>`) and may carry a `guest_weight` on a tier so USD-cent display prices can point at an existing guest type. Settlement and consume stay in cw-ave.

`cw420` in the same workspace is a **cw4 group-membership** contract (admin-controlled members), not an NFT. **Ushers already use it. Coordinators reuse it the same way.** The manifold stores the group address and queries `Member` / `ListMembers`. It does not keep its own `COORDINATORS` map.

### NFT / SVG collections — reuse for art, not for admission

| Primitive | Path | What it is | Use for tickets? |
| --- | --- | --- | --- |
| Terp NFT minters / factories | `~/src/terp-core/crates/core-cosmwasm/contracts/nft/{minters,factories}` | Standard Terp CW721 vending / open-edition / base minters and factories | Only if we later want a *souvenir or gallery* collection. Not the door ticket. |
| `cw-svg` | `~/src/terp-core/crates/terp-rs/crates/cw-svg` | Helper for building SVG NFT *collection instantiate payloads* | Same: art collections, not admission. |
| svg-mint-fed / dregg | `~/src/terp-core/crates/terp-rs/tools/svg-mint-deployed` | Checkout + ZEC/EVM watchers + mint-to on Terp | Reuse the *payment runtime* (see `PAYMENT-BACKEND-MIRROR.md`). Do not mint an SVG as the ticket artifact. |
| DAO CW721 voting / roles | `dao-contracts/contracts/voting/dao-voting-cw721-*`, `external/cw721-roles` | NFT-as-voting-power and role NFTs for DAOs | Not a ticket. Pattern only, if a future souvenir collection is staked into a crew DAO. |

Admission stays a cw-ave leaf + QR for the door.

### Randomness — pluggable, pending the user’s contract

The user will point the manifold at **their existing randomness contract**. This crate does not pick an oracle, does not vendor Nois, and does not implement a beacon.

| Primitive | Path | What it actually is | Use for raffles? |
| --- | --- | --- | --- |
| **User-supplied randomness contract** | They will provide the address | Whatever interface that contract already exposes; we adapt a thin callback | **Yes, once pointed.** Until then, `RequestDraw` is pending. |
| Nois (`nois-proxy` + IBC) | Upstream nois-contracts. No proxy is deployed on Terp in this workspace. | Verifiable drand-over-IBC. | **Do not pick it.** Leave the slot abstract. |
| `headstash-randomness` | `~/src/terp-core/crates/terp-rs/crates/randomness` | Off-chain OS/timing entropy. Not an on-chain contract, not a proof. | **No.** |
| `terp-oracle`, `hm-nft-oracle` | `~/src/terp-core/crates/terp-rs/crates/{terp-oracle,hm-nft-oracle}` | **Price** oracles. | **No.** |
| Block hash / committee draw | — | Not a user-supplied verifiable beacon. | **No.** |

`RequestDraw` requires a configured `randomness` address. If none is set, it fails `NoOracle` and does not invent a winner. The callback is accepted only from that address.

### DAO proposal-module pattern — reuse the shape, not the proposal logic

`dao-dao-core` instantiates modules via `ModuleInstantiateInfo`. `dao-proposal-single` stores `dao: Addr` and exposes versioned execute/query with pagination. The event manifold plugs into cw-ave the same way: a small companion with `cw_ave: Option<Addr>`, a cw420 coordinator group, and the query API below. Do not copy proposal, voting, or pre-propose state.

### Payment watchers — reuse svg-mint-fed, do not rewrite

Documented in `PAYMENT-BACKEND-MIRROR.md` and bound to tickets in `TICKET-PROOF-DESIGN.md`. Invoice, ZEC CompactTxStreamer/zrt watch, ETH/Base HD watch, paid phases, admin sessions already exist in that runtime. This pass’s splash loopback *simulates* “mark paid by memo `C`”. Real watchers are still pending.

## Zafu findings (ticket flow)

Zafu is a first-class **Zcash + Penumbra** wallet (Chrome MV3 extension, [rotkonetworks/zafu](https://github.com/rotkonetworks/zafu); local checkout at `~/src/terp-core/crates/zafu`). Shielded by default. Spending keys stay on the device, or on air-gapped **Zigner** (QR only). There is no Zafu backend in the payment path.

**Do not confuse** that wallet with `~/src/terp-core/crates/terp-rs/crates/zafu`, which is an unrelated offline consensus signer.

### What the extension already exposes to a site

- **`window.zafu`** — always injected, Keplr-shaped: `enable(chainId)`, `getKey(chainId)`, `experimentalSuggestChain`, `getOfflineSigner` / `OnlyAmino` / `Auto`, `signAmino`, `signDirect`, `sendTx`. Version string `zafu-0.1`. Reliable dapp path for a Terp address *once Terp is a built-in chain* (it is not, yet).
- **`window.keplr` impersonation** — opt-in, default **off**. Always call `window.zafu` first.
- **`zafu_keystorechange`**.
- **Penumbra Prax-style provider** — `window[Symbol.for('penumbra')]` via `@penumbra-zone/client`. `connect()` / `disconnect()` and a `MessagePort`. This is how a UM checkout talks to Zafu, not by pretending Penumbra is a Cosmos `enable()` chain.
- **ZIP-321** — first-class (`buildZip321` / `parseZip321`) → `zcash:<addr>?amount=&memo=&label=&message=`. Memos are UTF-8 text, for shielded addresses only. Binary memos are not supported. The ticket binding uses memo `sezs1:<hex C>`.
- **ZID / `zafu_sign`** — not required for ticket checkout.

`experimentalSuggestChain` only stores the suggestion in session storage. It does **not** add Terp to the signer registry. `signAmino` / `signDirect` reject unknown chain ids. Terp as a built-in Zafu chain is still pending. Ticket purchase on ZEC / UM does not need a Terp address.

### Guest flow (Zafu-first)

1. Header sign-in offers Zafu first, then Keplr, then this browser + passkey. Signing in is **not** a ticket and is **not** required to buy.
2. The guest picks a rail first. Only that rail’s details show. The price ring moves to its price (USD cents from this API).
3. This browser generates the ticket secret and commitment `C` (see `TICKET-PROOF-DESIGN.md`).
4. **Shielded ZEC:** a lab or svg-mint-fed invoice returns a testnet/regtest unified address and a ZIP-321 URI whose memo is `sezs1:<C>`. The page shows the URI as a QR and an “Open in Zafu” link. Mainnet UAs are refused.
5. **Shielded Penumbra (UM):** the same memo is offered with a testnet destination, plus a connect through the Prax provider when present. The guest picks ZEC or UM; both are supported.
6. **ETH / Base:** EVM invoices remain in the payment-backend plan; the rail is listed, checkout opens soon.
7. **Door Cash App** stays off the pre-arrival page.
8. Watcher confirms the amount, records paid without identity, inserts `C` into `guest_root`. The holder keeps the secret as a printable QR (`/ticket`).

## Why a module, not a fork of cw-ave

cw-ave already is the event *core* for money and the door. It does **not** hold the public programme: lineup slots (handles, not legal names), a reusable timeline, sponsors, USD-cent tiers with per-rail discounts, or raffle metadata. Those belong in this companion so the front end can be reused across events, and so cw-ave stays the settlement/door crate.

| DAO suite | Event suite |
|---|---|
| `dao-dao-core` holds modules, admin, pause | `cw-ave` (+ factory) holds commitments, payments, door, ushers |
| `dao-proposal-single` stores `dao: Addr` | `cw-event-manifold` stores `cw_ave: Option<Addr>` and a cw420 `coordinators` group |
| Versioned execute/query + pagination | Versioned execute/query (`api = 1`) + `start_after` / `limit` |

The front end talks only to this query API (or a local fixture that returns the same types). It never hard-codes an event date, artist legal names, sponsor copy, or ticket prices.

Types in the app: `apps/sezs/src/event/api.ts`. The Rust crate lives next to cw-ave in sezs-lab (`cw-event-manifold`). **Not deployed.** Testnet/local only.

## Versioning

Every aggregate and leaf response carries `"api": 1`. A breaking change increments `api` and adds a new query (the v1 queries remain). Clients ignore unknown fields.

The fixture event id is `speakez-sessions` (stable string for the consume circuit). Start: 16 January 2027, 19:00 America/New_York.

## Queries

Pagination: `start_after` is the last seen `id` (string); `limit` defaults to 30 and is capped at 100. Responses include `total` where cheap.

| Query | Returns | Notes |
|---|---|---|
| `ApiVersion {}` | `{ api: 1, cw_ave?: Addr }` | |
| `EventInfo {}` | `EventInfo` | `id`, name, status, start/end (RFC 3339), timezone, **`domain`** (origin URL that site-scoped ZID keys and ticket signatures bind to), optional `door_auth_pubkey` (32-byte ed25519 of the event door-auth key). Venue is **not** in this response. |
| `Venue {}` | `VenueView` | Always `{ revealed: false, note }` for a bare query. Location is for ticket holders. |
| `VenueForHolder { commitment, proof }` | `VenueView` | Reveals `label` when the proof shows knowledge of the secret for a paid leaf (or a consume-eligible ticket). Scaffold accepts the field; verification lands with the door wiring. Do not require a `ticket_addr`. |
| `Lineup { start_after?, limit? }` | `{ items: LineupSlot[], total }` | Slots: `id`, `index`, `role`, `handle` (or `ref`), `start`, `duration_min`, `lane`. No legal names. |
| `Timeline { start_after?, limit? }` | `{ items: TimelineItem[], total }` | May point at a `slot_id`. Untimed items set `untimed: true`. |
| `Sponsors { start_after?, limit? }` | `{ items: Sponsor[], total }` | On-chain: `id`, `handle`, optional `note`, optional `href`. Off-chain metadata may also list `sponsors: [{ name, url, logo, tier }]` or NIP-52 `sponsor` tags; the front end unions both, and the contract wins on id clash. `logo` and `tier` come from metadata only. |
| `Tiers {}` | `{ items: TicketTier[] }` | `list_cents` (USD), `discounts_bps` per rail (ZEC and Penumbra UM = 5000), `supply`, `sold`, `rails`, optional `guest_weight`. |
| `Raffles { start_after?, limit? }` | `{ items: RafflePrize[], total }` | |
| `Raffle { id }` | `RafflePrize` | Draw status, `winner_index` (0-based into the paid-commitment list), `proof_href` when the oracle has returned, optional winning leaf. |
| `PaidLeaves { start_after?, limit? }` | `{ items: HexBinary[], total }` | Ordered paid commitments. No names. Used as raffle entries (1 ticket = 1 entry). |
| `WinningLeaf { id }` | `{ commitment }` | The leaf at `winner_index`, once drawn. |
| `Roles {}` | `{ curators, coordinators, ushers, coordinators_group }` | Coordinators are **read from the cw420 group**, not from a local map. Ushers may be mirrored from cw-ave / its cw420. |
| `Manifold {}` | `EventManifold` | Aggregate for a first paint. Prefer paged queries for large lineups. |

### Ticket price

`price_cents(tier, rail) = floor(list_cents * (10_000 - discounts_bps[rail] or 0) / 10_000)`.

Rails: `zec`, `penumbra` (shielded UM), `eth`, `base`. Cash App is door-only and is not a pre-arrival rail. Fixture: $40 list, 50% off ZEC and UM, ETH/Base at list.

### Raffle draw and winner claim

Entries are **derived from paid (or, after the night, consumed) commitments**: each inserted leaf `C` is one entry, in insertion order, index `0..n-1`. Holders are not revealed. Coordinators do not type a raw entry count by hand once leaves are registered; `entries = len(paid_leaves)`. A leaf can be registered by the trusted payment watcher (`RegisterPaidLeaf`) when a memo payment is marked paid.

Draw:

1. Coordinator `CloseRaffle { id }` freezes the entry list (or `RequestDraw` auto-closes).
2. `RequestDraw { id }` requires a configured `randomness` address. It asks that contract for a beacon tagged with `job_id = "{manifold}/{id}/{draw_nonce}"`. The exact execute toward the randomness contract is a thin adapter, filled in when the user points at their contract. Until then the message fails `NoOracle`.
3. Only the configured `randomness` address may call `RandomnessReceive { job_id, randomness }`. On a valid callback, `winner_index = int_in_range(randomness, 0, entries)` (half-open). The beacon (or a link to it) is stored. The contract does not invent a winner without that callback.
4. Status: `open` → `closed` (entries frozen) → `drawn`.

**How a winner claims.** Publishing the ordered list of `C` (or just the winning `C`) does not identify a person, but `C` itself becomes public. Anyone can copy it. A claim must therefore prove **knowledge of the ticket secret** such that

`Poseidon(secret, sku, event_id) = leaves[winner_index]`.

Do **not** put the door secret in a claim transaction: that would let a watcher or a chain observer consume the same ticket if the door is still open, and it would link the raffle claim to the door QR.

The intended claim (not fully implemented in this scaffold) is:

- The holder builds a knowledge proof (a Halo2 preimage proof, or a dedicated raffle nullifier `Poseidon(secret, event_id, raffle_id)` plus a proof that the corresponding leaf is at `winner_index`).
- `ClaimPrize { id, raffle_nullifier, proof }` verifies that proof, marks the prize claimed for that leaf, and never stores the secret.

Until that proof is wired, `ClaimPrize` is present on the crate and returns `knowledge_proof_pending`. The holder can still *see* that they won: they recompute their `C` and compare it to `WinningLeaf`. Coordinators must not “pay out” on a copied `C` without the knowledge proof.

## Execute messages

All mutating messages except `RandomnessReceive` require the sender to be the **curator** or a **member of the cw420 coordinator group** (weight > 0). Ushers cannot edit the programme. There is no `AddCoordinator` / `RemoveCoordinator` on this contract — membership is edited on the group itself.

| Message | Who | Effect |
|---|---|---|
| `UpdateEventInfo { id?, name?, status?, start?, end?, timezone? }` | curator | Public event facts. |
| `SetDomain { domain, door_auth_pubkey? }` | coordinator | Origin URL (scheme + host + optional port, no path/query). Site-scoped ZID keys and ticket signatures bind to this value. Optional 32-byte door-auth public key used by printed authorizations. |
| `SetVenue { label }` | curator | Stored hidden; revealed only via `VenueForHolder`. |
| `SetCwAve { addr }` | curator | Link or unlink the door/ticket core. |
| `SetCoordinators { addr }` | curator | Point at a cw420 (cw4) group. |
| `SetRandomness { addr }` | curator | Point at the user’s randomness contract. Pending until they do. |
| `UpsertLineupSlot { slot }` / `RemoveLineupSlot { id }` | coordinator | `index` is the stable order key. |
| `UpsertTimelineItem { item }` / `RemoveTimelineItem { id }` | coordinator | |
| `UpsertSponsor { sponsor }` / `RemoveSponsor { id }` | coordinator | |
| `UpsertTier { tier }` / `RemoveTier { id }` | curator | Price and rails are curator-only. `sold` is written by the payment watcher, not by hand. |
| `RecordSale { tier_id, count }` | curator / watcher | Increments `sold`. |
| `RegisterPaidLeaf { commitment }` | curator / watcher | Appends `C` to the entry list (32-byte leaf). No identity. |
| `RegisterRafflePrize { prize }` | coordinator | |
| `CloseRaffle { id }` | coordinator | Freezes entries from the current paid-leaf count. |
| `RequestDraw { id }` | coordinator | Requires `entries > 0`, status `closed` or `open` (auto-closes), and a configured randomness address. |
| `RandomnessReceive { job_id, randomness }` | the configured randomness contract only | Completes the draw. |
| `ClaimPrize { id, raffle_nullifier, proof }` | anyone with a valid knowledge proof | Scaffold: `knowledge_proof_pending`. |

Ticket *purchase* (memo path or `PurchaseTickets`) and *consume* stay on **cw-ave**.

## Front-end client

`src/event/client.ts` exposes one reader:

- **chain** — LCD `WasmSmart` against `NEXT_PUBLIC_SEZS_EVENT_CONTRACT` (testnet or local LCD only; mainnet origins refused).
- **fixture** — deterministic local record, also served by the splash backend at `GET /__splash/api/event`, used until a contract instance exists.
- **none** — no address and fixture disabled: pages show an honest empty state, not invented content.

Visible copy is formatted from these types (`formatWhen(start)`, handles, tier prices). The fixture uses handles `Artist 01`… and does not contain “October 18” or legal artist names.

## Status of this drop

- Types and queries: specified; TypeScript client already shipped; Rust crate implemented as a thin scaffold in sezs-lab. **Not deployed. No mainnet. No GitHub push.**
- Randomness contract pointer: **pending the user.** `RequestDraw` stays `NoOracle` until they set it.
- Ticket proof binding, ZIP-321 / Penumbra memos, `/ticket`, door consume, and splash “paid by memo C”: see `TICKET-PROOF-DESIGN.md`.
- Real svg-mint-fed watchers, Halo2 prove at the door, and Terp-as-built-in-Zafu-chain: still pending.


## Contract domain and door-auth key

The event record carries a `domain` origin (`http://` or `https://`, host and optional port, no path). Site-scoped ZID keys and ticket consent signatures always bind to this value, not to whatever origin a browser happened to load. The lab fixture uses `http://127.0.0.1:3051`. Coordinators set or rotate it with `SetDomain`. `door_auth_pubkey` is the global event door-auth public key that a printed ticket pre-authorizes.
