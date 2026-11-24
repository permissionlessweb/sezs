```
ZIP: SEZS-0012
Title: Email Process
Owners: SEZS contributors <noreply@permissionless.money>
Status: Draft
Category: Interface
Created: 2026-11-24
License: Apache-2.0
```

## Terminology

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "RECOMMENDED",
"OPTIONAL", and "REQUIRED" in this document are to be interpreted as described
in BCP 14 when, and only when, they appear in all capitals.

- **Email process.** The backend that issues email-login challenges, delivers
  them through a provider adapter, verifies them, and binds the resulting
  session to a passkey or ZID when requested.
- **Provider adapter.** A narrow send interface. The core process MUST NOT
  import a vendor SDK.

## Abstract

SEZS offers email as a self-hosted sign-in path, not as a public identity
on the alpha site. This document specifies issuance, rate limits, the
delivery adapter, session binding, and the threat model. The default From
identity is `sezs@permissionless.money`. Production DNS and the mail
provider itself are operational issues (see Open Issues).

## Motivation

Passkey and ZID are the primary authenticators. Email is a recovery and
convenience path that has to work without handing mailbox custody to the
event app. A provider adapter lets operations plug a sender without
baking a vendor into the core crate.

## Privacy Implications

Email addresses are personal data. They MUST NOT be published on the
alpha front end. They MUST NOT be logged in full. Challenges MUST be
single-use and short-lived. A delivery failure MUST NOT still store a
usable challenge. Binding to a passkey or ZID is opt-in and MUST be
authenticated as that authenticator.

## Requirements

- The core process MUST NOT depend on a vendor email SDK.
- Challenges MUST be single-use, expiry-bounded, and rate-limited by
  address and by source.
- Default From MUST be `sezs@permissionless.money` unless explicitly
  overridden by configuration.
- Email addresses MUST stay hidden on the public alpha UI.
- The Email process MUST nest on the same bind as Session and Ticketing.

## Specification

### Routes

- `GET  /sezs/auth/email/health`
- `POST /sezs/auth/email/request`
- `POST /sezs/auth/email/verify`
- `GET  /sezs/auth/email/session`
- `POST /sezs/auth/email/logout`
- `POST /sezs/auth/email/bind-challenge`
- `POST /sezs/auth/email/bind`

### Issuance and verification

`request` accepts an email address, creates a one-time challenge, and
hands a message to the adapter. `verify` consumes that challenge and
establishes a session. `logout` ends it.

### Adapter

The adapter has one required method: send a message (from, to, subject,
body). In development, the adapter MUST be a local file or in-memory
sink with no network egress. Production plugs a single adapter behind
the same interface. SMTP, IMAP, and vendor SDKs, if used, live only in
that adapter.

### Binding

`bind-challenge` and `bind` attach a verified passkey or ZID to the
email session, or refuse. They MUST NOT silently invent a binding.

### Rate limits and store

The store MAY be the same SQLite WAL as Session (sezs-0010). Rate limits
MUST cover request and verify. Persisted challenge files, if any, MUST
be created with restrictive permissions.

## Rationale

Keeping vendors out of the core crate follows the self-hosted email
decision and makes the Rust port testable with a memory sink.

## Reference Implementation

- Current Node: `apps/sezs/dev/splash/email-*.mjs`
- Target Rust: `crates/sezs-server` (provider adapter, no vendor SDK)

## Open Issues

- The production provider and DNS for `sezs@permissionless.money` are
  still an operational decision.
- Whether email sign-in is offered on the public alpha, or only on staff
  surfaces, follows the standing rule that email stays hidden on the
  alpha; the exact UI treatment is not restated here.
