# Ticket backend role

> The live ticket, session, email, and payroll HTTP processes are the Rust
> `sezs-server` crate (one 127.0.0.1 bind, default port 3058). Guards that
> refuse secret fields live in `apps/sezs/src/ticket/guards.mjs`. This note
> describes the role those processes still must honour.


Date: 14 November 2026 (Africa/Dakar, UTC+0).

This is a firm rule. The ticket backend never learns the ticket secret. If a
design, a debug session, or a new endpoint would require the backend to
generate, receive, log, or decrypt that secret, the design is wrong. See also
`TICKET-PROOF-DESIGN.md`, `ZAFU-ZID-ZIRC-TICKETS.md`, and
`DOOR-PRIVACY-DECISION.md`.

The leaf format is unchanged: the browser derives `ticketSecret`, then

- `C = Poseidon(ticketSecret, sku, event_id)`
- `N = Poseidon(ticketSecret, event_id)`

The payment memo carries only `sezs1:<hex C>`. Signing in is not a ticket.

A ticket signing key is derived from the same secret by a second,
domain-separated KDF (`sezs-ticket-sign-v1`, bound to `event_id` and the
contract `domain`). Only the **public key** is sent to the backend, alongside
`C` and `N`, at invoice time. The public key is not inserted into the
Poseidon leaf.

Site-scoped ZID keys bind to that same contract `domain` (lab:
`http://127.0.0.1:3051`).

## What the backend does

1. **Issue a lab or testnet invoice** for a rail, a 32-byte commitment `C`,
   a ticket public key, and the holder-computed nullifier `N`. It quotes a
   lab destination and a memo that already contains `C`. It does not invent
   `C`, `N`, the public key, or a secret.
2. **Watch payments** (in this lab, a loopback watcher). It matches the memo
   commitment `C` to the invoice and the quoted amount. Amount mismatch is
   refused.
3. **Append `C` to the guest list** when payment is confirmed, and may
   publish `guest_root`. The leaf is `C`, not a name, not a wallet, not a
   ZID. `guest_root` is an audit / raffle anchor. It is not required to
   admit a guest in v1, and it is not a verified Halo2 instance.
4. **Store a ciphertext blob** keyed by `C` and/or invoice id, when the buyer
   (or a later holder) posts a ZID sealed envelope. The backend stores
   ciphertext, ephemeral pubkey, `pq_epoch`, suite, and origin only. It cannot
   open the box.
5. **Admit at the door only with holder consent**, then record `N`.
   - Live: the door issues a challenge (`event_id`, `domain`, session nonce,
     usher public key, timestamp). The holder signs it with the ticket key.
     The door posts the signature and the ticket public key. The backend
     verifies the signature against the public key registered at purchase,
     checks that `C` is paid and `N` is unused, records `N`, and drops the
     signature material from logs.
   - Printed: the QR is a pre-signature over `(event_id, domain, the
     contract’s door-auth public key, sku)`. Any authorized door for this
     event may admit it once. Paper is bearer: anyone with the print can
     present it. That is the consent given when the holder prints.
   - A raw secret QR (`sezs1://ticket?k=…`) is refused. The secret is not
     consent. The backend still must not persist or log a secret if one is
     submitted by mistake.

This loopback checks the signature, the paid leaf, and an unused nullifier.
It does not verify a Halo2 proof. See `DOOR-PRIVACY-DECISION.md`.

## What the backend must never do

- Generate a ticket secret, or any seed used to derive one, or a ticket
  signing key.
- Receive a field named `secret`, `secretHex`, `k`, `seed`, `plaintext`, or
  any synonym on an invoice, payment, envelope, or admin API. Those requests
  are refused. The door may accept a presentation string in `ticket` (a live
  approval, a printed authorization, or a mis-pasted QR); it still must not
  persist or log a secret or the raw QR, and a secret-bearing QR is not a
  valid admit.
- Decrypt a sealed envelope, or hold a key that could.
- Link a ZID, a name, a login, or a payer address to `C`. Buyer payment
  addresses are not stored. Site-scoped ZID pubkeys are used only when a
  holder is registering as an usher for chat, and they are not written onto
  the guest list. The ticket public key registered at purchase *is* a
  correlator from consume back to `C`; that is an accepted v1 trade so the
  door can verify consent without the secret.
- Put ticket secrets, QR payloads, seeds, or signing keys into usher chat,
  logs, or analytics.

Code-level guards live in `src/ticket/guards.mjs` (re-exported from
`dev/splash/guards.mjs`) and are asserted in `dev/splash/lib.test.mjs` and
the ticket e2e suite. The payment watcher (`dev/splash/ticket-pay.mjs`) and
the live HTTP surface (`crates/sezs-server`) point here so no team member
misreads the backend as a holder of tickets.

## Ticket v2 (supersedes the v1 door above once the front end switches)

Spec: `TICKET-V2-SPEC.md`; hand-off: `TICKET-V2-INTERFACE.md`. Code:
`dev/splash/ticket-v2.mjs`, `dev/splash/root-publisher.mjs`.

- **Invoice carries only `C`** (plus rail, sku, event). The backend no longer
  receives `N` or a ticket public key: an invoice body with `ticketPubkey`,
  `nullifier`, `rk`, or a synonym is refused (`v2_no_correlators`). So the
  backend cannot link a consume back to a purchase.
- **Guest tree.** A paid `C` is appended to a depth-10 Poseidon
  (`P128Pow5T3`) tree. The leaf list is public at `GET /sezs/v2/leaves`; a
  holder downloads it and proves membership in the browser.
- **Root publisher.** The principal admin FROST set publishes `guest_root`
  with `UpdateGuestRoot { root, leaf_count, epoch }`, broadcast from this
  runtime: every 15 minutes when the root changed, and immediately at doors-open
  (also sales-close / force). Epochs only increase; the contract keeps every
  root. In the lab a keyring key on a loopback node stands in for the FROST set.
- **Backups by invoice id.** Sealed envelopes are stored and fetched by invoice
  id only, not by `C`.
- **The door no longer touches the backend.** An usher (lower-authority cw420
  member) submits `ConsumeTicket`; the contract verifies the Halo2 proof and
  the holder's RedPallas consent and records `N`. The backend never sees `N`,
  `rk`, the proof, or the consent signature.

The rules under "What the backend must never do" still apply in full.

## Transfer

A holder may decrypt an envelope in their own wallet (or lab ZID provider)
and re-seal the same `ticketSecret` to a friend’s site-scoped ZID, or hand
over the QR out of band. **Transfer does not change `C` or the ticket
public key.** The ticket is bearer: the first consume at the door wins. A
copy may remain on the original device. A printed authorization is also
bearer. A live challenge is not: it requires a fresh holder approval.

## Lab relay

Local dev and e2e spawn a Zafu minirelay bound to `127.0.0.1` only. Test and
dev code refuse any relay host that is not loopback, including
`zcash.rotko.net`.
