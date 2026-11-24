# Admin capabilities

Two layers share the night: an on-chain usher hierarchy (cw420 groups on the event contract) and a FROST principal set used in the admin UI for payments and key ceremony. They are related but not the same signer today.

This page lives next to `apps/sezs/src/frost`, which is where the ceremony and admin UI code sits.

## Coordination and the on-chain usher hierarchy (cw420)

The event contract (`cw-event-manifold`) points at two cw420 groups and a service key.

| Role | Where it lives | What it may do |
| --- | --- | --- |
| Curator | Set at instantiate (or later by the curator) | Event identity, venue, tiers, sales, paid leaves, and the pointers to groups and randomness |
| Coordinators | A cw420 group address (`SetCoordinators`) | Programme, NIP-52, metadata, domain, service key, usher group, and `SetZkid`. This group is the on-chain stand-in for the principal admin set |
| Service key | `SetServiceKey` | `UpdateGuestRoot` only |
| Ushers | A cw420 group address (`SetUsherGroup`) | `ConsumeTicket` only |

A coordinator is a member of the coordinators group with weight greater than zero. On 16 Nov 2026 a coordinator member at weight 1 successfully called `SetDomain` (height 31030, gas used 215,309, code 0). That confirmed coordinators as writers; it was not a membership change.

Root publish policy, already encoded in the contract and the publisher: at most every 15 minutes when the tree changed, and immediately when doors open; epoch strictly increasing; leaf count must not decrease; `is_canonical` required.

**Planned:** the principal FROST set should be the signer behind `UpdateGuestRoot` (and, where policy calls for it, behind coordinator writes). A configured service key may publish roots until that is in place. Ticket secrets still never go to the backend.

## Artist and staff registration

Event coordinators, signed in and recognized as members of the coordinator group, use the **Participants** tab in the event admin panel to issue a one-time registration commitment key (a password) for an artist, vendor, staff member, or usher, with an optional label. They can share it as a copy link or a QR code to [permissionless.money/alpha/sezs/register](https://permissionless.money/alpha/sezs/register/).

The participant opens that page, enters the key, a display name, a shielded or unified ZEC address, and a UM address. The backend stores only a hash of the key, marks the key consumed on first use, and records the participant. A reused or unknown key is refused. Coordinators see a table of people and status (invited, registered, paid). Payout addresses are shown truncated.

The key is issued once, through a channel the coordinator already trusts, and must never be written into documentation, a public page, or a chat that outlives the registration. This page will never show a sample key.

## FROST admin UI: payments flow

**What is built** (loopback only, `apps/sezs/src/frost`):

- A 2-of-3 ceremony with seats desk, steward, and spare.
- An inbox on `127.0.0.1:19091`.
- Hard refusals: the UI will not target `morocco-1`, will not run cross-site, will not accept a self-claimed admin role, and will not take a same-vk shortcut.
- On-chain authority to rotate the FROST public key: `rotate_frost_pubkey`.
- Participants (payroll) tab: issue one-time registration keys, list registered artists and staff, propose a payout batch, and collect a real 2-of-3 FROST signature of the batch digest through the event bouncer.
- Ticket-paid is not offered from the admin page (payments for tickets stay on the guest purchase path).

**Built (payroll batch, not a live till):** coordinators set amounts per participant or per role, and set the gallery split parameters for the session, then propose a payout batch in the Participants tab. The FROST admin set (2-of-3, seats desk, steward, and spare) signs the batch digest over the local FROST relay path, reached only through the event bouncer, following Zafu's design of routing DKG and signing rounds through a relayer with an IP bouncer in front. After a valid aggregate signature, execution submits a shielded ZEC spend and a UM transfer on the local session chains (ict-rs). The FROST signature is an approval gate over the session treasury; it is not yet an Orchard RedPallas FROST spend-auth signature. If those chains are down, execution is refused.

**Draft / Planned** once escrow exists:

1. Desk and steward (or steward and spare) complete a ceremony and publish the FROST public key / diversified address for that payout or sale.
2. Funds arrive at that address (a donation, a sale, or an escrow release trigger).
3. The admin UI presents the intended recipients — artist or vendor wallet, and any documented charity or commons share set for that session — and a signing request.
4. Two of three sign. The payout leaves the FROST-controlled address. Recipients are the addresses those people registered, not addresses invented by the operator at the last minute.
5. The UI records that the release was signed. It does not learn ticket secrets, and it does not mark tickets paid.

Until escrow is deployed, this payment flow is not a live till. Artists and vendors register addresses through the registration form; those addresses are what a future release should pay.

## Operational limits

The admin UI is loopback-only. It is not a general-purpose wallet. Keys and shares stay with the seat holders. There is no warranty, and the software has not been audited. See [Disclaimers](/disclaimers).
