```
ZIP: SEZS-0002
Title: DAO Module
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Contract
Created: 2026-11-24
License: Apache-2.0
```

## Terminology

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "RECOMMENDED",
"OPTIONAL", and "REQUIRED" in this document are to be interpreted as described
in BCP 14 when, and only when, they appear in all capitals.

- **Minimal DAO set.** The official DAO DAO contracts used to host an event
  DAO: `dao_dao_core`, `dao_voting_cw4`, `dao_proposal_single`, and `cw4_group`.
- **dao-calendar.** A calendar module used by the suite. It is kept in its
  own repository and is not vendored into permissionlessweb/sezs.

## Abstract

Speak-Ez Sessions uses a small DAO DAO installation as the organisational
host for an event: membership, proposals, and (via dao-calendar, in its own
repo) the event calendar hook. This document records which contracts are in
scope, who owns them, and how SEZS may use them. It does not re-specify DAO
DAO itself.

## Motivation

Event administration needs an on-chain organisation that can own the
coordinator and usher groups (sezs-0003) without SEZS forking the DAO DAO
codebase. A short module specification makes that boundary reviewable.

## Privacy Implications

DAO DAO membership and proposals are public chain state. They MUST NOT be
used to store ticket secrets, email addresses, or ZID private material.
Payment identities (Zcash, Penumbra) are out of scope for DAO execute.

## Requirements

- Official DAO DAO wasm MUST be consumed as external artifacts, not vendored
  into this monorepo.
- `dao-calendar` MUST remain in its own repository.
- SEZS orchestration MAY instantiate the minimal set and MUST record the
  resulting addresses in the usual cw-orch state, not in source.

## Specification

### Contracts in scope

| Contract | Role | Home |
| --- | --- | --- |
| `dao_dao_core` | DAO core | Official DAO DAO artifacts, via the permissionlessweb fork used by orch |
| `dao_voting_cw4` | Membership voting | Same |
| `dao_proposal_single` | Single-choice proposals | Same |
| `cw4_group` | Group used as the voting module's membership | Same |
| `dao-calendar` | Calendar module hooked by the suite | Its own repository; not copied into permissionlessweb/sezs |

SEZS orchestration (`crates/sezs-orch`) instantiates this set as part of
event curate and points the event coordinator contract at the groups it
needs (see sezs-0003). This specification does not change DAO DAO message
schemas.

### What this module is not

It is not a new DAO implementation. It is not a place to add event-specific
execute messages; those belong on `cw-event-manifold` and cw-ave / cw-420.

## Rationale

Keeping official DAO DAO contracts external avoids a third copy and keeps
this monorepo honest about what SEZS owns. dao-calendar is a fork-only
module with its own repo; moving it would blur that line and was explicitly
ruled out.

## Reference Implementation

- Orchestration: `crates/sezs-orch/`
- Artifact lookup: `crates/sezs-orch/src/wasm.rs`

## Open Issues

- The exact artifact pin (git revision / checksum) for the official DAO DAO
  wasm set used in production curate is recorded at deploy time; this
  document does not yet cite a frozen checksum table.
- How proposal flow is used in production (if at all beyond bootstrap) is
  not specified here.
