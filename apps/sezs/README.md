# @sezs/app

The Speakeasy **is** this Next.js app. Static HTML was the sketch; do not add it back.

Visual: `public/sezs-assets` → `sezs/sezs-assets` (CSS + print). Auth kernel: `src/auth`. Content: `src/content/event.ts`.

```bash
cd websites/dao-dao-ui
pnpm --filter @sezs/app dev
# http://127.0.0.1:3040
```

Develop on this machine. Copy the app to the development machine when a slice is finished.


## Ticket backend role

The ticket backend never learns the ticket secret. It watches payments, matches
memo commitment `C` to an invoice and amount, appends `C` to the guest list,
stores only ZID-sealed ciphertext, and records nullifiers at the door. Read
`docs/BACKEND-ROLE.md` before changing any payment or door endpoint.

Lab / e2e also spawn a Zafu minirelay on `127.0.0.1:3053`. Tests refuse
`zcash.rotko.net` and any non-loopback relay.

The loopback backend is the Rust `sezs-server` process (one bind, default
`127.0.0.1:3058`) plus `sezs-outpost` (`127.0.0.1:3061`) for usher BLE.

```bash
just sezs-server
just sezs-outpost
NEXT_PUBLIC_SEZS_SPLASH=1 pnpm --filter @sezs/app dev   # Next 127.0.0.1:3051, rewrites /sezs to :3058
pnpm --filter @sezs/app test:ticket
pnpm --filter @sezs/app test:zafu
```
