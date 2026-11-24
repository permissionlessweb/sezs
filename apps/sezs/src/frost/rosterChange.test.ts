import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ackRosterChange,
  canSpend,
  initialRoster,
  isHolder,
  proposeRosterChange,
  recordRekey,
} from './rosterChange.ts'

test('add usher waits for two current holders', () => {
  let s = initialRoster()
  const proposed = proposeRosterChange(s, 'desk', 'vk-next', 'usher', 'add')
  assert.equal(proposed.ok, true)
  if (!proposed.ok) return
  s = proposed.state
  assert.equal(isHolder(s, 'usher'), false)
  assert.equal(s.n, 3)
  const early = ackRosterChange(s, 'usher', 'ack:usher')
  assert.equal(early.ok, false)
  if (early.ok) return
  assert.equal(early.error, 'not_admin')
  const one = ackRosterChange(s, 'desk', 'ack:desk:1')
  assert.equal(one.ok, true)
  if (!one.ok) return
  assert.ok(one.state.pending)
  assert.equal(one.state.groupVk, 'vk-lab')
  const two = ackRosterChange(one.state, 'steward', 'ack:steward:1')
  assert.equal(two.ok, true)
  if (!two.ok) return
  assert.equal(two.state.pending, null)
  assert.equal(two.state.groupVk, 'vk-next')
  assert.equal(two.state.n, 4)
  assert.equal(isHolder(two.state, 'usher'), true)
  assert.equal(canSpend(two.state), 'rekey_incomplete')
})

test('same verifying key is refused', () => {
  const s = initialRoster()
  const r = proposeRosterChange(s, 'desk', 'vk-lab', 'usher', 'add')
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.error, 'same_vk')
  assert.equal(r.state.n, 3)
})

test('remove spare then they cannot propose', () => {
  let s = initialRoster()
  const p = proposeRosterChange(s, 'desk', 'vk-smaller', 'spare', 'remove')
  assert.equal(p.ok, true)
  if (!p.ok) return
  const a = ackRosterChange(p.state, 'desk', 'ack:desk:rm')
  assert.equal(a.ok, true)
  if (!a.ok) return
  const b = ackRosterChange(a.state, 'steward', 'ack:steward:rm')
  assert.equal(b.ok, true)
  if (!b.ok) return
  assert.equal(isHolder(b.state, 'spare'), false)
  assert.equal(b.state.n, 2)
  const again = proposeRosterChange(b.state, 'spare', 'vk-nope', 'usher', 'add')
  assert.equal(again.ok, false)
  if (again.ok) return
  assert.equal(again.error, 'not_admin')
})

test('old acknowledgement cannot be reused', () => {
  let s = initialRoster()
  const p = proposeRosterChange(s, 'desk', 'vk-2', 'usher', 'add')
  assert.equal(p.ok, true)
  if (!p.ok) return
  const a = ackRosterChange(p.state, 'desk', 'ack:replay')
  assert.equal(a.ok, true)
  if (!a.ok) return
  const b = ackRosterChange(a.state, 'steward', 'ack:steward:fresh')
  assert.equal(b.ok, true)
  if (!b.ok) return
  const re = recordRekey(b.state, 'ab'.repeat(32))
  assert.equal(re.ok, true)
  if (!re.ok) return
  s = re.state
  const p2 = proposeRosterChange(s, 'desk', 'vk-3', 'door', 'add')
  assert.equal(p2.ok, true)
  if (!p2.ok) return
  const replay = ackRosterChange(p2.state, 'desk', 'ack:replay')
  assert.equal(replay.ok, false)
  if (replay.ok) return
  assert.equal(replay.error, 'share_replay_epoch')
})

test('cannot shrink below the threshold', () => {
  const s = initialRoster()
  const p = proposeRosterChange(s, 'desk', 'vk-x', 'spare', 'remove')
  assert.equal(p.ok, true)
  if (!p.ok) return
  const a = ackRosterChange(p.state, 'desk', 'a1')
  assert.equal(a.ok, true)
  if (!a.ok) return
  const b = ackRosterChange(a.state, 'steward', 'b1')
  assert.equal(b.ok, true)
  if (!b.ok) return
  const tooFar = proposeRosterChange(b.state, 'desk', 'vk-y', 'steward', 'remove')
  assert.equal(tooFar.ok, false)
  if (tooFar.ok) return
  assert.equal(tooFar.error, 'bad_threshold')
})
