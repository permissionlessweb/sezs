```
ZIP: SEZS-0022
Title: FROST Payroll
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Protocol / Interface
Created: 2026-11-24
License: Apache-2.0
```

## Terminology

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "RECOMMENDED",
"OPTIONAL", and "REQUIRED" in this document are to be interpreted as described
in BCP 14 when, and only when, they appear in all capitals.

- **Payroll FROST set.** The threshold group that authorises artist and
  staff payouts. In the current design, `t = 2`, `n = 3`.
- **Roster commit.** A canonical hash of the live holder set, bound into
  the spend memo so signatures attest roster consensus.

## Abstract

FROST payroll pays artists and staff from ticket inflow under a threshold
policy: a transparent t-address for grant accountability, 20% upfront and
80% after the event, and no payout job until paid ticket inflow exists.
The design is the hash-market module formerly named `itl_frost`, which is
SEZS and is being renamed in place. Other FROST variants in the tree
(validator privval, payroll stdin helper, Zafu cipher tooling) serve other
purposes and MUST NOT be confused with this module.

## Motivation

Grant accountability requires transparent payouts and a recorded roster.
A single in-process source of truth already exists; this document names
it and sets the rules a Rust `PayrollProcess` MUST keep.

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
- Roster domain: `itl-frost-roster-v1` (Open Issue: rename with the
  module, in a planned compatibility step)
- Spend memo prefix: `itl-frost-memo-v1:`

`roster_commit(epoch, t, n, group_vk, seats)` is the canonical hash of
the live holder set. `require_spend_memo_roster` MUST compare the memo
to that commit.

### HTTP (current inbox, to be served under `/sezs` after rename)

- `POST /sezs/frost/jobs` (formerly `/itl/frost/jobs`)
- `GET  /sezs/frost/jobs/{id}`
- `POST /sezs/frost/jobs/{id}/share`
- `POST /sezs/frost/jobs/{id}/broadcast`

Admin group-key rotation is a separate in-process flow
(`rotate_frost_pubkey`, t-of-n of admin seats). It MUST NOT empty the
current verifying key; the old key stays until the new one is applied.
Payroll HTTP used by the desk today (`/sezs/payroll/*`) MUST be kept or
mapped: state, invites, register, amounts, batches, frost ceremony,
execute.

### Other FROST code, out of this specification

- hash-market `custody/frost` and privval: validator signing
- `sezs-frost-payroll`: stdin/stdout DKG helper for ceremonies
- Zafu cipher helpers in the front end: wallet-side encoding

Those MAY be used as tools. They are not this payroll source of truth.

## Rationale

Building on the existing module, rather than writing a second payroll
FROST, keeps one inbox and one roster rule. Renaming `itl_*` to `sezs_*`
is documentation of what the code already is.

## Reference Implementation

- Source of truth: hash-market `onboard_authz` FROST module (renamed
  from `itl_frost`)
- Desk routes: `apps/sezs/dev/splash/payroll-routes.mjs`
- Ceremony helper: `apps/sezs/dev/frost-payroll` (moving to
  `crates/sezs-frost-payroll`)

## Open Issues

- Domain and memo prefixes still use the `itl-frost-` string. A
  compatibility window is needed before they can be renamed.
- How 20/80 interacts with a mid-event cancellation (sezs-0010 P3) is
  not fully specified.
- Mainnet broadcast and confirmation policy is operational and is not
  restated here.


## Implementation decisions (Rust port)

- `sezs-frost-payroll` lives in `crates/sezs-frost-payroll` (library +
  stdin/stdout binary). The Node ceremony still shells out to the binary
  when one is built; the Rust desk calls `run_ceremony` in-process.
- `sezs-server` re-exports hash-market `onboard_authz::sezs_frost` as
  `payroll::itl_frost` and attaches `roster_commit` / `spend_memo_roster`
  to `/sezs/payroll/batches/frost`. Prefixes remain `itl-frost-*`.
- `/sezs/payroll/*` is mounted on the one `/sezs` bind. The process does
  not listen on `HASHMERCHANT_BIND` / `SEZS_FROST_BIND`.
- Default execute is fail-closed (`chain_unavailable`) until a payout
  adapter is provided. Coordinator routes require a session cookie;
  `SEZS_PAYROLL_DEV_COORDINATOR=1` grants the desk role on loopback.
