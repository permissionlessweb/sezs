import type { GatewayEntry } from './types'

/** Default markdown intro for the unified gateways tab. */
export const DEFAULT_COMMUNITY_GATEWAYS_DESCRIPTION = [
  '**Community gateways** — how this DAO talks in public (Buzz) and coordinates operators (Hermes).',
  '',
  'These are **outbound links and setup steps**. Hermes dashboards are not embedded in the DAO UI yet; open the gateway your operators publish. Buzz rooms stay on Nostr identity (not your Cosmos wallet session).',
].join('\n')

/**
 * Lab-friendly starter entries (overridden by mesh + env when present).
 * Relay WSS is informational only — never iframe.
 */
export const LAB_STARTER_GATEWAYS: GatewayEntry[] = [
  {
    id: 'lab-buzz-embed',
    kind: 'buzz',
    label: 'Lab Buzz (HTTP / open shell)',
    // Event-night (2026-08-07): build-host local buzz-prod when deploy-host is RED.
    // Canonical when G2 up: http://localhost:3000 — see NOSTR-ENV.md.
    url: 'http://127.0.0.1:3001',
    visibility: 'public',
    note: 'Open in new tab / client. Do not iframe raw relay root. Prefer HTTPS public host when deployed.',
  },
  {
    id: 'lab-buzz-relay',
    kind: 'buzz',
    label: 'Lab Buzz (Nostr relay + mobile push)',
    url: 'http://127.0.0.1:3001',
    relayWss: 'ws://127.0.0.1:3001',
    visibility: 'public',
    note: 'NIP-11 + push (APNS profiles). Mobile-relay = this push plane, not a separate host. Restore G2:3000 when LAN path returns.',
  },
  {
    id: 'lab-hermes',
    kind: 'hermes',
    label: 'Lab Hermes (ops gateway)',
    url: 'http://127.0.0.1:9119',
    visibility: 'operators',
    note: 'Operator surface (kanban / gateway). Separate identity plane from Nostr. Members get URL + steps; no live dashboard embed in SDA yet.',
  },
]

export const BUZZ_CONNECT_STEPS: string[] = [
  'Install or open a Buzz / Nostr-capable client that can reach the gateway URL (or WSS relay) published below.',
  'Create or import a **Nostr key** for Buzz. This is separate from Keplr / passkey / ADR-36 DAO auth.',
  'Add the relay WSS (if listed) or open the public web UI URL. Join rooms labeled for this DAO or event.',
  'For **member-gated** rooms, the parent DAO may later attest membership (ADR-36) — that never replaces your Nostr login.',
  'Never paste nsec, Hermes tokens, or bounty JWT into kanban comments or public channels.',
]

export const HERMES_CONNECT_STEPS: string[] = [
  'Hermes is the **operator / agent** plane (profiles, kanban boards, gateways) — not the public Nostr social feed.',
  'Open the registered Hermes gateway URL in a new tab (dashboard or deep-link your operators publish).',
  'Use a Hermes profile bound to your device/session. Board access is profile + membership policy — not this SDA iframe.',
  'DAO members: ask a curator which **board slug** and **event id** (if any) apply. Operators: prefer OnlyMembers boards.',
  'Live Hermes **dashboard embed inside the DAO tab is deferred**. This module only lists gateways and steps until embed UI ships.',
]

/** Soft lab mesh fragment when on-chain mesh.v1 is empty (120u-1). */
export const buildLabGatewayMeshJson = (): string => {
  const buzz =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_BUZZ_EMBED) ||
    'http://127.0.0.1:3001'
  const hermes =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_HERMES_EMBED) ||
    'http://127.0.0.1:9119'
  const relay =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_BUZZ_WSS) ||
    'ws://127.0.0.1:3001'
  return JSON.stringify({
    v: 1,
    relays: [relay],
    query: '',
    embeds: { buzz, hermes },
  })
}
