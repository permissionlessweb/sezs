# sezs-server

Rust port of the Speak-Ez Sessions backend processes. The thin `sezs-server`
binary implements `hash_market::sezs::SezsService` and mounts those routes
at `/sezs` (with `/itl` as an alias) on a single 127.0.0.1 bind. That is
the fix for the Node clash where session and email both defaulted to port
3058.

## hash-market dependency

`hash-market` is a fork-only crate in permissionlessweb/terp-rs (not on
crates.io). The committed `Cargo.toml` line is a git dep at
`b782ea404049d87fabd4f72510136fd1a16198b4` (`sezs/service-trait`).

`just deps-patch-git` cannot fetch that SHA until the branch is pushed to
origin. For local builds:

```
# SEZS_CRATES_ROOT must contain a `terp-rs` checkout of sezs/service-trait
# (symlink the worktree if needed).
export SEZS_CRATES_ROOT=/path/to/crates-root
# Only rewrite git-only path patches (keep patch-git for crates.io):
export SEZS_DEPS_GIT_ONLY=1
just deps-patch-local
```

`just deps-patch-local` writes a `[patch."https://github.com/permissionlessweb/terp-rs"]`
path override into `crates/Cargo.toml`. That change must not be committed.
Restore with `just deps-patch-git` before committing workspace manifests.

## Session

Parity: `tests/session_parity.rs` follows `apps/sezs/server/session.test.mjs`.
Production (`NODE_ENV=production` or `SEZS_ENV=production`) refuses to boot
without `SEZS_SESSION_SECRET` or `SEZS_SESSION_SECRET_FILE`.

## Ticketing

Invoice, payment watch, public leaves, envelopes, and door consume (P1–P3)
live under `src/ticketing/`. Rust tests follow the splash Node tests and
are named after the Quint predicates. The public tree root is the circuit-identical Poseidon `P128Pow5T3` hash
from `circuits/sezs-ticket-v2` (same as the Node wasm `treeRoot`). Legacy
custom-suite vectors in `apps/sezs/src/ticket/ticket.test.mjs` are stale and
must not be rewritten to match.

The process binds 127.0.0.1 only unless `SEZS_ALLOW_NON_LOOPBACK=1`.
Default port is 3058 (`SEZS_BIND` or `SEZS_SESSION_PORT`).

## Email

Email sign-in (`src/email/`) is behind a provider adapter trait. The core
ships a file sink for dev and never links a vendor SDK. Routes live at
`/sezs/auth/email/*` and are mounted only when `SEZS_EMAIL_ENABLE=1`, so
email stays hidden on the public alpha by default.
