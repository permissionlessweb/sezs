# Door privacy decision: is Halo2 VerifyConsume over-engineering?

Date: 14 November 2026 (Africa/Dakar, UTC+0).
Status: **recommendation to lock in**. This is a design decision, not an
implementation claim that a SNARK is being verified today. It is not.

Companion documents: `TICKET-PROOF-DESIGN.md`, `BACKEND-ROLE.md`,
`EVENT-MANIFOLD-API.md`, `ZAFU-ZID-ZIRC-TICKETS.md`. Lab check-in consent
(live handshake and printed pre-authorization) is specified and implemented
alongside this decision; it does not replace the analysis below.

---

## The question

The production door path was specified as: the holder (or an usher device)
builds a Halo2 `sezs_consume` proof, and cw-ave `VerifyConsume` checks public
instances `[guest_root, nullifier, event_id]` and writes `N`. The lab door
has never done that. It checks that a commitment `C` is in the paid set and
that the derived nullifier `N` is unused, and it says so.

The question is whether that SNARK is required to keep the *actual* privacy
assumptions of this architecture, or whether it is over-engineering and can
be dropped for v1 without pretending we have properties we do not.

This document is meant to be locked, not left as “maybe later, so we must
keep the proof in the door path.”

---

## What the architecture already is

A ticket is not a name, not a login, and not an NFT.

- The browser generates `ticketSecret` as a domain-separated KDF of a fresh
  CSPRNG seed, `event_id`, `sku`, and a per-purchase nonce. It is not derived
  from a payment key, a wallet address, or a ZID.
- `C = Poseidon(ticketSecret, sku, event_id)` (sku before event_id; this
  leaf format is not to be changed).
- `N = Poseidon(ticketSecret, event_id)`.
- The payment memo carries only `sezs1:<hex C>`.
- The backend never learns the secret. It issues an invoice for a posted
  `C`, watches the payment, and appends `C` to the guest list.
- The same operator’s lab backend is both the payment watcher and the door.

Those facts are the baseline. A proof system can only add privacy on top of
them. It cannot unwind what the watcher already learned at payment time.

---

## Privacy assumptions we actually make

These are the properties the current design is built on, and that we should
refuse to sacrifice:

1. **The backend never learns `ticketSecret`.** It cannot reconstruct a
   ticket, open a sealed backup, or admit by forging a holder signature that
   requires that secret (see consent, below).
2. **A ticket is a commitment, not an identity.** The guest list is leaves
   `C`, not names, logins, or ZIDs.
3. **Shielded rails do not reveal a payer address.** A correct shielded ZEC
   or Penumbra UM payment gives the operator a memo `C`, an amount, and a
   confirmation. It does not give them a spending key or a transparent
   payer address.
4. **There is no public attendance roster.** Other attendees, and chain
   observers who only see a consume transaction that posts `N` (not `C`),
   should not learn who came or which `C` was used, unless we choose to
   publish that.
5. **Signing in is not a ticket.** A passkey or ZID login is not admission.

These are **not** assumptions of the current architecture, even though they
are easy to wish for:

- The payment operator cannot tell **which of their invoices** was used
  when a particular body walks in. That is only true if consume is
  unlinkable from `C` (a membership proof that reveals only `N`, with `N`
  and the ticket public key *not* pre-registered next to `C` on the
  operator’s books).
- A payer on a **transparent** rail (ETH, Base) is anonymous to the
  operator or the chain. They are not. The payment itself is the leak.
- An usher who is handed a printed ticket cannot use it. Paper is bearer.
  Consent on paper means “I authorized this event’s door keys to admit this
  ticket once,” not “I am standing here approving this scan.”

---

## Threat model, by actor

### Backend / payment watcher

Already knows, for every successful payment: `C`, invoice id, rail, amount,
time paid, memo, destination they themselves quoted, and (if the buyer
posted one) a sealed envelope they cannot open.

Does **not** know `ticketSecret`, unless we later send it to them (we must
not).

On **shielded ZEC / UM**, they do not learn a payer address from a correct
shielded payment.

On **ETH / Base**, they learn the paying address, because that is how those
rails work. The `C` in the memo or calldata is then already bound, on their
books, to that address.

If the door is this same service (today’s lab, and the likely v1
deployment), then anything the door learns, this actor learns.

### Door admin / usher

Sees a body, a time, a door, and whatever the check-in protocol shows them
(a QR, a challenge, a yes/no). They are on the coordinator-chosen usher
list. A malicious or sloppy usher can photograph a screen, reuse a paper
ticket they were handed, or log extra fields we failed to scrub.

They should not receive `ticketSecret`. A live handshake should not require
them to hold it. A printed ticket is still bearer: possession of the paper
is admission once, by design.

### Coordinator group (cw420)

Configures the event, the domain origin, the global door-auth public key,
tiers, and the link to cw-ave. They are a trust root for “what is this
event” and “which door keys are real.” They are not supposed to be a
covert identity provider for guests. If they also run the watcher and the
door, they *are* the operator in the previous section.

### Chain observers

See what is posted on each rail and on Terp.

- Shielded ZEC / UM payments: they do not see payer, memo, or `C`, if the
  payment is actually shielded.
- Transparent ETH / Base: they see payer, amount, destination, and often
  the memo/`C` if we put it in public calldata.
- If we post `guest_root` (a Merkle root of all paid `C`s) and/or the
  list of `C`s, they see the set of paid tickets, not who holds them.
- If consume posts only `N`, they see that some ticket was used, not
  which `C`, unless they can link `N` to a published `C`.
- If consume posts `C`, or a unique ticket public key that was published
  next to `C`, they can link the consume to that payment leaf.

### Other attendees

See other people in the room. They should not see a guest list, other
people’s `C`, or other people’s payment addresses. A QR on someone else’s
phone or print is a social leak if it is a bearer secret; a pre-signed
admit token is also bearer, but at least it is not the key that opens a
sealed backup.

---

## Threat model, by rail

| Rail | What the operator learns at payment | What a chain observer learns at payment | What revealing `C` (or a unique key stored next to `C`) at the door adds |
| --- | --- | --- | --- |
| Shielded ZEC | `C`, amount, time, invoice. No payer address. | No payer, no memo, no `C`, if the transfer is shielded. | Body + check-in time bound to that invoice/`C`. Still no chain address. |
| Shielded Penumbra UM | Same as ZEC, if the payment is actually shielded and the memo is for the operator only. | Same caveat: a shielded payment does not publish `C` to the world. | Same as ZEC: body ↔ invoice, not body ↔ address. |
| Transparent ETH | Payer address, amount, time, and usually `C` if it is in the memo/calldata. | The same, because the payment is public. | Body + check-in time bound to **that paying address**. This is deanonymization of the person at the door relative to the chain. |
| Base | Same as ETH. | Same as ETH. | Same as ETH. |

Cash App is door-only and is not a pre-arrival rail. It is out of scope
for this payment-to-door linkage question.

The lab invoice path already refuses to issue ETH and Base invoices. That
is consistent with treating those rails as weaker, but the public fixture
still lists them at list price. The recommendation below says to be honest
about that in the UI if they remain offered.

---

## Option 1 — No ZK: the door checks a paid ticket and an unused `N`

The holder presents something that identifies a paid leaf (today: a QR
from which the door derives `C` and `N`; recommended: a signature under a
ticket public key registered at purchase, plus a stored `N`). The door
checks: this leaf is paid, this `N` is unused, and (with two-way consent)
the holder authorized this door. It records `N` as spent.

**Kept.** Secret stays off the backend. Double spend is prevented. Other
attendees do not get a roster. Shielded payers still have no address on
the operator’s books. This is cheap, is what the lab already does in
substance, and does not depend on zk-wasmvm or a browser prover.

**Lost, relative to a real membership proof that reveals only `N`.** The
operator who already has the map `C ↔ invoice` learns *which* invoice was
used, if consume is identifiable (the door sees `C`, or a ticket public
key stored next to `C`, or an `N` that was also stored at purchase). That
links the physical attendee and the check-in time to that payment. On
ETH/Base, it links them to the paying address. A sloppy door that accepts
a raw secret QR additionally risks cloning the secret (logs, photos, a
malicious usher) — worse than revealing `C`, and not required.

`guest_root` is **not required** for this option. The operator’s paid set
is enough. A published root (or the list of `C`s) can still exist as an
audit or raffle anchor. It does not help door privacy. Publishing the
list of `C`s makes every paid leaf world-visible, which is useful for a
fair raffle and harmful if you wanted `C` to stay known only to the
operator.

---

## Option 2 — ZK membership: prove `C` is in `guest_root`, reveal only `N`

Public instances: `[guest_root, nullifier, event_id]`. The verifier learns
that some paid ticket was consumed and which `N` is now spent. It does
**not** learn `C`, provided the prover does not also send `C`, and
provided the operator did not already store a correlator (`N` or a ticket
public key) next to `C` at purchase.

**What this actually buys.**

- **Chain observers:** hide which leaf was used, if the consume
  transaction posts only the proof and `N`.
- **A door that is not the payment watcher, and does not receive `C`:**
  hide which invoice was used from the person or device at the door.
- **The payment operator, only if they cannot correlate `N` to a `C` they
  already have.** They cannot compute `N` from `C` without the secret. If
  they did *not* store `N` or a unique ticket public key at purchase, and
  the door only shows them `N`, they know someone they got paid by arrived,
  but not which invoice that body corresponds to.

**What this does not buy.**

- It does not hide a transparent ETH/Base paying address from the operator
  or the chain. That leak already happened at payment. ZK at the door only
  hides *which* of those known payments is walking in, and only under the
  conditions above.
- It does not hide `C` from an operator who is shown `C`, or who stored a
  unique public key with `C` and then sees a signature under that key.
- It does not replace two-way consent. A proof can be carried or replayed
  by anyone who can build or intercept it. Consent is a separate property
  (the holder authorized *this* door, *now*).
- It does not make paper tickets non-bearer.

**Cost.** A Halo2 proving stack in the browser or on an usher device, a
VK on-chain, zk-wasmvm or an equivalent verifier, `guest_root` as a live
door dependency, and a fail-closed path when the verifier is missing. The
circuit and VK already exist in-tree (`sezs-zk-cw-orch`). The lab door
does not verify them, and must not claim that it does.

---

## The key question: what linkage does revealing `C` at the door add?

The watcher already has `C ↔ invoice ↔ txid` (or a lab stand-in for a
txid). Revealing `C` at the door, or revealing anything unique that was
stored next to `C`, adds **one new binding**:

> this physical person, at this door, at this time, is that payment.

That is not a binding the payment record already has. The payment record
has “someone paid,” not “this body used this ticket.”

By rail:

- **Shielded ZEC / UM:** the new binding is body + time ↔ invoice/`C`
  (amount, sku, when they paid). It is *not* body ↔ a chain address,
  because the operator never got one. Whether that invoice-level link is
  acceptable is an event-policy question, not a cryptographic free lunch.
- **ETH / Base:** the new binding is body + time ↔ **paying address**.
  That is deanonymization. If those rails stay on, this is the honest
  warning. ZK at the door can hide which of the known paying addresses
  just walked in, but only if consume is unlinkable from `C`. It cannot
  unpublish the payment.

Revealing `ticketSecret` at the door is strictly worse than revealing
`C`: it is a cloning and logging hazard, and it is unnecessary if the
ticket public key and `N` were committed at purchase (without putting
the secret, or a change to the Poseidon leaf, on the wire).

---

## Is `guest_root` needed without ZK?

No, not for door admission. Without a membership proof, the door needs a
paid set and an unused-`N` set. Those can live with the operator, or be
mirrored on-chain as a simple map, without a Merkle root.

`guest_root` remains useful as:

- an **audit commitment** to the paid set,
- a **raffle entry root** (paid leaves are the entry list),
- a **future public input** if ZK consume is ever turned on.

It should not be a v1 door dependency, and the check-in UI should not
talk as if a root were a verified proof.

---

## Middle options (cheaper than “ZK everywhere”)

1. **Disable ETH/Base** (or keep them off the invoice path, as the lab
   already does) for events that do not want body↔address linkage. This
   is the strongest cheap move on transparent rails. It does not require
   a circuit.
2. **Offer ETH/Base but flag them as lower-privacy** in honest UI copy:
   the paying address is visible to the operator and the chain; check-in
   will associate that address with the person at the door.
3. **ZK only for transparent rails.** This hides *which* known payment
   was used at the door, if consume does not also reveal `C`. It is
   extra machinery for a rail that already leaked the address at
   payment. Only worth it if “the operator must not know which ETH payer
   just arrived” is a real requirement. For Speakez-scale, option 1 or 2
   is more honest.
4. **Blinding / anonymous credentials** (Chaumian tokens, a blinded
   admit tag issued at purchase that the operator cannot correlate to
   `C`). This can hide which invoice was used without Halo2. It is a
   different protocol, conflicts with storing a unique ticket public
   key next to `C` and then seeing it at consume, and is not needed for
   v1 if we accept operator-side invoice linkage.
5. **Separate the door verifier from the payment watcher**, and show the
   door only `N` + a proof. This is the deployment that makes ZK (or
   blinding) actually bite against the operator. Today both roles are
   one process.

---

## Two-way consent is not a substitute for ZK (and vice versa)

Existing check-in specs in the older AvEvents / cw-ave path
(`sezs-lab/sezs/sezs-docs/sprint/checkin/`, especially `SPEC.md` and
`trust-boundary.md`) already required guest consent: an ADR-036 amino
signature over `ticket_addr` + event + usher + stage, then usher-only
`check_in_guest`. That design assumed a Cosmos address bound to a
ticket. **It does not apply to commitment tickets**, and there is no
`FLOW-GAPS` document in this app that already specifies a handshake for
`C` / `N`. TICKET-PROOF-DESIGN.md describes a bearer QR and a
membership check, not a two-way door handshake.

The successor, implemented in the lab with this decision, is:

- **Live:** the door shows a challenge QR (`event_id`, contract
  `domain`, session nonce, usher public key, timestamp). The holder
  signs it with a ticket signing key derived from `ticketSecret` by a
  domain-separated KDF. The door posts the signature and the ticket
  public key (and the stored `N`). The backend verifies the signature
  against the public key committed *alongside* `C` at purchase — not
  inside the Poseidon leaf, so the circuit format is unchanged. The
  secret never leaves the holder device.
- **Printed / offline:** the QR is a pre-signature by that same ticket
  key over `(event_id, domain, global event door-auth public key from
  the contract, sku)`. Any authorized door key for this event may admit
  it once. **Paper is still bearer.** Consent here means: when you
  print, you authorize this event’s door keys to accept this ticket
  once, including if someone else is holding the paper. It is not a
  live “I am here and I approve this scan.”
- A raw secret QR (`sezs1://ticket?k=…`) is **refused** at the door.
  That is intentional. The secret remains for sealed backup and
  out-of-band transfer, not for silent admission.

Consent stops an usher from admitting a ticket the holder has not
authorized (for the live path) and stops the backend from treating a
photographed secret as a check-in. It does **not** hide which invoice
was used: a unique ticket public key stored next to `C` is a correlator.
That is a conscious trade: v1 prefers consent and “no secret on the
backend” over operator-unlinkable consume.

---

## Recommendation (lock this in)

**Do not require Halo2 `VerifyConsume` for v1 door admission.** For the
privacy assumptions this architecture actually makes, it is
over-engineering. The lab door should remain an honest paid-set +
unused-`N` + holder-consent check, and should continue to say that it
does not verify a SNARK.

Keep the circuit and VK in-tree as a **future, optional** path: on-chain
consume that reveals only `N` to chain observers, or a door that is
separated from the payment watcher and must not learn `C`. Do not let
that future path dictate v1 UX, gas, or a fail-closed verifier that we
are not shipping.

**On rails:** treat shielded ZEC and UM as the privacy-preserving
pre-arrival rails. Keep ETH/Base disabled on the invoice path, or if
they are offered, flag them in the UI as lower-privacy: the paying
address is public to the operator and the chain, and check-in will bind
that address to the person at the door. Do not add “ZK only for ETH”
until someone actually needs “the operator must not know which
transparent payment just arrived.”

**On `guest_root`:** do not make it a v1 door dependency. Keep it
available as an audit/raffle commitment and as a future ZK public
input.

**On correlators:** v1 will register a ticket public key and `N`
alongside `C` at purchase (never the secret, never a change to the
leaf). That makes consent-verify possible without sending the secret to
the door, and it means the operator *can* link the body to the invoice.
Accept that for v1. If a later event requires unlinkable consume, the
consent protocol must be redesigned so the consume token is not a
unique key the operator stored next to `C` (ZK revealing only `N`, or
a blinded token).

---

## What is kept and what is lost

| Property | v1 no-ZK + consent (recommended) | Halo2 VerifyConsume, reveal only `N` |
| --- | --- | --- |
| Secret never on the backend | Kept | Kept |
| Ticket is a commitment, not a name | Kept | Kept |
| Shielded ZEC/UM: no payer address at payment | Kept | Kept |
| ETH/Base: payer address hidden | Not kept (never was) | Not kept at payment; door can hide *which* payment if unlinkable |
| No public attendance roster | Kept, if consume does not publish `C` or names | Kept, if only `N` is posted |
| Operator cannot link body ↔ invoice | **Lost** (or rather, never held once consume is identifiable) | Kept, if `N` / ticket keys were not pre-registered with `C` |
| Holder consent required to admit (live) | Kept (new) | Not provided by the proof alone |
| Printed ticket is non-bearer | Not kept (honest bearer) | Not kept |
| Door works without a browser prover or zk-wasmvm | Kept | Lost |
| On-chain `guest_root` required to admit | Not required | Required as a public input |

---

## Open questions (do not block the lock-in)

- Confirm this recommendation: v1 door stays no-ZK, with the tradeoff
  table above accepted.
- ETH/Base: remain listed and flagged, or stay off the invoice path for
  any event that cares about body↛address.
- If unlinkable consume is later required, choose ZK vs. blinded tokens,
  and redesign consent so it does not reintroduce a correlator.
- Raffle claim is a separate knowledge-proof problem (`ClaimPrize` is
  still `knowledge_proof_pending`). Dropping ZK at the door does not by
  itself decide how a winner proves they hold the winning `C`.
- Lab ZID keys bind to the contract `domain` (lab: `http://127.0.0.1:3051`).
  WebAuthn on some browsers prefers `localhost`. That tension remains.
- Optional ZID co-signature on the live challenge is specified as
  optional and is not required in the lab v1 handshake.
- Whether a later on-chain consume posts only `N`, and who is allowed
  to submit it.
