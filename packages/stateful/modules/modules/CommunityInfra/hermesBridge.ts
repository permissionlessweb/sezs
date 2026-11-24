/**
 * CommunityInfra ↔ HermesOps bridge helpers (M3).
 * Pure functions only — safe for unit tests.
 *
 * Design: DESIGN-community-infra-monitor-dashboard.md M3
 * - Deep-link to Hermes board labels (no secret tokens)
 * - Residual card spawn is dual-gated: never silent Akash LIVE
 */

import type {
  CommunityInfraComponentRow,
  CommunityInfraHealth,
} from './types'

/** Dual-gate steps for residual card spawn (not Akash deploy). */
export type ResidualSpawnGate = 0 | 1 | 2

export type ResidualCardDraft = {
  title: string
  body: string
  boardLabel: string
  role: string
  health: CommunityInfraHealth
  /** True when draft is for residual work only (never Akash LIVE). */
  noAkashLive: true
}

export type BuildHermesBoardDeepLinkArgs = {
  deepLinkUrl: string
  boardLabel?: string
  daoAddress?: string
  chainId?: string
  /**
   * Optional residual draft prefill (query params; Hermes may ignore unknown keys).
   * Never includes secrets or apply flags.
   */
  residual?: Pick<ResidualCardDraft, 'title' | 'body'>
  /** Force kanban view when the base URL supports query params. */
  view?: 'kanban' | 'gateway' | 'status'
}

/**
 * Append board / dao / residual draft query params onto a Hermes deep-link.
 * Returns '' when deepLinkUrl is empty or not http(s).
 * Never invents hosts; never adds LIVE/apply flags.
 */
export const buildHermesBoardDeepLink = ({
  deepLinkUrl,
  boardLabel,
  daoAddress,
  chainId,
  residual,
  view = 'kanban',
}: BuildHermesBoardDeepLinkArgs): string => {
  const base = deepLinkUrl?.trim()
  if (!base || !/^https?:\/\//i.test(base)) {
    return ''
  }
  try {
    const url = new URL(base)
    if (boardLabel?.trim()) {
      url.searchParams.set('board', boardLabel.trim())
    }
    if (daoAddress?.trim()) {
      url.searchParams.set('dao', daoAddress.trim())
    }
    if (chainId?.trim()) {
      url.searchParams.set('chain', chainId.trim())
    }
    url.searchParams.set('view', view)
    url.searchParams.set('parent', 'daodao')
    url.searchParams.set('source', 'community_infra')
    if (residual?.title) {
      url.searchParams.set('residualTitle', residual.title.slice(0, 200))
    }
    if (residual?.body) {
      // Cap body so URLs stay usable; full draft is also copyable in UI.
      url.searchParams.set('residualBody', residual.body.slice(0, 1500))
    }
    // Explicit refuse markers — operators + Hermes must not treat as LIVE.
    url.searchParams.set('akashLive', '0')
    url.searchParams.set('action', residual ? 'spawn_residual' : 'open_board')
    return url.toString()
  } catch {
    return ''
  }
}

export type BuildResidualCardDraftArgs = {
  row: CommunityInfraComponentRow
  instanceLabel: string
  boardLabel: string
  daoAddress: string
  chainId: string
}

/**
 * Build a residual kanban card draft from a red/canary matrix row.
 * Never includes apply/LIVE flags or secrets.
 */
export const buildResidualCardDraft = ({
  row,
  instanceLabel,
  boardLabel,
  daoAddress,
  chainId,
}: BuildResidualCardDraftArgs): ResidualCardDraft => {
  const title = `RESIDUAL: ${row.role} ${row.health} · ${instanceLabel}`
  const body = [
    `## Residual from CommunityInfra (dao-dao-ui)`,
    ``,
    `- **instance:** ${instanceLabel}`,
    `- **role:** ${row.role} (${row.label})`,
    `- **health:** ${row.health}`,
    `- **location:** ${row.location}`,
    `- **url:** ${row.url || '—'}`,
    `- **reason:** ${row.reason || '—'}`,
    `- **last_probe:** ${row.lastProbeAt || '—'}`,
    `- **dao:** ${daoAddress}`,
    `- **chain:** ${chainId}`,
    `- **hermes_board:** ${boardLabel}`,
    ``,
    `## Non-goals for this card`,
    `- No silent Akash LIVE / lease create from UI`,
    `- No secrets in card body`,
    `- Dual-gate required before any operator-owned apply path (M4 stubs)`,
    ``,
    `## Suggested next`,
    `1. Reprobe from CommunityInfra admin glass`,
    `2. Open runbook / ENDPOINTS-SSOT`,
    `3. Operator-owned fix; HermesOps for claim only`,
  ].join('\n')

  return {
    title,
    body,
    boardLabel,
    role: row.role,
    health: row.health,
    noAkashLive: true,
  }
}

/**
 * Residual spawn is offered for non-green rows (red/canary/unknown).
 * Green rows do not need residual cards by default.
 */
export const canSpawnResidualForRow = (
  health: CommunityInfraHealth
): boolean => health === 'red' || health === 'canary' || health === 'unknown'

/**
 * Dual-gate state machine for residual spawn.
 * gate0 → gate1 (ack no LIVE) → gate2 (confirm open Hermes) → complete.
 * Never transitions to an Akash LIVE path.
 */
export const advanceResidualGate = (
  current: ResidualSpawnGate,
  event: 'ack_no_live' | 'confirm_spawn' | 'reset'
): ResidualSpawnGate => {
  if (event === 'reset') return 0
  if (event === 'ack_no_live' && current === 0) return 1
  if (event === 'confirm_spawn' && current === 1) return 2
  return current
}

/** Both gates satisfied → operator may open Hermes residual deep-link. */
export const residualSpawnUnlocked = (gate: ResidualSpawnGate): boolean =>
  gate >= 2

/**
 * Honesty: residual spawn action never sets LIVE / apply env flags.
 * Used in tests and UI copy.
 */
export const RESIDUAL_SPAWN_FORBIDDEN_FLAGS = [
  'OLINE_COMMUNITY_AKASH_LIVE',
  'OLINE_BUZZ_AKASH_APPLY',
  'GATE:approve_akash_live',
  'akashLive=1',
] as const
