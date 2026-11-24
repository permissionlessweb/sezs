import { describe, expect, it } from 'vitest'

import {
  advanceResidualGate,
  buildHermesBoardDeepLink,
  buildResidualCardDraft,
  canSpawnResidualForRow,
  residualSpawnUnlocked,
  RESIDUAL_SPAWN_FORBIDDEN_FLAGS,
} from './hermesBridge'
import type { CommunityInfraComponentRow } from './types'

const redRow: CommunityInfraComponentRow = {
  role: 'buzz',
  label: 'Buzz (canonical)',
  url: 'http://localhost:3000',
  location: 'mesh',
  health: 'red',
  reason: 'Browser probe failed',
  lastProbeAt: '2026-08-03T00:00:00.000Z',
}

describe('buildHermesBoardDeepLink', () => {
  it('appends board label and refuses akash LIVE flag', () => {
    const url = buildHermesBoardDeepLink({
      deepLinkUrl: 'https://ops.terp.network/dao/lab',
      boardLabel: 'community-gateway',
      daoAddress: 'terp1dao',
      chainId: '120u-1',
    })
    const parsed = new URL(url)
    expect(parsed.searchParams.get('board')).toBe('community-gateway')
    expect(parsed.searchParams.get('dao')).toBe('terp1dao')
    expect(parsed.searchParams.get('chain')).toBe('120u-1')
    expect(parsed.searchParams.get('view')).toBe('kanban')
    expect(parsed.searchParams.get('akashLive')).toBe('0')
    expect(parsed.searchParams.get('action')).toBe('open_board')
    expect(parsed.searchParams.get('source')).toBe('community_infra')
  })

  it('includes residual prefill when provided', () => {
    const url = buildHermesBoardDeepLink({
      deepLinkUrl: 'https://ops.example/x',
      boardLabel: 'oline',
      residual: { title: 'RESIDUAL: buzz red', body: 'details here' },
    })
    const parsed = new URL(url)
    expect(parsed.searchParams.get('action')).toBe('spawn_residual')
    expect(parsed.searchParams.get('residualTitle')).toContain('RESIDUAL')
    expect(parsed.searchParams.get('residualBody')).toContain('details')
    expect(parsed.searchParams.get('akashLive')).toBe('0')
  })

  it('returns empty for non-http or blank', () => {
    expect(buildHermesBoardDeepLink({ deepLinkUrl: '' })).toBe('')
    expect(
      buildHermesBoardDeepLink({ deepLinkUrl: 'not-a-url' })
    ).toBe('')
    expect(
      buildHermesBoardDeepLink({ deepLinkUrl: 'ftp://ops.example' })
    ).toBe('')
  })
})

describe('buildResidualCardDraft + dual-gate', () => {
  it('builds residual draft with no LIVE / secrets', () => {
    const draft = buildResidualCardDraft({
      row: redRow,
      instanceLabel: 'lab banana',
      boardLabel: 'community-gateway',
      daoAddress: 'terp1abc',
      chainId: '120u-1',
    })
    expect(draft.noAkashLive).toBe(true)
    expect(draft.title).toMatch(/^RESIDUAL: buzz red/)
    expect(draft.body).toContain('No silent Akash LIVE')
    expect(draft.body).toContain('terp1abc')
    expect(draft.body.toLowerCase()).not.toMatch(/password|apikey|token=/)
    for (const flag of RESIDUAL_SPAWN_FORBIDDEN_FLAGS) {
      expect(draft.body).not.toContain(flag.replace('akashLive=1', 'LIVE=1-secret'))
    }
  })

  it('offers spawn only for non-green health', () => {
    expect(canSpawnResidualForRow('red')).toBe(true)
    expect(canSpawnResidualForRow('canary')).toBe(true)
    expect(canSpawnResidualForRow('unknown')).toBe(true)
    expect(canSpawnResidualForRow('green')).toBe(false)
  })

  it('dual-gate advances 0→1→2 and unlocks only at 2', () => {
    expect(residualSpawnUnlocked(0)).toBe(false)
    expect(residualSpawnUnlocked(1)).toBe(false)
    let g = advanceResidualGate(0, 'ack_no_live')
    expect(g).toBe(1)
    expect(residualSpawnUnlocked(g)).toBe(false)
    g = advanceResidualGate(g, 'confirm_spawn')
    expect(g).toBe(2)
    expect(residualSpawnUnlocked(g)).toBe(true)
    expect(advanceResidualGate(2, 'reset')).toBe(0)
    // cannot skip gate1
    expect(advanceResidualGate(0, 'confirm_spawn')).toBe(0)
  })
})
