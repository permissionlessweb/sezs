# sezs-server

Rust port of the Speak-Ez Sessions backend processes, starting with the
production session service (sezs-0010 / sezs-0012 login). It is a thin
product binary meant to implement `hash-market::sezs::SezsService` once
the `sezs/service-trait` SHA is on origin (currently local-only at
`e01e9fe734eb128735d6c5cb1f8d02536efbf7c2` in the terp-rs worktree). Until
that SHA can be pinned through `tools/deps`, this crate does not depend
on hash-market and can be built and tested on its own.

Session parity lives in `tests/session_parity.rs` and follows
`apps/sezs/server/session.test.mjs`.

The process binds 127.0.0.1 only unless `SEZS_ALLOW_NON_LOOPBACK=1`.
Production (`NODE_ENV=production` or `SEZS_ENV=production`) refuses to
boot without `SEZS_SESSION_SECRET` or `SEZS_SESSION_SECRET_FILE`.

Ticketing, email, FROST payroll, and the Bluetooth outpost are not in
this crate yet. They will share this binary's one bind (the Node
session port 3058 clash).
