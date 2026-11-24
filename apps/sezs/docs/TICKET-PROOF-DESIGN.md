# Ticket proof design — payment memo bound to a cw-ave leaf

Date: 13 November 2026 (Africa/Dakar, UTC+0).

This extends the existing ticket work (cw-ave `guest_root` / `VerifyConsume` / `NULLIFIERS`, the `sezs_consume` Halo2 circuit, browser checkout, the door panel, and ephemeral keys). It does not replace them, and it does not introduce a ticket NFT.

## Decision, in one page

1. The buyer’s browser generates a 32-byte ticket secret locally. The secret never leaves the holder’s device (except when they print or show the QR at the door).
2. The commitment is the same Merkle leaf the consume circuit already uses:
   `C = Poseidon(ticketSecret, sku, event_id)`
   as a 32-byte Pallas Fp, little-endian. The sku is the manifold tier id (for Speakez Sessions, `ga`). The event id is a stable string (fixture: `speakez-sessions`).
3. `C` is placed in the payment memo — a UTF-8 shielded memo `sezs1:` + 64 lowercase hex characters — on the ZEC ZIP-321 URI, or in the Penumbra memo for UM. That is the binding between payment and ticket.
4. A backend watcher (the svg-mint-fed mirror; today the splash loopback) sees the payment, checks the amount against the tier and the 50% ZEC/UM discount, records paid **without identity**, and inserts `C` into the Poseidon guest tree. On testnet or local only, a coordinator / backend key calls cw-ave `UpdateGuestRoot`.
5. The holder keeps the secret as a printable QR and/or in-wallet. The QR is what the usher scans.
6. At the door, the usher scans the QR. The consume path derives the nullifier `N = Poseidon(ticketSecret, event_id)` and checks it. A second scan is refused. The door does not learn who paid.

The brief wrote `C = H(secret, event_id, tier)`. That argument order does **not** match the circuit. The circuit, and this design, use `Poseidon(ticketSecret, sku, event_id)`. sku comes before event_id. The hash is the SEZS Poseidon-128 over Pallas Fp (t=3, α=5, RF=8, RP=56), not SHA-2, not Sinsemilla, not Pedersen.

## What is on-chain (cw-ave)

| Item | Where | What it is |
| --- | --- | --- |
| `guest_root` | `Config` | Poseidon Merkle root (depth 8 in the lab = 256 leaves) of paid ticket commitments `C`. Empty leaf = 0. Parent = `Poseidon(left, right)`. |
| `C` itself | inside the tree, not as a public map of identities | A field element. Not a name, not a wallet, not an NFT. |
| Spent set | `NULLIFIERS` map | Door nullifiers `N = Poseidon(ticketSecret, event_id)`, written by `VerifyConsume`. |
| Programme pointer | event manifold `cw_ave` | The manifold stores lineup, timeline, sponsors, USD-cent tiers, raffle metadata. It does not store tickets. |
| Coordinator group | cw420 (cw4), referenced by the manifold | Who may edit programme data and, on testnet/local, who may post `UpdateGuestRoot`. No custom coordinator map. |
| Usher group | already on cw-ave via cw420 | Who may run the door. |
| Ticket NFTs | **none** | Admission is a leaf + nullifier only. |

`PurchaseTickets` / `ticket_addr` guest records remain available for other settlement paths. The memo-bound flow does not require a buyer Cosmos address and does not mint a CW721.

`VerifyConsume { proof, nullifier, event_id }` stays the production door check. Public Halo2 instances are `[guest_root, nullifier, event_id]` as 32-byte Pasta Fp LE. The proving key / VK live in `sezs-zk-cw-orch/artifacts` (`sezs_consume_vk.bin`). This pass does not ship a browser Halo2 prover. The splash loopback checks the same relation (paid `C`, unused `N`) and does **not** claim a SNARK was verified.

## What the backend stores

The payment record is maintained in the backend (splash today; svg-mint-fed later). It must not store the ticket secret. It must not store names, emails, or buyer wallet addresses beyond what a watcher operationally needs.

Stored per invoice / payment:

- invoice id
- rail (`zec` or `penumbra`; later ETH/Base)
- tier id (sku) and event id
- expected amount (USD cents, and the chain amount once a quote exists)
- commitment `C` (32-byte hex), copied from the memo
- deposit destination (a unique lab/testnet address, so the watcher can match a payment to an invoice)
- status (`pending` / `paid` / `void`), paid timestamp, and a payment txid when the real watcher sees one
- leaf index in the guest tree, once `C` is inserted
- door nullifier `N` only after consume (the spent flag). The backend may also derive `N` at consume time from the scanned secret and then forget the secret.

Not stored:

- the ticket secret
- buyer names, emails, phone numbers
- buyer ZEC / UM / Terp addresses, except the *operator* deposit address issued for that invoice
- IP / session identifiers as a join key to `C` (minimize; do not require sign-in to buy)

Unique deposit addresses are operationally necessary for a watcher. They can correlate “this invoice was issued at this time” with `C` for the operator. That is a backend-side linkage, not an on-chain identity, and it must not be published.

## What is in the QR

The printable ticket / in-wallet QR encodes a URI the door can parse, not just a nullifier (the nullifier is derivable, the secret is not recoverable from it).

```
sezs1://ticket?e=<event_id>&t=<sku>&k=<64-hex-secret>
```

- `e` — event id (`speakez-sessions`)
- `t` — sku / tier id (`ga`)
- `k` — the 32-byte ticket secret, lowercase hex, already masked so the top two bits of the last byte are clear (`b[31] &= 0x3f`), matching `Fp::from_bytes`

`C` can always be re-derived from those three fields. The QR may also display `C` as text for the holder to compare with a memo, but `C` alone is not enough to enter: the door needs the secret.

The payment memo is a different string, meant for a shielded transaction:

```
sezs1:<64-hex-C>
```

Zafu memos are UTF-8 text only (binary memos are not supported). This encoding is ~69 characters, well under the 512-byte memo limit.

## Memo, rails, and Zafu

The guest picks the rail. Zafu is first for the shielded rails.

- **ZEC:** the lab or svg-mint-fed invoice returns a ZIP-321 `zcash:` URI whose address is a testnet / regtest unified address (`utest1` / `uregtest1` only; mainnet `u1` is refused; `zcash://` is refused). The memo query parameter carries `sezs1:<C>`. The page shows the URI as a QR and an “Open in Zafu” link. There is no site-initiated send in this pass.
- **UM (Penumbra):** the invoice returns a testnet destination (`penumbratest1` / `plmt1` / `penumbrat1`; mainnet `penumbra1` is refused) plus the same memo text. The page offers a connect through `window[Symbol.for('penumbra')]` when the provider is present. Until a real UM watcher exists, the loopback watcher records a test payment against that memo.
- **ETH / Base:** still “checkout opens soon” in this pass (watchers are in the payment-backend plan, not wired here).
- **Cash App:** door only, not a pre-arrival rail.

Sign-in is not a ticket. A ZEC or UM purchase does not require a Terp address.

## Door

1. Usher (cw420 / splash usher session) scans or pastes the QR payload.
2. The door parses `e`, `t`, `k`, derives `C` and `N`.
3. It checks: `C` is a paid leaf (in the backend guest list / tree, and on-chain `guest_root` once posted); `N` is not in `NULLIFIERS`.
4. Production: the usher device or a local prover builds the Halo2 consume proof and cw-ave `VerifyConsume` writes `N`. This pass’s splash path does the membership + unused-nullifier check only, and says so. **v1 lock-in (see `DOOR-PRIVACY-DECISION.md`):** Halo2 `VerifyConsume` is not required for door admission. The lab door verifies a holder consent signature (live challenge or printed pre-authorization), a paid `C`, and an unused `N`. A raw secret QR is refused. The circuit and VK stay in-tree as an optional later path. The older AvEvents ADR-036 / `ticket_addr` handshake does not apply to commitment tickets.
5. A second scan of the same QR derives the same `N` and is refused (`already_used`).

The usher momentarily sees the secret (it is in the QR). Consume must be immediate so a shoulder-surfed QR cannot be replayed at another door after a successful admit. The usher device must not log the secret.

## Recovery if the QR is lost

There is none from the backend. The secret is the ticket. If it is lost and no copy exists (print, second device, or a later in-wallet backup), no one can derive a consume proof, and the paid leaf sits unused. The operator must not reconstruct secrets, and must not keep a recovery copy of `k`.

A later, optional encrypted backup in the holder’s own wallet (Zafu / Zigner) is compatible with this design. A coordinator “reissue” would require a new secret, a new `C`, a policy for the old leaf, and is out of scope here.

## Privacy properties

- On-chain observers see a Merkle root and, at the door, a nullifier. They do not see the payer, the memo, or a ticket NFT.
- The payment chain (ZEC / UM) already hides the payer behind a shielded send. The memo binds that send to `C` without putting a name in the memo.
- The backend knows `C`, amount, rail, and an operator deposit address. It does not know the secret, and it should not know who the buyer is.
- The door learns the secret at scan time, derives `N`, and should forget `k`. A spent `N` does not by itself reveal which payment paid for that leaf to a public observer (the `C` ↔ `N` link requires the secret).
- The operator *can* join invoice metadata to `C` (and, after a scan, to `N` if they retained the scanned secret — they must not). Threat: a curious operator, or a leak of the invoice table, plus network logs from invoice issuance, could narrow a buyer. Mitigations: no sign-in to buy, no email, unique addresses without KYC, short log retention, no secret at rest.

## Threat notes

- **Stolen QR / stolen phone:** whoever has `k` can enter once. Treat the printed ticket like cash.
- **Memo omission or wrong memo:** the watcher must not mark paid unless the memo decodes to a 32-byte `C` and the amount matches the tier / rail discount. A payment with no memo is not a ticket.
- **Amount mismatch:** underpayment is refused. The 50% ZEC / UM discount is computed from the manifold list price; splash / the real watcher re-check it.
- **Replay:** `N` is the anti-replay tag. Splash and cw-ave both refuse a second consume.
- **Usher sees `k`:** consume immediately; no logs of `k`; prefer a camera path that does not paste the secret into a shared clipboard.
- **False “paid” in the browser:** a localStorage flag is not admission. Only a paid `C` in the guest list / `guest_root`, plus an unused `N`, admits.
- **Lab destinations:** splash issues `uregtest1` / `utest1` and `penumbratest1` addresses only, clearly labeled as lab destinations. Do not invent a mainnet UA. Do not send real funds to lab invoices.
- **Coordinator key:** `UpdateGuestRoot` on testnet/local uses a coordinator / backend key. That key can insert an unpaid `C`. Operational policy and the payment record are what keep the tree honest until a tighter hook exists.
- **Halo2 fail-closed:** cw-ave `verify_halo2_proof` fail-closes without zk-wasmvm. Do not pretend a local membership check is a verified proof.
- **Raffle / published leaves:** paid `C` values that are listed as raffle entries are public. A winner must prove knowledge of the preimage, not merely copy `C` off the list. Do not post the door secret in a claim transaction (see EVENT-MANIFOLD-API.md).

## Local loopback (this pass)

Splash simulates the watcher:

- `POST /__splash/api/invoice` — `{ commitment, rail, sku, eventId }` → lab destination, memo, ZIP-321 URI when rail is ZEC, expected cents.
- `POST /__splash/api/watch/pay` — mark paid *by memo `C`*, check amount, append `C` to the guest tree.
- `GET /__splash/api/paid?c=` — paid or not, no secret.
- `POST /sezs/door/consume` — accepts a QR payload or `{ secret, eventId, sku }`, derives `N`, admits once, refuses replay.

Visible guest copy does not use the words mock, placeholder, lorem, or TODO. The test payment control appears only on the loopback watcher.

## Still pending

- Real svg-mint-fed ZEC CompactTxStreamer and Penumbra watchers (see PAYMENT-BACKEND-MIRROR.md).
- Posting `UpdateGuestRoot` from the watcher with a testnet/local coordinator key (not mainnet; Terp mainnet is reported halted).
- Browser or usher-device Halo2 prove → cw-ave `VerifyConsume`.
- The user’s existing randomness contract pointer, for raffle draws.
- Terp as a built-in chain in Zafu (`experimentalSuggestChain` is not enough).
- Optional in-wallet encrypted backup of `k`.

## Phase 2 (14 November 2026)

Purchaser browsers now derive `ticketSecret` as a domain-separated HKDF of a
fresh CSPRNG seed plus `event_id`, `sku`, and a per-purchase nonce — never from
a payment key. Recovery is a ZID sealed envelope (ciphertext only on the
backend). The firm backend role is in `BACKEND-ROLE.md`.
