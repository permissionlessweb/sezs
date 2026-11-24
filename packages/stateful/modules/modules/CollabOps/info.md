# Collab & Ops (`collab_ops`)

**Kanban:** `t_8365ea2e` (EN-F2) · Prior F6 `t_57f42af3`

## Purpose

One DAO tab that teaches **public vs private** community surfaces and surfaces **DAO-configured endpoints** from `mesh.v1` (storage / billboard text record). Same JSON is the **Nostr discovery payload** (kind `30078` / `terp-collab-ops/v1`).

| Plane | Content | Audience |
|-------|---------|----------|
| Public | Buzz + Nostr relays (info cards; optional live embed) | Always |
| Private | Hermes ops deep-link / URL (member-gated) | Members / admins / hidden |

## Product rules (Phase-1)

1. **Prefer this module** over standalone Buzz + Hermes Ops tabs for visitors.
2. **mesh.v1 only** — no `collab_ops.v1` key. Enable merges `embeds.buzz` / `embeds.hermes`.
3. **Never invent relays or hosts.** Empty → honest empty state + curator CTA.
4. **No browser auto-health** of private/RFC1918 URLs by default.
5. **Identity planes stay separate** — Nostr ≠ ADR-36 ≠ Headscale ≠ Hermes profile.
6. Live iframes are **optional** (`showLiveEmbeds`; default off).

## Non-goals

- Full Hermes product rewrite
- Collapsing `terp-buzz/v1` and `terp-hermes/v1` into one protocol
- Removing standalone Buzz / Hermes Ops embed shells (keep for Event Hub slots)
- Phase-2 gated content client via relayer/oscillator

## Gating rules

- Private plane content mounts only when `canShowPrivatePlane` is true
- Requesting private without access falls back to public (`resolveActivePlane`)
- Hermes URLs / operator context are not mounted for gated viewers

## Related

- `packages/utils/collabDiscovery.ts` — Nostr event draft + filters
- `packages/utils/daoNipRecords.ts` — `curateMeshCollabRecord` / `daoRecordActionCollab`
- Event Hub still composes Work | Collab | Ops for event workflows
- Mesh policy: `docs/superpowers/reviews/2026-08-06-text-record-mesh-endpoint-policy.md`
- Promote matrix: `docs/superpowers/reviews/2026-08-06-collab-ops-event-hub-promote-matrix.md`
