# Statically embedding the SEZS event front end on-chain

The front end is a reusable static app: it takes a **contract address + chain config** (`lcd`, `chainId`) and renders the `EventView` (`sezs-event-v2`) from that contract (or an optional off-chain `metadata_uri` whose SHA-256 is `metadata_hash`). There is no hardcoded night, bill, or price in the UI path.

## What we searched for (headstash “front-end contract”)

The owner asked to use the same on-chain static front-end contract design as the Headstash UI. A dedicated CosmWasm crate that *stores and serves the Headstash HTML/JS bundle* was **not found** in the trees searched on build-host (`~/src/terp-core/crates/headstash`, `~/src/terp-core/crates/cw-headstash`, `~/src/terp-core/websites`, `<repo>/e2e/lab`). Closest artifacts, which this embed design follows:

| Path | What it actually is |
|---|---|
| `~/src/terp-core/crates/headstash/docs/circuit/HEADSTASH-UI-HANDOFF-2026-10-05.md` | Claim **page** talks to `contracts/cw-headstash`. Not a site-hosting contract. |
| `~/src/terp-core/crates/headstash/docs/circuit/frontend.md` | egui + wasm dashboard / wallet bridge. |
| `~/src/terp-core/crates/headstash/docs/circuit/FE-CLAIM-SPEC.md` | Older claim UI outcome sheet. |
| `~/src/terp-core/websites/load-once-shell.md` | terp.network **static HTML** multi-page shell (`output` of complete static pages + a ~10 KB gzipped shell). Not CosmWasm. |
| `~/src/terp-core/websites/permissionless.money/docs/HANDOFF-STATIC-PUSH-2026-09-02.md` | Static `dist/` mirror to an object bucket (oline). Not on-chain. |
| `~/src/_worktrees/terp-rs-smart-account/crates/cw-svg` (and `cw_svg_minter.wasm`) | Helper / minter for **on-chain SVG templates** (NFT payloads, size limits). Closest *contract* pattern for storing bytes on-chain, but it is an art minter, not a website host. |

If a Headstash HTML-store contract lives under another name, it was not located in this pass. SEZS therefore documents a static-export embed that can sit behind **the same operational shape** already used for Terp static sites, plus an optional future CosmWasm object store modeled on cw-svg’s “template bytes + hash + size cap” idea. **This pass builds and sizes the export; it does not upload on-chain or to a bucket.**

## What the static bundle must do

1. `next.config.js` already sets `output: 'export'` (splash dev disables this only for `next dev`). `pnpm --filter @dao-dao/sezs build` writes `apps/sezs/out/`.
2. No server runtime. All event content comes from LCD `EventView` or, if the record has `metadata_uri` + `metadata_hash`, a fetch of that URI after the hash matches.
3. Boot parameters are not baked to a single night:
   - query string `?contract=&lcd=&chainId=`
   - or `window.__SEZS_BOOT = { contract, lcd, chainId }` injected by the host shell
   - or `NEXT_PUBLIC_SEZS_*` at build time for a one-event snapshot
4. Bind only to the event contract `domain`. Lab origin is `http://127.0.0.1:3051`.
5. Keep the bundle small: no wallet SDKs that pull Node polyfills into every page if they can be lazy; images unoptimized (already); prefer one shared JS chunk.

## Hosting options (when upload is approved later)

**A. Static host / load-once shell (matches terp.network).** Serve `out/` as complete static pages. A thin shell can inject `__SEZS_BOOT` from the path or from a DAO proposal. Same rules as `load-once-shell.md`.

**B. Content-addressed object bucket** (matches permissionless.money handoff). Mirror the whole `out/` (HTML + `_next/static` + public). Record the root hash on the event contract as `metadata_uri` / a future `frontend_uri` + `frontend_hash`.

**C. CosmWasm object store (cw-svg-shaped, not written in this pass).** A contract that accepts packed assets (`path → bytes`, max size per item, SHA-256), queried by path. A tiny boot HTML (or the load-once shell) would fetch `/index.html` and `/_next/...` from that contract. Wasm message size and gas will almost certainly require chunked upload and a CID of the manifest. Do not invent this crate until the missing Headstash contract is confirmed or a new one is explicitly commissioned.

## This pass

- Build the static export on build-host and record raw / gzip sizes in the work report.
- Do **not** store, instantiate, or upload the bundle on any chain or bucket.
