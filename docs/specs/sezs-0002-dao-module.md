```
ZIP: SEZS-0002
Title: DAO Module
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Contract
Created: 2026-11-24
Last-Updated: 2026-11-25
License: Apache-2.0
```

Conformance keywords follow [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)), as adopted with the ZIP document conventions in [SEZS-0000](sezs-0000.md).

## Definitions

- **DAO.** A DAO DAO organisation: a DAO core together with voting, proposal,
  and other modules deployed from
  [dao-contracts](https://github.com/DA0-DA0/dao-contracts). Full module
  definitions live in the
  [DAO DAO wiki](https://github.com/DA0-DA0/dao-contracts/wiki).
- **DAO module.** A contract that plugs into DAO core through the modular
  hooks and message design described in
  [DAO DAO Contracts Design](https://github.com/DA0-DA0/dao-contracts/wiki/DAO-DAO-Contracts-Design).
- **Minimal DAO set.** Any dao-dao DAO deployed as dao-contracts: at least a
  DAO core, plus whatever voting, proposal, and group modules that DAO
  variant uses, so long as they follow the dao-contracts specification.
- **dao-calendar.** The calendar DAO module used by SEZS. It is kept in
  [permissionlessweb/dao-contracts](https://github.com/permissionlessweb/dao-contracts)
  (`feat/calander` @ `af4651407425bfa2b32cb51b03e559f631257e5b`) and is not
  vendored into permissionlessweb/sezs.

## Abstract

Speak-Ez Sessions uses dao-dao DAOs, deployed as
[dao-contracts](https://github.com/DA0-DA0/dao-contracts), as the
organisational host for a session. This document specifies SEZS compatibility
with that modular contract design, and the SEZS contribution scope: the DAO
calendar module, and DAO core insofar as SEZS relies on its modularity and
hooks. It does not re-specify DAO DAO itself. Session coordination and usher
authority are specified in [SEZS-0003](sezs-0003-session-coordinator.md).

## Motivation

Session administration needs an on-chain organisation that can own session
coordinator and usher groups without SEZS forking the DAO DAO codebase or
freezing one voting or proposal variant. Compatibility with the modular
capabilities of
[DAO DAO Contracts Design](https://github.com/DA0-DA0/dao-contracts/wiki/DAO-DAO-Contracts-Design)
lets any DAO variant that follows the contracts specification host a session.

## Privacy Implications

DAO membership and proposals are public chain state. They MUST NOT be used to
store ticket secrets, email addresses, or ZID private material. Payment
identities (Zcash, Penumbra) are out of scope for DAO execute.

## Requirements

- SEZS MUST be compatible with the modular capabilities of
  [DAO DAO Contracts Design](https://github.com/DA0-DA0/dao-contracts/wiki/DAO-DAO-Contracts-Design):
  DAO core, hooks, and registered modules. It MUST NOT require a single voting
  or proposal variant.
- SEZS MUST support any DAO variant that follows the dao-contracts
  specification.
- The only contracts in SEZS contribution scope are dao-calendar and DAO core
  in relation to those modular capabilities and hooks. Event-specific execute
  MUST stay on the session contract and the reused ticket primitives in
  [SEZS-0003](sezs-0003-session-coordinator.md).
- `dao-calendar` MUST remain outside this monorepo.

## Specification

### DAO and module compatibility

A session-hosting DAO is a dao-dao DAO deployed from
[dao-contracts](https://github.com/DA0-DA0/dao-contracts) (the
[permissionlessweb/dao-contracts](https://github.com/permissionlessweb/dao-contracts)
fork MAY be used where SEZS needs calendar or other fork modules). The
canonical module vocabulary is the
[DAO DAO wiki](https://github.com/DA0-DA0/dao-contracts/wiki). The design SEZS
MUST remain compatible with is
[DAO DAO Contracts Design](https://github.com/DA0-DA0/dao-contracts/wiki/DAO-DAO-Contracts-Design):
a DAO core that registers modules, accepts hooks, and does not assume one
fixed voting or proposal implementation.

SEZS orchestration MAY instantiate one working variant (for example a core
with a cw4 voting module, a single-choice proposal module, and a group) in
order to curate a session. That variant is an example, not the only allowed
set. Addresses of a deployed DAO MUST be recorded as deploy state, not as
source constants.

This specification does not change dao-contracts message schemas.

### Contribution scope

The contracts SEZS contributes or maintains for this module are:

| Contract | Role | Home |
| --- | --- | --- |
| DAO core | Core of a dao-dao DAO; modularity, hooks, and module registration that SEZS relies on | [dao-dao-core](https://github.com/DA0-DA0/dao-contracts/tree/main/contracts/dao-dao-core) |
| `dao-calendar` | Calendar module hooked by the suite | [permissionlessweb/dao-contracts](https://github.com/permissionlessweb/dao-contracts/tree/feat/calander) (`feat/calander` @ `af4651407425bfa2b32cb51b03e559f631257e5b`); not copied into permissionlessweb/sezs |

Voting, proposal, group, and other official modules MAY be used by a hosting
DAO. They are not SEZS contribution scope.

### What this module is not

It is not a new DAO implementation. It is not a place to add session-specific
execute messages; those belong on `cw-event-manifold` and cw-ave / cw-420, as
specified in [SEZS-0003](sezs-0003-session-coordinator.md).

## Rationale

Requiring design compatibility, rather than a fixed artifact set, matches how
DAO DAO is actually composed: many DAOs share a core and hooks while choosing
different voting and proposal modules. Limiting SEZS contribution scope to
dao-calendar and the core's modular surface keeps this monorepo honest about
what it owns.

## Reference Implementation

- DAO contracts source: [DA0-DA0/dao-contracts](https://github.com/DA0-DA0/dao-contracts)
- Design: [DAO DAO Contracts Design](https://github.com/DA0-DA0/dao-contracts/wiki/DAO-DAO-Contracts-Design)
- Wiki (full definitions): [DAO DAO wiki](https://github.com/DA0-DA0/dao-contracts/wiki)
- Calendar module: [permissionlessweb/dao-contracts](https://github.com/permissionlessweb/dao-contracts/tree/feat/calander) `feat/calander` @ `af4651407425bfa2b32cb51b03e559f631257e5b`
- Orchestration that can instantiate a compatible variant: [`crates/sezs-orch/`](https://github.com/permissionlessweb/sezs/tree/main/crates/sezs-orch)

## Open Issues

- The exact artifact pin (git revision / checksum) for the official DAO DAO
  wasm used in a production curate is recorded at deploy time; this document
  does not yet cite a frozen checksum table.
- How proposal flow is used in production (if at all beyond bootstrap) is
  not specified here.
