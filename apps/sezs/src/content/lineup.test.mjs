import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { LANES, NIGHT_LEN, clock, fmt } = await import(join(here, 'lineup.ts'))
const fixture = JSON.parse(readFileSync(join(here, '../event/fixture.json'), 'utf8'))

test('times read the evening clock', () => {
  assert.equal(clock('7:00'), 0)
  assert.equal(clock('8:00'), 60)
  assert.equal(clock('12:00'), 300)
  assert.equal(clock('12:50'), 350)
  assert.equal(fmt(350), '12:50')
  assert.equal(fmt(null), 'late')
})

test('fixture lineup handles are anonymous and sit on known lanes', () => {
  const lanes = new Set(LANES.map((l) => l.id))
  for (const s of fixture.lineup) {
    assert.ok(lanes.has(s.lane), s.id)
    assert.doesNotMatch(s.handle, /Morphics|Howhippie|babypufff|Treebug|Chris Baker|Limbus/)
  }
  assert.ok(fixture.lineup.some((s) => s.handle === 'Artist 01'))
  const start = Date.parse(fixture.event.start)
  const end = Date.parse(fixture.event.end)
  assert.equal(Math.round((end - start) / 60000), NIGHT_LEN)
})
