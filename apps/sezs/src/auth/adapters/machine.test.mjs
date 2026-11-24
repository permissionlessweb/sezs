import assert from 'node:assert/strict'
import { test } from 'node:test'

import { idleAdapter, reduceAdapter } from './machine.ts'

test('adapter state machine: idle → connecting → connected', () => {
  let s = idleAdapter()
  assert.equal(s.phase, 'idle')
  s = reduceAdapter(s, { type: 'start' })
  assert.equal(s.phase, 'connecting')
  const again = reduceAdapter(s, { type: 'start' })
  assert.equal(again.phase, 'connecting')
  s = reduceAdapter(s, { type: 'waiting' })
  assert.equal(s.waiting, true)
  s = reduceAdapter(s, { type: 'success', identity: { kind: 'zid', id: 'ab'.repeat(32) } })
  assert.equal(s.phase, 'connected')
  assert.equal(s.identity.kind, 'zid')
})

test('adapter state machine: idle → connecting → error, then reset', () => {
  let s = reduceAdapter(idleAdapter(), { type: 'start' })
  s = reduceAdapter(s, { type: 'fail', error: 'denied' })
  assert.equal(s.phase, 'error')
  assert.equal(s.error, 'denied')
  s = reduceAdapter(s, { type: 'success', identity: { kind: 'zid', id: 'x' } })
  assert.equal(s.phase, 'error', 'success is ignored after error until reset')
  s = reduceAdapter(s, { type: 'reset' })
  assert.equal(s.phase, 'idle')
})

test('waiting and fail are ignored unless connecting', () => {
  const idle = idleAdapter()
  assert.equal(reduceAdapter(idle, { type: 'waiting' }).phase, 'idle')
  assert.equal(reduceAdapter(idle, { type: 'fail', error: 'x' }).phase, 'idle')
})
