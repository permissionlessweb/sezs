# FROST relay and bouncer — how Speak-Ez Sessions adopts Zafu's design

This note is for implementers. It describes how event-admin FROST DKG and
signing are routed, and how that maps to Zafu's design at
[`frost.md`](https://github.com/rotkonetworks/zafu/blob/1eb7a2f89eea00bda9c50002e39a2cbce2986d9f/docs/src/security/frost.md)
(commit `1eb7a2f89eea00bda9c50002e39a2cbce2986d9f`).

It is not a public-facing guide. Development-only hostnames and loopback
bindings belong in `INTERNAL-DEV.md`.

## What Zafu does

Zafu runs t-of-n FROST for Zcash Orchard. A group of n participants holds
shares of one group key; any t can sign, fewer cannot. There is no trusted
dealer: **distributed key generation (DKG)** produces the shares so that the
full private key never exists on one machine.

Coordination was moved from an earlier cleartext room protocol onto
**frostd**, the Zcash Foundation FROST relay, spoken over JSON-HTTP:

- `POST /challenge` then `POST /login` (sign the challenge with a *relay
  transport* key, not a wallet key)
- `POST /create_new_session` — the participant list is **fixed at creation**.
  Every signer's relay public key must be known first. Nobody else can join.
- `POST /send` / `POST /receive` / `POST /close_session` — poll-based, not a
  stream

A short-lived rendezvous room exists only to collect those transport keys and
hand out the session id. The relay stores the hash of a human room code, not
the code itself.

**Every DKG and signing payload is sealed with Noise_K per peer before it
leaves the device.** The relay is supposed to carry ciphertext only. It can
still see membership, session ids, and timing, and it can deny service; it
must not see key shares, amounts, or recipients.

Signing: the coordinator broadcasts `SIGN:…` plus a PCZT. Co-signers recompute
the sighash and refuse on a mismatch. Round 1 commitments are `C:…` pipe
bundles; round 2 shares are `S:<action>:<share>`. That wire shape is also
documented in `src/frost/wire.ts`.

Default public relay in Zafu is `https://relay.zafu.pro`. Speak-Ez Sessions must **never**
use it. Ceremonies here use only the local loopback stack.

## What the bouncer is

Zafu's **minibouncer** (`apps/minibouncer` in the Zafu tree) is an IP
bouncer, not a mixer and not a FROST participant.

It terminates the client's connection and opens its own to the relay, so the
relay sees the bouncer's address instead of the client's. It forwards
`/bucket` (presence) and `/ws/*` (channels) — and, in our stack, the frostd
JSON-HTTP routes — without changing the protocol.

| The bouncer hides | The bouncer does not hide |
| --- | --- |
| The client's IP from the relay (and from anyone watching the path *to* the relay) | Protocol metadata: who is in a session, which routes are hit, when |
| | The client's IP from the bouncer itself (run one you trust; log nothing) |

A community that shares one bouncer shares one address from the relay's point
of view. If the bouncer logs nothing, no mapping from member to address exists
on the relay to leak. That is the privacy claim: **the relay learns no client
address, and a quiet bouncer stores no mapping.** It is not a mixnet.

## How Speak-Ez Sessions adopts it

```
FROST seats / admin browser
        │  JSON-HTTP (frostd shape) + sealed payloads
        ▼
local bouncer   127.0.0.1 only
        │  same routes, now from the bouncer's address
        ├─ /bucket, /health, /ws/*  →  local minirelay
        └─ /challenge, /login, /create_new_session,
           /send, /receive, /close_session, /list_sessions, /logout
           →  local frostd-lite (loopback subset)
```

- **Minirelay** is Zafu's presence relay (`/bucket` whole-coordinate reads,
  merge-not-replace). SEZS already wraps it as a loopback-only binary.
- **frostd-lite** is a loopback-only subset of frostd's session API, used so
  DKG and signing rounds are actually routed, not passed in-process. It is
  not Rotko's production relay and it is not a public network.
- **Clients talk only to the bouncer.** Tests and the admin UI must not
  bypass it.

Seats (desk, steward, spare; t=2, n=3) already exist in `ceremony.ts`. A
payout batch is a digest the FROST set signs. Execution is a **local payout
receipt** written by the splash backend after a valid aggregate signature —
not a Zcash shielded spend, and not a public-chain transfer. No real funds
move. See the admin spec.

## Flagged / not yet at Zafu parity

- **Noise_K from the Zafu WASM bundle is not wired.** Loopback seats seal
  payloads to recipients with Zafu FrostRelayCipher (Noise_K) before `send`, which
  keeps shares off the relay's plaintext logs, but it is not the same
  `FrostRelayCipher` / Noise_K construction. A later pass should use the
  Zafu cipher unchanged.
- **Rendezvous room codes** (number + two BIP-39 words) are not implemented;
  seats supply transport public keys directly when creating a session, which
  is how frostd actually admits members.
- **PCZT / Orchard FROST spends** are out of scope for this payroll
  stand-in. The signed message is the payout-batch digest. A later shielded
  spend can reuse the same relay path and the `SIGN` / `C` / `S` wire in
  `wire.ts`.
- **Session lifetime** should be enforced client-side (Zafu: 10 minutes).
  The loopback relay does not pretend to expire sessions for the client.
- Bind addresses stay loopback. Production origin and a community-hosted
  bouncer are operational decisions, not something this tree deploys.
