import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const { doorView, metadataLeaksRoster } = await import('./door.ts')

test('unset LCD is an honest empty, not a door', () => {
  const v = doorView({ lcdSet: false, calendarSet: false })
  assert.equal(v.lookup, false)
  assert.equal(v.cwAve, null)
  assert.match(v.text, /not published/)
})

test('bad pointer is not treated as a contract', () => {
  const v = doorView({
    lcdSet: true,
    calendarSet: true,
    cwAve: 'not-an-address',
  })
  assert.equal(v.cwAve, null)
  assert.match(v.text, /not a Terp contract/)
})

test('a terp1 pointer is a cache, not attendance', () => {
  const v = doorView({
    lcdSet: true,
    calendarSet: true,
    cwAve: 'terp1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg6p2x0',
  })
  assert.equal(v.lookup, true)
  assert.ok(v.cwAve)
  assert.match(v.text, /does not mark you in/)
})

test('metadata must not carry a roster or RSVP kind', () => {
  assert.equal(metadataLeaksRoster('{"title":"night"}'), false)
  assert.equal(metadataLeaksRoster('{"alias":"ada"}'), true)
  assert.equal(metadataLeaksRoster('kind 31925 accepted'), true)
})

test('frame field is lazy and honours reduced motion', () => {
  const frame = readFileSync(join(here, '../ui/Frame.tsx'), 'utf8')
  const field = readFileSync(join(here, '../ui/Field.tsx'), 'utf8')
  assert.match(frame, /dynamic\(/)
  assert.match(frame, /Field/)
  assert.match(field, /prefers-reduced-motion/)
})

test('door page does not consume', () => {
  const src =
    readFileSync(join(here, 'DoorPointer.tsx'), 'utf8') +
    readFileSync(join(here, '../event/CheckInPanel.tsx'), 'utf8')
  assert.doesNotMatch(src, /check_in_guest\s*\(/)
  assert.doesNotMatch(src, /kind:\s*31925|REQ[\s\S]{0,40}31925/)
  const pointer = readFileSync(join(here, 'DoorPointer.tsx'), 'utf8')
  assert.match(pointer, /smartQueryUrl/)
  assert.doesNotMatch(pointer, /contract\/\$\{/)
})

test('DoorPointer logs an unpublished door; it does not render the copy', () => {
  const pointer = readFileSync(join(here, 'DoorPointer.tsx'), 'utf8')
  assert.match(pointer, /console\.(info|warn)/)
  assert.match(pointer, /return null/)
  assert.doesNotMatch(pointer, /<p className="honest"/)
})
