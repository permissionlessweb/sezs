import { describe, expect, test } from 'vitest'

import { MESH_STORAGE_KEY, parseMeshDescriptor } from '@dao-dao/utils'

import { buildCalendarMeshStorageValue } from './meshValue'

const services = {
  headstashServer: 'https://headstash.terp.network',
  headstashWss: 'wss://headstash.terp.network',
}

describe('buildCalendarMeshStorageValue', () => {
  test('builds mesh.v1 from chain defaults + calendar', () => {
    const raw = buildCalendarMeshStorageValue({
      chainServices: services,
      calendarContract: 'terp1calendar',
    })
    const mesh = parseMeshDescriptor(raw)
    expect(mesh.v).toBe(1)
    expect(mesh.calendar).toBe('terp1calendar')
    expect(mesh.query).toBe('https://headstash.terp.network')
    expect(mesh.relays).toContain('wss://headstash.terp.network')
    expect(MESH_STORAGE_KEY).toBe('mesh.v1')
  })

  test('prefers valid meshJson and fills calendar when missing', () => {
    const raw = buildCalendarMeshStorageValue({
      chainServices: services,
      calendarContract: 'terp1from-module',
      meshJson: JSON.stringify({
        v: 1,
        query: 'https://custom.query',
        relays: ['wss://custom.relay'],
      }),
    })
    const mesh = parseMeshDescriptor(raw)
    expect(mesh.query).toBe('https://custom.query')
    expect(mesh.relays).toEqual(['wss://custom.relay'])
    expect(mesh.calendar).toBe('terp1from-module')
  })

  test('falls back to defaults when meshJson is invalid', () => {
    const raw = buildCalendarMeshStorageValue({
      chainServices: services,
      calendarContract: 'terp1calendar',
      meshJson: '{not-json',
    })
    const mesh = parseMeshDescriptor(raw)
    expect(mesh.calendar).toBe('terp1calendar')
    expect(mesh.query).toBe('https://headstash.terp.network')
  })
})
