import { describe, expect, test } from 'vitest'

import { parseMeshDescriptor } from '@dao-dao/utils'

import { buildEventHubMeshStorageValue } from './meshValue'
import { EventHubModuleData } from './types'

const baseData = (over: Partial<EventHubModuleData> = {}): EventHubModuleData => ({
  description: 'Audit event hub',
  calendarContract: 'terp1cal',
  ceremonyContract: 'terp1cer',
  bountiesEmbedBaseUrl: 'https://bounties.example',
  buzzEmbedBaseUrl: 'https://buzz.example',
  hermesEmbedBaseUrl: 'https://ops.example',
  registrationPolicy: 'ceremony',
  buzzGate: 'dao-member',
  hermesVisibility: 'only-members',
  bountiesDefaultView: 'members',
  ...over,
})

describe('buildEventHubMeshStorageValue', () => {
  const services = {
    headstashServer: 'https://headstash.terp.network',
    headstashWss: 'wss://headstash.terp.network',
  }

  test('writes ceremony + embeds + eventDefaults', () => {
    const raw = buildEventHubMeshStorageValue({
      chainServices: services,
      data: baseData(),
    })
    const p = parseMeshDescriptor(raw)
    expect(p.calendar).toBe('terp1cal')
    expect(p.ceremony).toBe('terp1cer')
    expect(p.embeds?.bounties).toBe('https://bounties.example')
    expect(p.embeds?.buzz).toBe('https://buzz.example')
    expect(p.embeds?.hermes).toBe('https://ops.example')
    expect(p.eventDefaults?.requireRegistration).toBe(true)
    expect(p.eventDefaults?.buzzGate).toBe('dao-member')
    expect(p.relays).toEqual(['wss://headstash.terp.network'])
  })

  test('preserves marketplace when merging existing mesh', () => {
    const existing = JSON.stringify({
      v: 1,
      query: 'https://headstash.terp.network',
      relays: ['wss://headstash.terp.network'],
      marketplace: { fixedPrice: 'terp1fp', modes: ['fixed'] },
      auth: { planes: ['pfpk'], default: 'pfpk' },
    })
    const raw = buildEventHubMeshStorageValue({
      chainServices: services,
      data: baseData({ meshJson: undefined }),
      existingMeshJson: existing,
    })
    const p = parseMeshDescriptor(raw)
    expect(p.marketplace?.fixedPrice).toBe('terp1fp')
    expect(p.ceremony).toBe('terp1cer')
    expect(p.embeds?.buzz).toBe('https://buzz.example')
  })
})
