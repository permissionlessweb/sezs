# Payment backend mirror — svg-mint-fed → Speakez Sessions tickets

Read-only study of the existing nft / svg mint checkout runtime. No implementation in this pass. No secrets, cookie paths, or key files are recorded here.

**Source studied:** `~/src/terp-core/crates/terp-rs/tools/svg-mint-deployed/crates/svg-mint-fed` (the nft-svg-dregg-fed / dregg-svg-mint-fed runtime). House bind is `127.0.0.1:8421`. The crate is a single large `main.rs` with price, pay-target, watcher, entitle, settle, and admin sessions.

Terp mainnet is reported halted. Nothing in this plan should touch mainnet.

## What the runtime already does

| Area | How svg-mint-fed works | Reuse |
| --- | --- | --- |
| Bind | Loopback only. Health at `/health`. | Same rule for ticket checkout. One process, `127.0.0.1`. |
| Prices | `/v1/prices` — live quotes used to size invoices. | Reuse the quote path. Ticket price is `list_cents` minus the selected rail's `discounts_bps` from the event manifold, then converted with the same quote. |
| Pay targets | `/v1/pay-targets` issues a unique deposit address (or Unified/shielded payment URI) per checkout, with a memo. ZEC uses a Pedersen memo so the watcher can match the invoice without publishing the guest. | Reuse almost as-is. One invoice per ticket (or per cart). Store `invoice_id`, rail, amount, address, memo, expiry against the selected `tier_id`. |
| ZEC watch | CompactTxStreamer / zrt (not zcashd wallet RPC as the observer). Confirms once the memo/amount land. | Reuse the watcher loop. Ticket checkout should not invent a second ZEC indexer. |
| ETH / Base watch | HD-derived addresses, chain RPC confirmations. | Reuse. Ticket rails `eth` and `base` map 1:1. |
| BTC watch | Present in the mint runtime. | Not a Speakez Sessions rail. Leave unused. |
| Penumbra (UM) | Not first-class in the mint runtime. | New work. Either a compact-client watcher or a trusted viewing path. Estimate below. |
| Paid query | `/v1/query/paid` returns deposit state. | Reuse as the ticket "have you paid?" endpoint. |
| Deposit / entitle / settle | Paid phases: Deposited → Entitled → Settled. Entitle is the off-chain acknowledgement; settle is the on-chain mint (`dregg::mint_tx`) onto Terp. | Map to: Deposited (watcher saw funds) → Entitled (ticket record issued, QR minted off-chain) → Settled (`RecordSale` on the event manifold and/or `PurchaseTickets` / guest-root update on cw-ave). |
| Wallet & admin | Admin ADR-036 / zid sessions. Operator can query the house ZEC wallet and drive entitle/settle. Never expose keys to the guest UI. | Reuse the session model for ushers and coordinators. Guest flow stays invoice + watch + ticket artifact. |
| Terp interaction | After settle, a CosmWasm execute mints the collection item. | For tickets: CosmWasm execute on the linked `cw_ave` (guest root / ticket record) and `RecordSale { tier_id, count }` on `cw-event-manifold`. Same signing path, different messages. |

## Mapping onto ticket checkout

```
Guest picks a rail (ZEC / UM / ETH / Base)
        ↓
Front end asks splash/checkout for an invoice
        ↓
svg-mint-style /v1/pay-targets  →  unique address + amount + memo + expiry
        ↓
UI shows only that rail's details (URI, amount, QR)
        ↓
Watcher (existing ZEC / EVM loops; new UM loop) confirms
        ↓
/v1/query/paid  →  Deposited
        ↓
Entitle: issue ticket artifact + door QR (off-chain, bound to the invoice)
        ↓
Settle: sign RecordSale + cw-ave purchase / guest_root update on Terp testnet or local
```

Cash App stays door-only and is not a pre-arrival rail. Do not issue a pay-target for it.

Venue stays hidden until a holder proof exists. The ticket QR is what the usher scans; it is not the venue.

## What is reusable versus new

**Reusable with light adapters (about 3–5 days, if the crate can be depended on from a ticket binary):**

- Loopback HTTP surface, health, prices, pay-targets, query/paid.
- ZEC CompactTxStreamer / zrt watch and memo match.
- ETH / Base HD watch.
- Admin session shape (not the key material).
- Paid-phase state machine.

**New, but mechanical (about 4–6 days):**

- Invoice table keyed by ticket / cart, tied to `tier_id` and selected `rail`.
- Entitle that writes a ticket artifact (token + QR payload for the door) instead of an NFT SVG.
- Settle that calls `RecordSale` and the cw-ave purchase path instead of `dregg::mint_tx`.
- Front-end payment-method-first UI already specified in the app; it just needs these endpoints live.

**New and uncertain (about 1–2 weeks, or deferred):**

- Penumbra (UM) watcher. The mint runtime does not already watch UM. Options: a compact client, a viewing-key path under admin, or "UM checkout opens when a watcher exists." Do not pretend it is live.
- Charity routing of proceeds. Not in svg-mint-fed. Needs a policy and a payout path.
- Holder proof for `VenueForHolder` and production door FROST / consume-VK wiring (already flagged in the gap audit). Out of scope for a payment-mirror, but settle should not be called complete until the door can consume the ticket it just issued.

## Effort, honestly

| Slice | Estimate | Notes |
| --- | --- | --- |
| Extract or wrap svg-mint-fed as a ticket checkout binary, loopback only | 2–3 days | Prefer wrapping over a rewrite. Keep 127.0.0.1. |
| Invoice ↔ manifold `tier_id` / rail / amount | 1 day | Price comes from the event API, not a hard-coded cent value. |
| ZEC + ETH/Base watch reuse + `/query/paid` | 1–2 days | Mostly config and invoice matching. |
| Entitle: ticket artifact + QR | 2–3 days | New artifact format; do not reuse SVG mint output. |
| Settle: RecordSale + cw-ave (testnet/local only) | 2–3 days | Mainnet is off limits. |
| Penumbra watcher | 5–10 days or defer | Say "opens when the watcher exists" until it does. |
| Admin / usher session for paid + door | 2 days | Mirror existing admin sessions. |
| End-to-end on testnet/local, no mainnet | 2–3 days | Splash board already has rehearsal paths. |

A straightforward reuse of the HTTP + ZEC + EVM core is realistic in about two weeks of focused work, not counting UM or charity routing. A rewrite would be longer and is not justified.

## What this pass does not do

- Does not implement the backend.
- Does not start a second proxy, a tunnel, or a mainnet signer.
- Does not copy env, cookie, or key paths out of the mint runtime.
- Does not invent raffle winners or mark tickets paid without a watcher confirmation.

## Open questions

1. Should ticket checkout be a thin wrapper crate next to svg-mint-fed, or a new binary in `sezs-lab` that depends on the same libraries?
2. Who signs `RecordSale` / cw-ave purchase — the same admin session as mint, or a dedicated ticket curator key?
3. Is Penumbra required at first door, or can UM stay listed as a rail whose checkout is not live until a watcher exists?
4. Does entitle happen before or after the on-chain settle? The mint runtime entitles off-chain first. Tickets used at the door probably need the artifact earlier than the chain tx, with settle catching up.


## Zafu in the checkout (added after wallet research)

Zafu already parses and builds ZIP-321 `zcash:` payment request URIs (address, amount, memo, label, message) and shows them as a copyable link / QR in its receive sheet. Ticket invoices for the ZEC rail should be emitted in that format so a guest can open the request in Zafu (and cold-sign with Zigner) without a custom wallet RPC.

Penumbra checkout, when a watcher exists, should use Zafu's Prax-style `window[Symbol.for('penumbra')]` provider, not the Cosmos `window.zafu.enable` path.

Site login uses `@zafu/zid`, not `window.zafu`. `window.zafu` is the Cosmos provider for on-chain consume (Keplr-shaped, always on). `window.keplr` inside Zafu is opt-in and off by default, so the site must not rely on it. Keplr is not a sign-in option.

See the Zafu section at the top of `EVENT-MANIFOLD-API.md`.
