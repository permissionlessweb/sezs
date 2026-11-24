import { describe, expect, it } from 'vitest'

import type { NostrEvent } from '@dao-dao/utils'

import {
  extractCidFromNostr,
  mergeCalendarEvents,
  nostrEventToCalendarPanel,
} from './calendarNostr'
import type { CalendarPanelEvent } from './calendarGrid'

const baseEv = (over: Partial<NostrEvent> & { tags: string[][] }): NostrEvent => ({
  id: over.id || 'abc123',
  pubkey: over.pubkey || 'pk',
  created_at: over.created_at ?? 1_700_000_000,
  kind: over.kind ?? 31923,
  tags: over.tags,
  content: over.content ?? '',
  sig: over.sig || 'sig',
})

describe('calendarNostr', () => {
  it('maps NIP-52 time event to panel event', () => {
    const panel = nostrEventToCalendarPanel(
      baseEv({
        tags: [
          ['d', 'office-hours'],
          ['title', 'Office hours'],
          ['start', '1786114800'],
          ['end', '1786118400'],
        ],
        content: 'Bring questions',
      })
    )
    expect(panel).not.toBeNull()
    expect(panel!.id).toBe('nostr:office-hours')
    expect(panel!.title).toBe('Office hours')
    expect(panel!.start).toContain('T')
    expect(panel!.description).toBe('Bring questions')
  })

  it('extracts bare CID from content', () => {
    const cid = extractCidFromNostr(
      baseEv({
        tags: [['title', 'x'], ['start', '2026-08-10']],
        content: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      })
    )
    expect(cid?.startsWith('bafy')).toBe(true)
  })

  it('merges nostr CID onto chain row by d-tag', () => {
    const base: CalendarPanelEvent[] = [
      {
        id: 'office-hours',
        title: 'Office hours',
        start: '2026-08-10T17:00:00.000Z',
      },
    ]
    const live: CalendarPanelEvent[] = [
      {
        id: 'nostr:office-hours',
        title: 'Office hours',
        start: '2026-08-10T17:00:00.000Z',
        cid: 'bafytestcid',
        description: 'from nostr',
      },
    ]
    const merged = mergeCalendarEvents(base, live)
    expect(merged).toHaveLength(1)
    expect(merged[0].cid).toBe('bafytestcid')
    expect(merged[0].description).toBe('from nostr')
  })

  it('appends pure-nostr events when no chain match', () => {
    const merged = mergeCalendarEvents(
      [{ id: 'a', title: 'A' }],
      [{ id: 'nostr:only', title: 'Only live', start: '2026-08-11T12:00:00Z' }]
    )
    expect(merged).toHaveLength(2)
  })
})
