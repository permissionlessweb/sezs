# Guides and demo engine

This is a specification, not an implementation. It describes how Speak-Ez Sessions should author, version, and regenerate walkthroughs and public guides so they stay true as the product iterates.

The stance is the Terp design brief: clear and honest, less but better, civic and open, woven. A guide should say what the guest or worker actually does, on the surfaces that exist today, with data taken from the event record rather than copied into the trail. Where a capability is incomplete, this document names the gap instead of inventing a path.

Existing sources this spec is written against:

- The Next app under `apps/sezs` (pages router): `/`, `/tickets`, `/ticket`, `/check-in` (`/checkin` redirects here), `/door` (`/usher` redirects here), `/register`, `/admin`, `/desk`, `/calendar`, `/lineup`, `/gallery`, `/raffles`, `/faq`, `/keys`, `/night`, `/notes`, `/reservations`, `/sponsors`, `/stream`, `/splash`.
- The loopback walkthrough in `docs/WALKTHROUGH.md` (app `:3051`, splash `:3052`, public docs `:3054`, bouncer `:3055`, LCD `:1317`).
- Public guides already shipped in `websites/sezs-docs` (`/guides/...`).
- Local deploy and seed: `make deploy-local` / `packages/sezs-orch`, which registers `sezs_consume_v2` through the cw-orch fork, instantiates the stack, and curates the event from on-chain metadata and `apps/sezs/public/lantern-night-nip52.json`.
- End-to-end coverage under `apps/sezs/e2e/`, especially `ticket-consume-v3.e2e.mjs`.

Public documentation must not describe laboratory payment shortcuts. Operator walkthroughs may name loopback ports and session paths; they must not print keys, shares, or registration secrets.

---

## Trailblaze and Trailmark

### Trailblaze (Block)

Trailblaze is Block's open-source, Apache-2.0, AI-driven UI testing framework for iOS, Android, and web. A coding agent drives the device through the CLI; a recorded session becomes a replayable trail that CI can run without an LLM.

- Repository: <https://github.com/block/trailblaze>
- Docs: <https://block.github.io/trailblaze/>
- CLI reference: <https://block.github.io/trailblaze/CLI/>
- Project layout and file names: <https://block.github.io/trailblaze/project_layout/>
- Install: `brew install block/tap/trailblaze`, or the release script at <https://raw.githubusercontent.com/block/trailblaze/main/install.sh>. Requires JDK 17+. Android needs `adb`; iOS needs Xcode/`simctl` (macOS only); web uses a Playwright Chromium.

Authoring and replay (current docs, 2026):

```sh
trailblaze device list
trailblaze device connect web --target sezs
trailblaze session start --title "usher-check-in"
trailblaze snapshot                          # UI tree with short refs
trailblaze tool tap ref=ab42 -s "Open check-in"
trailblaze session save -t "usher-check-in"  # writes a trail.yaml
trailblaze session stop
trailblaze run trails/usher-check-in -d web  # deterministic, no LLM
trailblaze report                            # HTML, JSON, optional video
```

The current *unified* trail file is `trail.yaml` (or any `*.trail.yaml`) with `config:` and a `trail:` list. Each step has natural-language `step:` / `verify:` text written once, and an optional `recording:` map keyed by device classifier (`web`, `android`, `ios-iphone`, …). A device with a matching recording slot replays the recorded tools; a device without one falls back to the step prose (that path uses an LLM). An optional `trailhead:` is deterministic step 0 (launch, sign in).

A minimal shape, from the official getting-started and architecture pages:

```yaml
# trails/guides/usher-check-in/trail.yaml
config:
  title: usher-check-in
  tags: [guide, usher, check-in]

trail:
  - verify: the check-in page is visible
  - step: Scan the guest ticket QR
    recording:
      web:
        - tapOnElementBySelector:
            nodeSelector:
              css: "[data-sezs='check-in-scan']"
  - step: Authorize the consume in Zafu
```

`--step` / `-s` on every `tool` call records *why* the action happened and is what self-heal uses when the UI drifts. `trailblaze selector` can suggest selectors against a captured screen or `--live`. `trailblaze waypoint` matches named locations against screen state; the docs still call waypoints an active prototype, so this spec treats them as useful once they stabilize, not as a hard dependency.

Uncertainties, stated plainly:

- An older devlog (2025-10-01, “Trail Recording Format”) shows a different YAML (`- prompts:` lists, per-device `ios-iphone.trail.yaml`). Current architecture docs say the legacy parser was removed and only the unified `trail.yaml` loads. New work should follow the current unified format and re-check the CLI of the installed binary (`trailblaze skill show` always matches that binary).
- `trail` is a deprecated alias of `run`; `blaze` is a deprecated alias of `step`.
- Multi-device sessions and `config.devices` exist (`session start --bind`); exact roster syntax should be taken from the installed CLI help, not from this document if they diverge.
- Trailblaze drives *one* device's UI tree (or several bound devices). It cannot, by itself, hold a physical phone camera up to another screen, or operate a native wallet it is not attached to.

### Trailmark (Trail of Bits)

Trailmark is Trail of Bits' open-source tool that parses source into a queryable graph (functions, types, calls, and whether each edge is syntactic or heuristic) and can emit Mermaid diagrams. It is a *code* graph tool, not a product-journey recorder. That matches what we need for “are these specs still true of the code?” It does not, on its own, draw a guest-facing check-in story.

- Repository: <https://github.com/trailofbits/trailmark>
- Announcement: <https://blog.trailofbits.com/2026/04/23/trailmark-turns-code-into-graphs/>
- Skills (including diagramming-code): <https://github.com/trailofbits/skills>
- Install: `uv tool install trailmark` (Python ≥ 3.12). Also `uv add trailmark` or `nix run github:trailofbits/trailmark`.

Commands used here (from the project README and diagramming skill):

```sh
trailmark analyze --language auto --summary apps/sezs/src
trailmark entrypoints --language auto apps/sezs/src
trailmark diagram --target apps/sezs/src --language auto --type call-graph --focus CheckInPanel --depth 2
trailmark diff --repo . main HEAD
```

Diagram types: `call-graph`, `class-hierarchy`, `module-deps`, `containment`, `complexity`, `data-flow`. Output is raw Mermaid text. Wrap it in a `mermaid` fence, or restyle and render with mermaid-cli as in §5.

Uncertainty: the `trailmark diagram` short flags (`-t`, `-T`, `-f`) and supported languages for TypeScript/TSX should be confirmed against the installed CLI (`trailmark diagram --help`). This spec was written from public README and skill text, not from a live run against this tree. TSX coverage may be thinner than Python or Rust; if a diagram command cannot see `CheckInPanel`, say so and fall back to a documented entrypoint the tool *can* resolve, rather than inventing a graph.

How the two tools divide the work:

| Need | Tool |
| --- | --- |
| Drive the UI, record a replayable session, export video of a guide | Trailblaze |
| Check that the *code paths* still match a guide's claimed steps | Trailmark mermaid + `trailmark diff` |
| Guest-facing flow picture (this document's check-in diagram) | Curated Mermaid, informed by Trailmark and the repo, styled with product tokens |

---

## 1. Reusable demo and walkthrough engine

The engine produces two artifacts from the same sources: operator walkthroughs (loopback session) and public guides (docs site). Both must survive product iteration and event variants.

### Stable selectors

Today the app has **no** `data-testid` or `data-sezs` attributes on pages or `src` components. Trails that key on copy, CSS class names (`.pix-btn`, `.halo`), or DOM order will break when typography or layout moves. Before any committed trail, each durable control gets a stable `data-sezs` id, for example:

- `data-sezs="tickets-rail-zec"`
- `data-sezs="checkout-open"`
- `data-sezs="check-in-scan"`
- `data-sezs="check-in-authorize"`
- `data-sezs="usher-chat-compose"`
- `data-sezs="register-submit"`

Ids name *role*, not visual position, and they do not include event-specific strings (“lantern”, a date, a sku). Copy and prices are *data*, not selectors.

Trailblaze recordings should prefer these attributes in `nodeSelector` CSS (`[data-sezs='check-in-scan']`), with the step's `-s` prose as the self-heal hint.

### Data from the seeded event, never hardcoded

Trails and transcript templates bind to the live event record:

- On-chain `event_view` (name, id, tiers, lineup, domain, zkid, usher group, consume config).
- Public NIP-52 document at the event `metadata_uri` (today written to `apps/sezs/public/lantern-night-nip52.json` by `SezsSuite`).
- App boot file used by the walkthrough (`terp-boot.json` / `apps/sezs/dev/localterp/boot.json`): contract, lcd, chain id, groups, zkid — addresses, not secrets.

A trail step may say “choose the first published ticket tier” or “use the event name from EventView.” It must not bake in “Gallery, 40 seats, Lantern Night” as the only correct text. When the next event is curated through the same deploy trait, the same trail still runs if selectors and roles hold.

Fixture defaults that still exist in older docs (for example `speakez-sessions` in some interface notes) are not the walkthrough event. The engine reads `event.id` from the contract the boot file points at.

### Versioning and regeneration

Proposed layout (not created by this spec):

```
trails/
  guides/<guide-id>/
    trail.yaml              # unified Trailblaze trail
    transcript.yaml         # spoken-word script, keyed to step ids
    catalog.yaml            # audience, prereqs, acceptance (or a section of a single catalog)
    clips/                  # composited wallet/QR cuts, if any (no secrets)
  diagrams/
    mermaid-theme.json      # product tokens
    <surface>.mmd           # curated product-flow mermaid
    <surface>.svg
    trailmark/              # generated mermaid from trailmark, not hand-edited
guides.lock.json            # content hash of trail.yaml + transcript + catalog + diagram inputs
```

Proposed Make targets, to sit beside `make test`, `make docs`, `make deploy-local`, and `make e2e`:

| Target | Purpose |
| --- | --- |
| `make trails-check` | Replay committed trails against the loopback app (`trailblaze run … -d web`). Fail on mismatch. No LLM. |
| `make trails-record` | Operator-only. Re-record a named trail after a reviewable UI change. |
| `make diagrams` | Render curated `.mmd` to SVG with mermaid-cli and the product theme. |
| `make diagrams-trailmark` | Regenerate Trailmark mermaid under `trails/diagrams/trailmark/` from documented entrypoints. |
| `make guides-drift` | Compare current EventView shape, `data-sezs` inventory, Trailmark graphs, and trail selectors to `guides.lock.json`. Fail if a guide's surface or selector disappeared. |

Public docs (`make docs`) consume *published* transcripts and stills, never raw session logs.

### Drift detection

Drift is expected. Detect it in layers:

1. **Selector drift.** A replay cannot find `[data-sezs='…']`. Loud failure. Optional `--self-heal` is for small copy changes, not for committed CI.
2. **Copy and data drift.** Visible names, prices, and dates come from EventView. A verify step asserts structure (“a ticket tier is listed”), not a fixed price string.
3. **Code-path drift.** `trailmark diff` or a stored call-graph around `CheckInPanel`, `CheckoutPanel`, `TicketVault`, `UsherChat`, `ParticipantsPanel` changes in a way that no longer reaches a guide's claimed function. The curated mermaid is then stale.
4. **Product-surface drift.** A page listed in the catalog is gone, or a redirect changed (`/usher` → `/door`, `/checkin` → `/check-in`). The catalog is the list of surfaces; the lockfile catches the rename.

---

## 2. Guide catalog

Each guide below lists audience, prerequisites, steps, surfaces, wallet variants, and acceptance. Steps describe the *product*, not a laboratory bypass. Surfaces are routes that exist in `apps/sezs/pages` unless a gap is marked.

Shared prerequisites for local operator recordings: a loopback session (`docs/WALKTHROUGH.md`), the app and docs reachable on 127.0.0.1, and a cw-orch-seeded event whose EventView is healthy. Guests following public guides need only the public site, a wallet from the wallets guide, and a ticket or invitation as the specific guide requires.

### 2.1 Initial installations

- **Audience.** A guest or worker setting up devices before the night.
- **Prerequisites.** A phone or browser that can install Zafu. No ticket yet. Passkeys need `http://localhost` or HTTPS, not an IP in the address bar.
- **Steps.** Install Zafu first (ZIP-321 ZEC; Penumbra dest + memo; site-scoped ZID login; usher authorize). Optional: a ZIP-321 wallet they already use (Zashi, Ywallet) for paying an invoice if they are not using Zafu for ZEC. Confirm the wallet is on the network the event names, not a random mainnet send. Keplr is not a sign-in option and is not required.
- **Surfaces.** Docs: `/guides/general/installing-a-wallet`, `/guides/general/wallets`. The app itself has no installer. In-app sign-in is on `/keys` (`SignInPanel`): Zafu, Zafu passkey, or this browser. Email appears in the modal but is not served on this branch (runtime is on `sezs/email-auth-runtime`).
- **Wallet variants.** Zafu (preferred for ZEC, ZID login, and usher authorize). Zashi or Ywallet (pay a ZIP-321 invoice only). Passkey-plus-browser-key is site sign-in, not a wallet install.
- **Acceptance.** The reader can open a ZEC receiving or payment path in Zafu, and can sign in with Zafu or a passkey, without pasting a recovery phrase into the SEZS site.

Existing docs already cover this; the engine should record *install* only as short wallet-app clips, then cut back to the event site.

### 2.2 Onramp ZEC

- **Audience.** A guest who does not yet hold ZEC.
- **Prerequisites.** A wallet they control (guide 2.1).
- **Steps.** Follow the public “Buy ZEC for the first time” guide: choose a common onramp, then move funds into a wallet they control. Do not buy from a page that asks for a ticket secret. The event site does not sell ZEC.
- **Surfaces.** Docs: `/guides/general/purchasing-zec`. Third-party onramps and the wallet app. No first-party `/onramp` route in the app today.
- **Wallet variants.** Destination should be Zafu or another wallet the guest controls (Zashi, Ywallet). The onramp itself is outside Trailblaze's SEZS web target.
- **Acceptance.** The guest can show a ZEC balance in a wallet they hold, ready to pay an invoice. The guide never treats an exchange screenshot as a ticket.

Gap: onramp UIs change often and are third-party. Recordings should be short, dated, and easy to retire; the durable part is “move ZEC to a wallet you control, then come back to `/tickets`.”

### 2.3 Registration and ticket purchase

“Registration” for a *guest ticket* is not the artist `/register` form. Buying a ticket is: open `/tickets`, choose a rail and a published tier from EventView, pay the invoice, keep the ticket.

- **Audience.** A guest buying admission before the door.
- **Prerequisites.** Guide 2.1, enough ZEC or UM for the published price, the event site.
- **Steps.** Open `/tickets`. Choose a payment method shown for a published tier (today the catalog rails include shielded ZEC and shielded Penumbra). Open checkout, pay the ZIP-321 invoice (ZEC) or the dest+memo (Penumbra) from the wallet. Wait until the site shows the ticket as paid. Save or print the compact ticket from `/ticket`. A receipt or a booking is not admission.
- **Surfaces.** `/tickets` (`CheckoutPanel`), `/ticket` (`TicketVault` for backups). Docs: `/guides/general/purchasing-a-ticket`.
- **Wallet variants.** Zafu for ZIP-321 and Penumbra memo. Zashi or Ywallet for the ZEC invoice URI. Keplr is not the ZEC payer.
- **Acceptance.** EventView still lists the tier; the guest has a `sezs3` (or accepted older) ticket QR; the payment memo binds to the commitment, not to a name on a door list.

Gap: `/register` is the *artist/vendor payout* form (guide 2.5), not guest account registration. Sign-in on this branch is Zafu ZID or a passkey plus a sealed browser key (`/keys`, `SignInPanel`) and is not a ticket. Email sign-in is not served until `sezs/email-auth-runtime` merges. Guides must not conflate these.

### 2.4 Transfer a ticket to another person

- **Audience.** A guest handing a paid, unused ticket to a friend.
- **Prerequisites.** A paid ticket on the sender's device. The friend has a way to receive it (their ZID, or a QR / passkey open).
- **Steps.** On `/ticket` or the vault on `/check-in`, open “Tickets and transfers.” Seal or re-seal the ticket to the friend's site-scoped ZID (64-hex pubkey they copy from the same vault after ZID sign-in), or hand them the QR out of band. Tell them this is a bearer ticket: the first use at the door counts; a copy may remain on the sender's device.
- **Surfaces.** `TicketVault` (`apps/sezs/src/event/TicketVault.tsx`), used from ticket and check-in pages. Backend stores only envelopes (ciphertext), never the opening.
- **Wallet variants.** Zafu ZID for seal/re-seal. A friend without Zafu can still take a QR or a passkey-approved open. Keplr is not involved.
- **Acceptance.** The friend can present a working ticket at the door. A second consume of the same nullifier is refused. The backend cannot open the envelope.

Gap: there is no standalone `/transfer` route. The flow lives inside the vault panel. Trails should target `data-sezs` on that panel once ids exist. There is no on-chain “transfer” message; the secret is what moves.

### 2.5 Artist and vendor: register a payment wallet for deposits

- **Audience.** An invited artist or vendor.
- **Prerequisites.** A one-time registration commitment key from a coordinator (issued on `/admin` participants). A ZEC and/or UM address they control. The key is not a spending key and is not a ticket secret.
- **Steps.** Open `/register` (or the link they were given). Enter the one-time key. Submit the payout addresses the organizers asked for (shielded or unified ZEC, `penumbra1…` UM). If Zafu is connected, the form can fill and randomize diversified addresses, or scan a Zigner QR. Confirm the characters before submit. To change an address later, ask for a new key and submit again.
- **Surfaces.** `/register`. Coordinator side: `/admin` participants tab (`ParticipantsPanel`). Docs: `/guides/artists/submitting-wallet-addresses`.
- **Wallet variants.** Zafu (fill/randomize/Zigner). Manual paste from Zashi, Ywallet, or pcli. Keplr is not the payout address.
- **Acceptance.** The coordinator sees the commitment (not the key) on the participants list. A later payout batch can be proposed to those addresses. Ushers cannot open payroll or the participants list (`roles.mjs`).

### 2.6 Usher: check in an attendee

- **Audience.** An usher listed on the event usher group.
- **Prerequisites.** A Terp account / Zafu that can authorize consume (ADR-36 / Zafu authorize). Membership on the event usher set. The guest has a paid ticket QR. Door tools stay hidden from anyone who is not an usher.
- **Steps.** Sign in and open `/check-in`. Scan or load the guest's compact QR. The usher device fetches the public leaves and root, finds the commitment, and builds the proof in the browser (the guest does not prove). Authorize the consume in Zafu (event, nullifier, root, proof hash, expiry). The app relays `ConsumeTicket`. Tell the guest they are in, or that the ticket cannot be used (already admitted, wrong event, unpaid).
- **Surfaces.** `/check-in` (`CheckInPanel`). `/door` explains arrival and points here; it does not run the consume. `/usher` redirects to `/door`. Docs: `/guides/general/check-in`.
- **Wallet variants.** Zafu for authorize (`window.zafu`). Keplr is not a sign-in option and is not required at the door. The guest wallet is not used at the door.
- **Acceptance.** First consume of a paid ticket returns an on-chain admit. A second scan of the same ticket is refused. Ticket secrets are not written to usher chat, logs, or screenshots.

This is the most complete flow in the repo today (`ticket-consume-v3.e2e.mjs` plus the public check-in guide). It is the sample transcript in §4 and the sample diagram in §5.

### 2.7 Usher: interact in chat (zirc, not classic IRC)

- **Audience.** Ushers and coordinators on duty.
- **Prerequisites.** A ZID sign-in. The usher (or coordinator) is on the group that may use the channel. Ticket secrets and door QRs are refused in this channel.
- **What exists today.** This is **Zafu zirc**, a sealed room over the loopback minirelay, not a public IRC network (no Libera/Ergo-style server in-tree). `UsherChat` (`apps/sezs/src/event/UsherChat.tsx`) is mounted on **`/admin`**, not on `/usher` (that route redirects to the door). HTTP: `GET/POST /sezs/usher/chat`. Splash keeps `usherMessages` and room metadata (`zafu-routes.mjs`, `usher-group.mjs`). A membership change starts a new room; invites are sealed to each registered ZID. `apps/sezs/e2e/minirelay-zirc.e2e.mjs` covers room create, invite, send, and sync on 127.0.0.1 only. Roles: ushers may check in and use usher chat; they are refused on payroll and participants.
- **Steps (as the product stands).** Open `/admin` with an usher or coordinator session. Sign in with ZID. Register the ZID on the usher set if needed. Open or rotate the sealed room. Send only operational messages (who is on the door, a queue, a delay). Never paste a ticket opening, a registration key, or a QR payload.
- **Surfaces.** `/admin` (`UsherChat`). Loopback relay on `:3053` in a full session. No dedicated `/chat` page.
- **Wallet variants.** Zafu ZID (or the site-scoped ZID provider the vault also uses). Keplr is not the chat identity.
- **Acceptance.** A message from a signed-in usher appears to other members of the current room. A post that looks like ticket material is refused. A membership change requires a new room.

Gaps: there is no first-class usher-only chat route; workers have to enter through admin. Automatic room rotation on membership change is explicitly not in zirc today (the UI says so). A public-network IRC client is not in the product. For public guides, describe “usher chat” as the sealed Zafu room, not “log in to IRC.”

### 2.8 Admin: sign and accept payments via multisigs (FROST and DAO)

- **Audience.** Event admins / coordinators who release artist and vendor payouts.
- **Prerequisites.** Membership in the admin FROST set. Registered payout addresses (guide 2.5). A session where the sign gate is the local bouncer (`:3055` in the walkthrough).
- **FROST, what exists today.** `/admin` participants / payroll (`ParticipantsPanel`): issue a one-time registration key, record payout addresses, propose a batch, collect a **2-of-3 FROST** signature over the bouncer, then execute shielded ZEC and UM transfers to the registered addresses. This is the live “sign and accept payments” path.
- **DAO, what exists today.** `make deploy-local` can instantiate `dao_dao_core` (and related modules) next to the event. There is **no** in-app DAO proposal or treasury UI. `ClientProviders.tsx` documents that `@dao-dao/stateful` is not imported because it OOMs the Next compile. A DAO-signed payment guide cannot be recorded as a first-party trail until that surface exists (or a clearly linked external DAO UI is adopted).
- **Steps (FROST, recordable now).** Open `/admin`, participants tab. Confirm the batch amounts against the registered addresses. Propose the batch. Collect FROST approvals through the bouncer (do not export shares). Execute. Confirm txids in the payroll UI, not by dumping session files.
- **Surfaces.** `/admin`, bouncer `:3055`. `/desk` is a separate artist desk, not the FROST batch signer.
- **Wallet variants.** FROST shares live in the admin set / bouncer — not in Keplr or Zashi. Zafu is not the payroll signer.
- **Acceptance.** A batch with a valid aggregate signature executes; ushers cannot open this panel; no share or `sezsreg_` key appears in a recording.

---

## 3. Computer-usage guide: authoring a step-by-step film with Trailblaze

This section is for the person (or coding agent) who *makes* the guide film, not for the guest in the film.

### 3.1 Prepare

1. Start or reuse a loopback session (`docs/WALKTHROUGH.md`). Confirm the seeded event via EventView, not by hardcoding names.
2. Install Trailblaze and pin a device: `trailblaze device connect web --target sezs` (target app config should point at `http://127.0.0.1:3051` for operator recordings).
3. Confirm `data-sezs` ids for the guide exist; if not, add them in the same change as the first recording.
4. Open a transcript file (§4) with empty timings; you will fill clocks after the first clean take.

### 3.2 Record the web flow

```sh
trailblaze session start --title "usher-check-in"
# For each catalog step:
trailblaze snapshot
trailblaze tool tap ref=<ref> -s "Scan the guest ticket QR"
# verify when a screen should be recognisable
trailblaze session save -t "usher-check-in"
trailblaze session stop
trailblaze run trails/guides/usher-check-in -d web
trailblaze report   # stills + optional ffmpeg video
```

Keep the natural-language `-s` text identical to the catalog step and to the transcript `step` id. That is what ties film, trail, and voiceover together.

### 3.3 Cuts from mobile wallet variants

Some steps leave the event origin: installing Zafu, paying a ZIP-321 invoice in Zashi or Ywallet, authorizing in Zafu, scanning a Zigner. Trailblaze can record those only if a device running that app is connected (`device connect android` / `ios`).

A practical compositing pattern:

1. Record the web trail to a clean `video.webm` (or the report's mp4).
2. Record a short wallet trail on a phone or emulator for the same catalog step id, e.g. `step: Pay the ZIP-321 invoice in Zashi`.
3. Cut the wallet clip to the verb only (open invoice, confirm, done). No seed screens, no full addresses if a crop will do, no notification shades with other accounts.
4. Composite: web film as the spine; wallet clips as picture-in-picture or full-frame inserts aligned to the same step id and transcript cue.
5. Store clips under `trails/guides/<id>/clips/<step-id>-<wallet>.webm` and list them in `transcript.yaml`.

### 3.4 Where Trailblaze cannot reach, and what to use instead

| Situation | Why Trailblaze is not enough | Alternative |
| --- | --- | --- |
| Guest phone shows a QR, usher laptop scans it | Two physical devices; a web driver cannot “see” another screen through a camera | Point the usher machine's webcam at a second display that full-screens the guest QR (both loopback, no secrets in the frame). Or inject the QR payload in an operator-only test hook that the *public* film then represents as a scan. Prefer a real camera take for the public cut. |
| Native Zafu / Zashi / Ywallet UI | Not the SEZS DOM. Must attach a phone/emulator running that app | Record a second Trailblaze session on Android (or iOS on macOS). If the wallet blocks automation, use a short device-camera recording of the wallet, then cut it in. |
| OS install sheets, App Store, Play Store | Outside the app; policies change | Still frame + spoken instruction, or a generic “install from the store” insert that is cheap to replace. |
| FROST share approval on a machine that is not the Trailblaze target | Signing is on the bouncer / share holders | Film the admin UI “Sign with FROST” and a redacted bouncer approval, never the share material. |
| Printed ticket | Paper | Film a printed QR in the guest's hand, then the usher scan. No need to automate a printer. |

Do not skip a real payment in a public film. If a recording environment must omit a slow onramp, start the take *after* the guest already holds ZEC, and say so in the transcript.

### 3.5 Export

The deliverable for each guide is: the unified `trail.yaml`, the report video, optional wallet clips, the timed transcript, and (for check-in and other core surfaces) an updated mermaid SVG. Public docs embed the film and transcript, not the trail YAML, unless we later choose to publish trails as documentation.

---

## 4. Spoken-word transcripts

A human records the voice. Automation records the pictures. The transcript is the score that lines them up.

### 4.1 Format

One YAML file per guide, `trails/guides/<guide-id>/transcript.yaml`:

```yaml
guide: usher-check-in
title: Check in at the door
voice: sezs-product          # clear, honest, unhurried; no slang that dates the cut
language: en
sample_rate: 48000
# Clocks are seconds from the start of the web spine, after any title card.
# step ids must match trail.yaml steps (and clip file prefixes).
cues:
  - id: title
    start: 0.0
    end: 4.0
    speaker: narrator
    text: >
      Check-in at the door. The guest shows a ticket. The usher does the rest.
  - id: scan-qr
    start: 12.0
    end: 20.0
    speaker: narrator
    text: >
      The usher scans the compact code. The guest does not build a proof
      on their phone.
    clip: clips/scan-qr-usher.webm
```

Rules:

- `id` is stable across takes; timings may change when a take is recut.
- `text` is what is spoken, in the product voice, already copy-edited. No stage directions in `text`; put those in an optional `direction` field.
- Do not put secrets, full addresses, or registration keys in `text`.
- A `clip` field, if present, is the overlay to show during that cue.
- Keep cues shorter than about twelve seconds of speech; split rather than rushing.

### 4.2 Template

```yaml
guide: <guide-id>
title: <plain title>
voice: sezs-product
language: en
cues:
  - id: <step-id>
    start: 0.0
    end: 0.0
    speaker: narrator
    text: |
      <spoken lines>
    direction: <optional, not spoken>
    clip: <optional relative path>
```

### 4.3 Sample: usher check-in

The following is a complete first-pass script for guide 2.6, in the same voice as the public check-in guide. Timings assume a calm two-minute spine; adjust to the take.

```yaml
guide: usher-check-in
title: Check in at the door
voice: sezs-product
language: en
cues:
  - id: title
    start: 0.0
    end: 6.0
    speaker: narrator
    text: >
      Check-in at the door. Bring the ticket you already paid for.
      The usher will do the proving. You just show the code.
  - id: what-you-show
    start: 6.0
    end: 20.0
    speaker: narrator
    text: >
      The ticket lives in your browser, in a passkey-unlocked copy,
      or on a paper print of the same compact code. It is a small
      static QR. It is not a booking, and it is not a payment receipt.
  - id: usher-opens
    start: 20.0
    end: 32.0
    speaker: narrator
    text: >
      An usher who is already signed in, and listed as an usher for
      this event, opens the check-in page. Door tools stay hidden
      from everyone else.
  - id: scan-qr
    start: 32.0
    end: 46.0
    speaker: narrator
    text: >
      They scan your code. Their device fetches the public guest list,
      finds your commitment, and builds the proof. Your phone does not
      do that work.
    direction: Show the usher scanner meeting the guest QR; no secret text on screen.
  - id: authorize
    start: 46.0
    end: 62.0
    speaker: narrator
    text: >
      The usher authorizes the consume in Zafu. That approval covers
      the event, the nullifier, the guest-list root, a hash of the
      proof, and a short expiry.
    clip: clips/authorize-zafu.webm
  - id: admit
    start: 62.0
    end: 76.0
    speaker: narrator
    text: >
      The signed consume goes to the event contract. If this is the
      first time the ticket is used, you are in. That is admission.
  - id: refuse
    start: 76.0
    end: 90.0
    speaker: narrator
    text: >
      A second scan of the same ticket is refused. One ticket, one
      entry. If the code is for another event, or was never paid,
      it is refused as well.
  - id: close
    start: 90.0
    end: 100.0
    speaker: narrator
    text: >
      Keep the printed copy if you like. The door only needs it once.
      Enjoy the night.
```

---

## 5. Trailmark, mermaid, and product styling

### 5.1 Role of Trailmark graphs

For each product surface in the catalog, keep a Trailmark diagram of the *code* (call graph or data-flow around the entry component) and a curated *product-flow* mermaid for humans. The curated graph is what appears in docs. Trailmark is the check: if `CheckInPanel` no longer calls the prove or authorize path the curated graph claims, `make guides-drift` fails.

Suggested entrypoints to document in the lockfile (names as they exist in source today):

| Surface | Focus |
| --- | --- |
| Tickets / checkout | `CheckoutPanel` |
| Ticket vault / transfer | `TicketVault` |
| Check-in | `CheckInPanel` |
| Usher chat | `UsherChat` |
| Artist register | `RegisterPage` (pages/register.tsx) |
| Admin payroll | `ParticipantsPanel` |

Regenerate Trailmark output; do not hand-edit it. Restyle only through mermaid theme and mermaid-cli.

### 5.2 Mermaid theme

Tokens are taken from `apps/sezs/src/ui/ui.css` (`:root`) and the docs restatement in `websites/sezs-docs/src/pages/_root.css`. The web app is dark-only (“one dark room, one warm light”). Diagrams used in docs should follow that field, even when the docs site offers a cream light theme for long reading.

| Token | Value |
| --- | --- |
| `--field` | `#07070a` |
| `--core` | `#ffb347` |
| `--hot` | `#fff1c9` |
| `--pale` | `#f7d9a8` |
| `--ember` | `#a0521a` |
| `--ink` | `#ece6dc` |
| `--dim` | `rgba(236,230,220,.62)` |
| `--ok` | `#9fd8b0` |
| `--bad` | `#f09a86` |
| body font | Iowan Old Style / Palatino / Georgia |

Checked-in theme file: `docs/specs/diagrams/mermaid-theme.json` (mermaid-cli `-c`). `classDef` lines in mermaid cannot always parse `rgba(…)`; the example diagram uses solid companions `#c4aa78` and `#6b5a3c` for hair strokes.

Render:

```sh
npx @mermaid-js/mermaid-cli -i docs/specs/diagrams/check-in-flow.mmd \
  -o docs/specs/diagrams/check-in-flow.svg \
  -b '#07070a' -c docs/specs/diagrams/mermaid-theme.json
```

### 5.3 Example: check-in flow

Source: `docs/specs/diagrams/check-in-flow.mmd`.  
Rendered proof of styling: `docs/specs/diagrams/check-in-flow.svg`.

The diagram follows the product, not a hoped-for rewrite: the guest shows a compact QR; a signed-in usher on `/check-in` scans, proves on the usher device, authorizes in Zafu, and the contract admits once or refuses a replay.

---

## 6. Phased plan

**Phase A — Foundations.** Add `data-sezs` ids to the catalog surfaces. Add `make diagrams` around the theme and mermaid-cli already proven here. Write `catalog.yaml` stubs that point at this document's §2. No public film yet.

**Phase B — Check-in first.** Record the usher check-in trail against the loopback app. Time the sample transcript to the take. Composite a Zafu authorize clip. Hook `make trails-check` to that one trail. Run Trailmark around `CheckInPanel` once the CLI's TSX support is verified, and store the output under `trails/diagrams/trailmark/`.

**Phase C — Purchase, register, transfer.** Same treatment for `/tickets`, `/register`, and `TicketVault` transfer. Wallet clips for ZIP-321 pay (Zafu, then one of Zashi or Ywallet if a device is available).

**Phase D — Chat and payroll.** Usher zirc chat on `/admin`, then FROST payroll. Redaction rules for keys and shares are part of the definition of done. DAO payment UI waits on an actual surface.

**Phase E — Public publish.** Fold finished films and transcripts into `websites/sezs-docs` guides. Operator walkthroughs stay in `docs/WALKTHROUGH.md`. Drift checks run on both.

---

## 7. Open questions

1. Should public trails run against a production-like static preview, or only against the loopback session? Preview data must still come from a real EventView, not copied names.
2. How far should Trailblaze waypoints go in, given they are still described as a prototype?
3. Does the installed Trailmark build parse TSX well enough to focus `CheckInPanel`, or should the code-graph check target Rust (`cw-event-manifold`) plus a thinner TS graph?
4. Is a dedicated `/usher/chat` route desired, or is `/admin` the long-term home of usher chat?
5. When (if ever) should DAO-signed payouts appear in the app, given the current compile constraint on `@dao-dao/stateful`?
6. For two-device QR, is a documented camera rig enough, or do we also want an operator-only scan hook for CI trails that public films will not use?
7. Who records and keeps the human voice — and in which languages after the first English take?
8. Should `data-sezs` ids be considered public API, with a changelog when one is removed?
