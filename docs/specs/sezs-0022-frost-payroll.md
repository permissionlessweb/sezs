```
ZIP: SEZS-0022
Title: FROST Payroll
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Protocol / Interface
Created: 2026-11-24
Last-Updated: 2026-11-25
License: Apache-2.0
```

Conformance keywords follow [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)), as adopted with the ZIP document conventions in [SEZS-0000](sezs-0000.md).

## Definitions

- **Payroll FROST set.** The threshold group that authorises artist and
  staff payouts. In the current design, `t = 2`, `n = 3`.
- **Roster commit.** A canonical hash of the live holder set, bound into
  the spend memo so signatures attest roster consensus.

## Abstract

FROST payroll pays artists and staff from ticket inflow under a threshold
policy: a transparent t-address for grant accountability, 20% upfront and
80% after the session, and no payout job until paid ticket inflow exists.
The source of truth is the hash-market payroll FROST module used by
[`crates/sezs-server`](https://github.com/permissionlessweb/sezs/tree/main/crates/sezs-server).
Other FROST variants in the tree (validator privval, payroll stdin helper,
Zafu cipher tooling) serve other purposes and MUST NOT be confused with
this module. Intended gallery escrow reuse of a FROST set is outlined in
[SEZS-0006](sezs-0006-virtual-gallery.md) and
[SEZS-0007](sezs-0007-private-auction.md).

## Motivation

Grant accountability requires transparent payouts and a recorded roster.
A single in-process source of truth already exists; this document names
it and sets the rules a `PayrollProcess` MUST keep.

## Privacy Implications

Payout addresses for this path are transparent t-addresses, by design,
so a grant report can show who was paid. That is a deliberate reduction
of address privacy for payees on this path, not a leak of ticket secrets
or guest identities. Inbox shares are threshold secrets and MUST NOT be
logged. A passkey is not a FROST share.

## Requirements

- Paid ticket inflow MUST exist before any 20% job is created.
- Artists and vendors on this path MUST be paid to a transparent
  t-address. The process MUST reject a non-transparent address.
- Shares stay in the inbox until t-of-n; then the spend is broadcast.
  The spend wire is a real FROST spend, not a stub transaction id.
- Passkeys MUST NOT be treated as shares. Key packages are not the
  login-session object.
- Spends MUST carry the roster commit in the memo and MUST fail if the
  memo does not match the live roster.

## Specification

### Parameters and domains

- `FROST_T = 2`, `FROST_N = 3`
- DKG tags: `dkg1`, `dkg2`
- Spend domain: `terp/frost_escrow/zec_spend/v0` (ZIP-244 / SpendAuth
  over the PCZT)
- Roster domain: `itl-frost-roster-v1`
- Spend memo prefix: `itl-frost-memo-v1:`

`roster_commit(epoch, t, n, group_vk, seats)` is the canonical hash of
the live holder set. `require_spend_memo_roster` MUST compare the memo
to that commit. The roster domain and memo prefix above are the strings
current spends attest; changing them requires a compatibility window
(see Open Issues).

### HTTP

- `POST /sezs/frost/jobs`
- `GET  /sezs/frost/jobs/{id}`
- `POST /sezs/frost/jobs/{id}/share`
- `POST /sezs/frost/jobs/{id}/broadcast`

Admin group-key rotation is a separate in-process flow
(`rotate_frost_pubkey`, t-of-n of admin seats). It MUST NOT empty the
current verifying key; the old key stays until the new one is applied.
Payroll HTTP used by the desk (`/sezs/payroll/*`) MUST be kept or
mapped: state, invites, register, amounts, batches, frost ceremony,
execute.

Default execute is fail-closed until a payout adapter is provided.
Session-coordinator routes require an authenticated login session
([SEZS-0010](sezs-0010-ticketing-process.md)).

### Other FROST code, out of this specification

- hash-market `custody/frost` and privval: validator signing
- `sezs-frost-payroll`: stdin/stdout DKG helper for ceremonies
- Zafu cipher helpers in the front end: wallet-side encoding

Those MAY be used as tools. They are not this payroll source of truth.

## Rationale

Building on the existing hash-market payroll module, rather than writing
a second payroll FROST, keeps one inbox and one roster rule.

## Reference Implementation

- Source of truth: hash-market `onboard_authz` FROST module
- Desk routes: [`crates/sezs-server`](https://github.com/permissionlessweb/sezs/tree/main/crates/sezs-server)
  `/sezs/payroll/*` and `/sezs/frost/*`
- Ceremony helper: [`crates/sezs-frost-payroll`](https://github.com/permissionlessweb/sezs/tree/main/crates/sezs-frost-payroll)

## Open Issues

- The roster domain and spend memo prefix still use the strings recorded
  above. A compatibility window is needed before they can be given
  SEZS-prefixed names.
- How 20/80 interacts with a mid-session cancellation
  ([SEZS-0010](sezs-0010-ticketing-process.md) P3) is not fully specified.
- Mainnet broadcast and confirmation policy is operational and is not
  restated here.
- Whether the same FROST set is reused for gallery escrow
  ([SEZS-0006](sezs-0006-virtual-gallery.md)) is not decided.
