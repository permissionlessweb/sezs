# Speak-Ez Sessions documentation

Static Vocs site for Speak-Ez Sessions specs, guides, and notes. Visual style follows the event webapp (`apps/sezs`): dark field, amber core, Silkscreen wordmark, serif body — not the Terp Docs theme.

Specs are written next to the code. `scripts/sync-from-source.py` copies `SPEC.md` and `BENCHMARK.md` into `src/pages/specs/` at `predev` / `prebuild`. Files named `INTERNAL*` stay next to the source and are never copied. Do not edit the generated copies.

The public event site is https://permissionless.money/sez. Official Zafu downloads are at https://zafu.pro.

## Build

From this directory, on build-host:

    pnpm install --ignore-workspace
    pnpm build

`pnpm build` runs the sync, `vocs build`, then `scripts/prepare-static.sh`.

Serve the static tree on loopback only:

    python3 -m http.server 3054 --bind 127.0.0.1 --directory out

Do not bind to `0.0.0.0`. This site is not deployed by the build script.

This package applies the same `patches/vocs@2.8.5.patch` as the other Vocs sites in this org. Waku 1.0.0-beta.9 dropped `unstable_events` from `useRouter()`, and the unpatched ScrollRestoration would throw when hydrating the static site.

## Source of truth

- Event contract: `cw-ave/contracts/cw-event-manifold/docs/SPEC.md`
- Proof benchmarks: `cw-ave/contracts/cw-event-manifold/docs/BENCHMARK.md`
- Ticketing: `sezs-ticket-v2/docs/SPEC.md`
- Digital gallery: `apps/sezs/src/gallery/docs/SPEC.md`
- Admin capabilities: `apps/sezs/src/frost/docs/SPEC.md`

Guides, disclaimers, and the blog index live in `src/pages/` in this site.
