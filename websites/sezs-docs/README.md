# Speak-Ez Sessions documentation

Static Vocs site for Speak-Ez Sessions specs, guides, and notes. Visual style follows the event webapp (`apps/sezs`): dark field, amber core, Silkscreen wordmark, serif body — not the Terp Docs theme.

Numbered specifications in `docs/specs/` are the source of truth. `scripts/sync-from-source.py` reads their ZIP-style preambles at `predev` / `prebuild`, writes the specs index and one page per specification, and generates the sidebar. Adjacent in-repo notes (gallery, admin capabilities, proof benchmarks) are copied from their paths in this repository. A clean clone is enough; the script does not look at `~/abstract/sezs-app` or `~/abstract/sezs-lab`. Do not edit the generated copies.

The public event site is https://permissionless.money/sez. Official Zafu downloads are at https://zafu.pro.

## Build

From this directory, on the development machine:

    pnpm install --ignore-workspace
    pnpm build

`pnpm build` runs the sync, `vocs build`, then `scripts/prepare-static.sh`.

Serve the static tree on loopback only:

    python3 -m http.server 3054 --bind 127.0.0.1 --directory out

Do not bind to `0.0.0.0`. This site is not deployed by the build script.

This package applies the same `patches/vocs@2.8.5.patch` as the other Vocs sites in this org. Waku 1.0.0-beta.9 dropped `unstable_events` from `useRouter()`, and the unpatched ScrollRestoration would throw when hydrating the static site.

## Source of truth

- Numbered specifications: `docs/specs/sezs-*.md` (index and sidebar are derived from the preambles)
- Proof benchmarks: `contracts/cw-event-manifold/docs/BENCHMARK.md`
- Digital gallery: `apps/sezs/src/gallery/docs/SPEC.md`
- Admin capabilities: `apps/sezs/src/frost/docs/SPEC.md`

Guides, disclaimers, and the blog index live in `src/pages/` in this site.
