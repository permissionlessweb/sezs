# Zafu ZID / zirc and ticket secrets — research and design (phase 1)

Date: 14 November 2026 (Africa/Dakar, UTC+0).

Phase 1 only: research and design. No large implementation, no deploy, no push, no mainnet. The running SEZS splash/dev server was left alone.

Source of truth for this note was rotkonetworks/zafu `main` at `4e0b9e28` (20 October 2026). Anything not verified in that revision is marked unverified.

This note extends `TICKET-PROOF-DESIGN.md`. It does not replace the leaf format `C = Poseidon(ticketSecret, sku, event_id)` or the payment-memo binding.

## What ZID and zirc actually are

**ZID** (`packages/zid`, npm `@zafu/zid`) is the identity and transport layer: site-scoped keys, “log in with zafu”, sealed boxes, optional pairwise encrypted channels, presence, and a guest (no-wallet) fallback. The package README states the site never touches a private key when a wallet is present.

**zirc** (`packages/zirc`, npm `@zafu/zirc`) is what a community builds on top of ZID: IRC-style channels. It has two halves:

- A **pure** half (`channel-log.ts`, `custody.ts`, `vote.ts`, plus leaderless group objects): genesis, a hash-chained log, operator / electorate / hide-rather-than-delete moderation. Nothing in that half talks to a network (`packages/zirc/src/index.ts`).
- A **room** half (`@zafu/zirc/room`, `packages/zirc/src/room/room.ts`): an encrypted, windowed, append-only board on a zafu relay. This is the “shared-secret mailbox” described in `docs/design/zirc-shared-secret-mailbox.md`.

The wallet also uses zirc rooms internally for People / groups / doors / FROST (`apps/extension/src/people/{groups,door,frost-room,invites}.ts`). That is a wallet feature, not a general dapp API.

## Identity and key derivation

Source: `apps/extension/src/state/identity.ts` (header comments and `deriveRoot`, `deriveIdentity`, `deriveSeedForSite`, `deriveSeedForSiteXWing`, `deriveSeedForSiteKa`).

- The wallet mnemonic is the root of ZID, but **not** through the BIP39 spending-key seed. The comments state v2 hashes the mnemonic string with SHA-256, then HKDF-SHA256 with salt/info `zafu-zid-v2` / `identity-root`, then HMAC-SHA512 for a named identity (`identity:` + name), then a per-purpose seed (`site:` + origin, `xwing-site` for the PQ box, `contact-ka-v1` for introductions). The stated reason is legal and cryptographic separation: ZID material is not an intermediate of ZEC/UM spending keys.
- Default keys are **site-scoped and unlinkable across origins**. The same person presents a different ed25519 pubkey on each site. `zafu_zid_pubkey` returns that site key, plus optional `pq_pubkey`, `ka` / `ka_sig` for introductions (`packages/zafu-protocol/src/methods.ts`, `ZafuZidPubkeyRequest`).
- The recovery phrase re-derives every epoch’s seed. The protocol comments are explicit: epoch compartmentalization is not forward secrecy; a leaked mnemonic opens past sealed boxes. `identity.ts` says the same: “no forward secrecy. compromised seed decrypts all past e2ee messages.” Zigner can derive the same keys from the same mnemonic without a secret transfer (same file, Zigner section).
- Cross-site identity exists but is **opt-in** (`deriveSeedCrossSite`).

Session vs stable key, verified:

- `@zafu/zidzid.connect()` (`packages/zid/src/zid.ts`, `connectWallet`) builds a **fresh random session key** (`createSessionKey` in `packages/zid/src/provider.ts`) and asks the wallet to sign a delegation string `zid:delegate:<sessionPubkey>:<appName>` via `zafu_sign`. `me.pubkey` in that session is the ephemeral session key, not the stable site key.
- The stable account id for encryption and login-verify is `zafu_zid_pubkey` / `zidPubkey()` (and `publicKey` on a successful `zafu_sign` of a server challenge). Use that for backups, not the session pubkey.
- `zafu_sign` signs **only** `challengeHex`. The wallet displays the origin but does not bind it into the signed bytes. A relying party must use a fresh, origin-committed nonce (SIWE-style). Documented in `ZafuSignRequest`.

Guest identity (`packages/zid/src/guest.ts`, `createGuestIdentity`): used when no wallet is present (or `ephemeral: true`). It mirrors the derivation *shape* and domain tags, but from a random in-page seed, not a mnemonic. Default is in-memory (gone on reload); `{ persist: 'local' }` writes the seed to `localStorage`. The file calls this burner-grade: no backup phrase, any script on the origin can read a persisted seed. **A guest identity is not a substitute for a recoverable ticket store.**

## Dapp-facing API (what a website can actually ask)

Single source of truth: `packages/zafu-protocol/src/methods.ts` (`ZAFU_V1_METHODS`) and the extension split in `apps/extension/src/message/listen/zafu-method-names.ts`. The contract test keeps them in lockstep.

Implemented v1 methods:

| Method | Listener | What it does | Approval |
| --- | --- | --- | --- |
| `ping` | easteregg | Detect wallet / protocol version | none |
| `zafu_sign` | sign-request | Sign a challenge with the site-scoped ed25519 key (“login with zafu”) | yes (statement shown) |
| `zafu_zid_pubkey` | external-encryption | Fetch site ed25519 / PQ / KA pubkeys | under `encrypt` capability |
| `zafu_encrypt` / `zafu_decrypt` | external-encryption | Sealed box (classical X25519→HKDF-SHA256→AES-256-GCM, or hybrid X-Wing when `recipient_pq` is set) | `encrypt` capability; popup via `requestCapabilityApprovalPopup` if not already granted; persistent grant is re-read every call; iframe origins are denied (`external-encryption.tsensureApproved`) |
| `zafu_request_capability` | easteregg | Ask for `connect` \| `sign_identity` \| `encrypt` \| `frost` (open-ended string) | popup |
| `zafu_pick_contacts` | easteregg | Contact picker; handles are app-scoped and unlinkable across apps | picker UI |
| `zafu_connect` / `zafu_friends` / `zafu_invite_friend` | connect | Introduce two *people using this app*; when both accept, *their wallets* open a private room. The app can later hand a short invite text/path into that room. The app never learns a decline (stays `pending`) | wallet ask on connect |
| `zafu_discover_contacts` | contact-discovery | “Which of *my* contacts are present in this app scope this epoch?” Narrow by design; no contact list leak | feature off until opted in |
| `zafu_request_contact_discovery` | contact-discovery-request | Ask the user to turn that feature on wallet-wide | popup |
| `zafu_get_fresh_chain_address` / `zafu_open_shield` | easteregg | Chain address / shield-in sheet | per method |

Transport, verified: `@zafu/zid` does **not** go through the Keplr-shaped `window.zafu` (`enable` / `getKey` / `sendTx`). Detection walks `globalThis[Symbol.for('penumbra')]`, pings until a provider answers `{ zafu: true }`, then sends `zafu_*` messages with `chrome.runtime.sendMessage` (`packages/zid/src/provider.tsdetectZafu`, `packages/zid/src/transport.tscreateExtensionTransport`). The SEZS app already uses `window.zafu` for Terp sign-in and ZIP-321 for payment. Ticket backup would use `@zafu/zid` / the protocol, not `window.zafu.enable`.

Deliberately **not** in v1 (protocol file header): FROST/multisig methods (“fund-safety surface, gated behind explicit capabilities — not for a general SDK”).

**There is no `zafu_zirc_*` method.** A website cannot, in this revision, request “join this zirc room” or “read messages from this room with user approval.” That specific check-in idea is not implementable on the current dapp API. Unverified: whether a future branch in another worktree adds one; it is not in `4e0b9e28ZAFU_V1_METHODS`.

`zafu_invite_friend` is the closest related primitive (wallet writes a short message into a **pairwise** room the two *users’* wallets opened after `zafu_connect`). It is not a room between an event server and a purchaser, and the dapp does not get to read the room.

## Rooms: create, send, receive, encryption, who can read

Source: `packages/zirc/src/room/room.ts` (`Room`, `createRoomSecret`, `encodeInvite`, `parseInvite`, `send`, `sendDirect`, `announce`, `sync`, `syncSince`), `invite-seal.ts` (`sealInvite`), and the mailbox design note.

A room is N members, **one shared 32-byte room secret**, and a windowed board on a relay:

- Coordinate: `(appScope, epoch, shard)`. Epoch is a 5-minute presence window. Default shard is `roomShardFromSecret(appScope, secret)` (unguessable by name). `public: true` derives the shard from the channel name so a visitor can find it — enumerable on purpose.
- `createRoomSecret()` is `crypto.getRandomValues` of 32 bytes.
- Invite format `zroom2:` (`INVITE_PREFIX`) is a **bearer token**: scope, channel, secret, optional endpoint/token. Whoever holds it can read and write. `sealInvite` wraps that token in a ZID sealed box to one recipient so the *transport* cannot open it; it does not stop the recipient from forwarding the invite.
- Members talk with `Room.send` / `Room.sendDirect` / `Room.announce` and read with `Room.sync` / `Room.syncSince`. The client fetches a window (`getBucket`) and tries to open each entry; anything that does not authenticate under the room key is dropped.
- Encryption: per-window HKDF-SHA256 keys, AES-256-GCM, AAD bound to the window, ed25519 signatures, per-author hash chains, fixed-size padded writes. The **relay cannot read** sealed content (blind store).
- **Every holder of the room secret can read every sealed message, including DMs.** DMs are HKDF(roomSecret, `'veil-room-dm-v1'`, …, recipientPubkey). The design note is explicit: the DM lane hides *who talks to whom* from the relay and keeps non-members out; it is not confidential between members, nor against a past member who kept the secret.
- No ratchet and no automatic rotation in this revision (design note “Implementation status”; issue #47). Compromising the room secret opens this window and every window derived from it. Removing a member is a new room or a re-invite; it does not unread the past.
- Plain (unsealed) lane: signed, but readable by the relay and anyone else. Not for ticket material.

A server **can** hold an identity and post into a room — but not by being “a Zafu wallet” on the dapp protocol. Verified path: a Node (or other) process imports `@zafu/zirc/room`, holds an ed25519 `RoomIdentity` (`sign` / `verify`) plus the room secret, and speaks `putBucket` / `getBucket` to a relay (`packages/zid/src/relay-http.tscreateHttpRelayTransport`). No extension is required on the server side. Unverified: a supported headless “server Zafu” that derives keys from a production mnemonic; this checkout’s first-class wallet is the Chrome extension (and Zigner for seed-side derivation). Putting an event mnemonic in a ticket backend would also collapse ZID and (if the same phrase were ever reused) risk spending-key territory — the derivation is separated, but operationally a server should use a **dedicated room signing key**, not a person’s wallet seed.

## Persistence and retention

Source: `apps/minirelay/README.md` configuration table, `apps/minirelay/DEPLOY-retention.md`.

- Default `MINIRELAY_RETENTION_SECONDS` is **3600** (one hour). A 60s sweep deletes older rows. Tags rotate every epoch; the README says keeping history only lengthens the window for a later key compromise (no forward secrecy this layer by design).
- Per-scope override `MINIRELAY_SCOPE_RETENTION` (e.g. `zafu-group-v1=90000` for 25 hours). Hard ceiling `MINIRELAY_MAX_SCOPE_RETENTION_SECONDS` defaults to **48 hours**.
- `DEPLOY-retention.md` also notes that what actually serves `/bucket` on `zcash.rotko.net` in production was **not confirmed** in that note (minirelay vs something else). Unverified here as well. Either way, the relay is a short-lived blind mailbox, not a ticket archive.
- **A zirc room cannot be the only copy of a ticket secret.** Event tickets need to last from purchase until after doors (days to months). That is longer than the documented relay ceiling.

Unverified: whether the wallet persists room history or invites in extension storage beyond relay retention (People vault / `people/vault.ts` exists; its exact retention was not fully read this pass). Even if it does, a dapp cannot read that store today.

## Privacy tradeoffs vs the current ticket design

Current design (already shipped locally): the browser generates the secret; `C` goes in the payment memo; the backend stores `C`, amount, rail, operator deposit, not the secret; the door needs the secret; lost QR cannot be reconstructed from the payment record.

### Idea 1 — backend sends the secret over a zirc room to the buyer

This meets “not device-locked” and “check-in reads a room,” if rooms and a read API existed.

It **fails** the privacy bar we already set:

- The backend learns the secret, so it can admit as the guest and can bind the buyer’s site-scoped ZID (needed to address the room or invite) to `C` and to the payment.
- If the backend is a room member, the shared-secret mailbox means it can also read later messages in that room, including any “ticket” the buyer posts back.
- A leaked ticket-backend database becomes a stack of door-valid secrets, not just paid commitments.
- Relay operators stay blind, but the *event operator* becomes a full holder.

That is a step backward from “backend never sees the secret.”

### Idea 2 — deterministic derivation inside Zafu

`secret = KDF(wallet_site_seed, event_id, sku, invoice_nonce)` (HKDF-SHA256 or a wallet-held SEZS Poseidon), computed **inside the wallet**, with the site seed never leaving it.

- The backend never sees the secret. Recoverable on any device that restores the same mnemonic (and uses the same site origin, identity name, and nonce).
- Check-in is “approve derive / show ticket,” not “approve read this mailbox.”
- Zirc, if used all, only carries public handles (invoice id, event id, sku) or an encrypted envelope the backend cannot open.
- **Not available today.** There is no `zafu_derive` (or similar) in v1. A page must not receive the site seed and do the KDF itself — that would put the ticket-derivation key in JS on the origin (guest-identity territory).

Invoice nonce must be public and remembered (it cannot include `C`, because `C` is computed from the secret). The nonce can live in the payment memo next to `C`, or in a receipt the backend already stores without identity.

### Idea 3 — browser encrypts the secret to the user’s own ZID; room or backend stores only the ciphertext

Uses **existing** `zafu_zid_pubkey` + `zafu_encrypt` / `zafu_decrypt` (capability `encrypt`, user approval).

- The browser (or the wallet, via `encryptFor` to the user’s own `pubkey` / `pq_pubkey`) seals the secret. The backend stores `{ ciphertext, ephemeral_pubkey, pq_epoch, origin, event_id, sku, C }`. It cannot open the box.
- Check-in: the page loads the ciphertext (from the backend, or from a printed receipt id), calls `zafu_decrypt` with user approval, re-derives `C` and `N` locally, and shows the QR.
- Recoverable: the site key is seed-derived; a restored Zafu on a new browser can decrypt, provided origin, `pq_epoch`, and the blob are kept.
- If a zirc room is used as a mailbox, the **payload must already be a sealed box to the user’s ZID**, not a room-secret plaintext. Otherwise every member (including the event server) can read it.
- Relay retention still cannot be the only store; the backend (or a printed blob / wallet-local save) must keep the ciphertext for the life of the ticket.

This is implementable against `4e0b9e28` without new Zafu methods.

## Recommendation

**Do not have the ticket backend generate or transmit the secret in the clear**, including over zirc.

**Near term (no Zafu protocol change):** keep today’s client-side secret and memo binding. After the secret exists, seal it to the purchaser’s site-scoped ZID with `zafu_encrypt` (PQ path when `pq_pubkey` is advertised). Persist the ciphertext on the SEZS backend keyed by `C` or invoice id, with no secret and no need for a name. Check-in asks the user to approve `zafu_decrypt` (or a later, tighter “open this ticket” statement) and then proceeds exactly as now (QR → nullifier → admit once). Zirc is optional transport for that same envelope, not the source of truth.

**Preferred once Zafu can grow a method:** add a wallet-side derive (for example `zafu_derive` or an SEZS-specific capability) so the secret is never in page JS rest and is re-computable from the seed plus a public nonce. The encrypted envelope becomes a convenience backup, not the only recovery path. This is the most private design that still meets “not device-locked,” “recoverable,” and “check-in requires a user-authorised wallet action.”

Either way, signing in is still not a ticket, and `C` in the payment memo remains the binding between payment and leaf.

## Usher admin channels

Feasible as **sealed zirc rooms** operated by the event, not as an on-chain cw420 feature.

- **Who creates them:** the event ticket server (or a coordinator machine) calls `createRoomSecret` + `new Room({ roomSecret, appScope, … })` and posts to a lab/testnet relay. A sensible appScope would be something like `sezs-usher-v1`, not the public channel-name shard. The **cw420 coordinator group** is the right *on-chain* list of who may authorise that operation (and who may rotate the room). It does not, by itself, create a zirc room or push invites.
- **Membership:** bearer invites, ideally `sealInvite`’d to each usher’s site-scoped ZID after they have visited an origin and called `zafu_zid_pubkey`. An usher who leaks the invite leaks the board. There is no automatic “cw420 weight = room membership” link; that would have to be operational policy (issue invites only to current group members; on removal, rotate).
- **What is needed:** a relay the event controls or trusts for availability (still blind to plaintext); a place ushers actually join from. The wallet’s People/groups UI is built for Zafu groups and door codes (`people/groups.ts`, `people/door.ts`), not for “join this SEZS usher room” from a dapp. A dedicated usher page could use `@zafu/zirc/room` if it is given the invite — but then the page learns the room secret, so XSS on that origin is a channel leak. The missing piece is a wallet method: “accept this sealed invite into wallet storage, and send/receive without giving the secret to the page.”
- **Limits already documented:** no ratchet, no automatic rotation, 1 hour default / 48 hour max relay retention unless the event runs a relay with a longer scope (still capped). Usher *messaging* that must last a whole production week needs a store besides default minirelay, or clients that persist history.
- **Do not** put ticket secrets in the usher channel. Ushers should only see a ticket secret scan time, and then forget it (`TICKET-PROOF-DESIGN.md`).

## What would need building in Zafu (not in SEZS alone)

1. **`zafu_derive` (or equivalent)** — wallet computes a domain-separated secret from the site seed + public context (`event_id`, `sku`, invoice nonce), shows a clear approval, returns only the derived secret (or a ticket QR), never the site seed. Highest privacy leverage.
2. **`zafu_zirc_join` / `zafu_zirc_read` / `zafu_zirc_send` (or one “open this invite” capability)** — wallet holds the room secret; the page gets approved plaintext or a narrow “ticket envelope” field, not the bearer token. This is what the user’s check-in idea actually needs. Not in v1.
3. **Longer-lived wallet-side mailbox** if rooms are used as ticket backup — relay retention is too short; the wallet or SEZS backend must persist.
4. **Headless event identity** — a documented, lab-only way for the ticket server to hold a *room signing key* (not a user’s mnemonic) and post envelopes / usher messages. The Room library already allows this; an official “server ZID” product is unverified / absent.
5. **Usher-room rotation** when cw420 membership changes — not in zirc today.

## Short implementation plan (later phases, not this one)

**Phase 2 — SEZS only, uses v1 Zafu methods (medium, about a week of focused app work).** Tickets page: after the secret is created, `detect` / `zidPubkey` / `encryptFor` to self; POST ciphertext to splash/backend; never send the secret. `/ticket` and door check-in: fetch blob by `C` or invoice id, `decryptFrom` with approval, then existing consume path. Tests for “backend store has no secret,” approval-denied, and restore-from-ciphertext. Lab/testnet only. No new Zafu release required.

**Phase 3 — Zafu derive (medium–large, needs a Zafu change + review).** Specify `zafu_derive` context bytes, approval copy, and origin binding. SEZS switches generation and check-in to that method; ciphertext backup remains as a safety net.

**Phase 4 — Rooms (large).** Event server rooms for *encrypted envelopes* and *usher comms*; wallet join/read APIs; sealed invites to usher ZIDs; coordinator-gated creation; operational rotation. Do not block recoverability on relay retention.

Effort is higher if we pretend phase 4 can replace phase 2: it cannot, until Zafu grows methods and a long-lived store.

## Questions only you can answer

1. Do you accept that the backend must **not** learn the ticket secret, even if that means it cannot “send the secret” in the clear over zirc? (Recommended: yes.)
2. Should phase 2 (self-seal + `zafu_decrypt` the door, no new Zafu methods) ship first, with derive + room APIs asked of Zafu in parallel?
3. For deterministic derive, is one ticket per (identity, event, sku) enough, or must an invoice nonce allow more than one leaf per person per event?
4. Which origin should site-scoped keys be bound to (the Speakez tickets origin)? **Decided (14 November 2026):** always the `domain` URL set on the event contract (cw-event-manifold `EventInfo.domain` / `SetDomain`). Lab value: `http://127.0.0.1:3051`. A new origin still means new keys and a new backup. Opening the lab app as `localhost` is a different origin than `127.0.0.1`; ZID binding follows the contract domain, not whatever the tab happened to use.
5. For usher channels, should ushers use a dedicated SEZS page, or should we wait for a wallet-native “accept invite” so the page never sees the room secret?
6. Will you run (or point us at) a **lab** minirelay for SEZS, with a documented retention scope? Production `zcash.rotko.net` behaviour is unverified in this checkout, and we should not assume it keeps tickets.

## Phase 2 decision (14 November 2026)

Phase 2 is implemented as decided: browser KDF secrets, backend never learns the secret (see BACKEND-ROLE.md), self-seal to ZID, transfer re-seals to a friend, multiple tickets as separate payments, usher chat on the admin page, local minirelay on 127.0.0.1.
