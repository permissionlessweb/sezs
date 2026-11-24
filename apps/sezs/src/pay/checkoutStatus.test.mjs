import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PHASE_RANK,
  bumpPhase,
  ownPhase,
  phaseIsPaid,
  statusFromPaid,
  statusMark,
  ticketStepOf,
} from './checkoutStatus.ts'

test('PHASE_RANK matches the SVG mint runtime', () => {
  assert.deepEqual(PHASE_RANK, { waiting: 0, Mempool: 1, Deposited: 2, Entitled: 3, Settled: 4 })
})

test('ownPhase ignores a baseline mempool txid (mint.html semantics)', () => {
  const st = { phase: 'Mempool', mempool: { txid: 'aa' } }
  assert.equal(ownPhase(st, statusMark(st)), 'waiting')
  assert.equal(ownPhase({ phase: 'Mempool', mempool: { txid: 'bb' } }, statusMark(st)), 'Mempool')
})

test('bumpPhase is monotonic', () => {
  assert.equal(bumpPhase('Mempool', 'waiting'), 'Mempool')
  assert.equal(bumpPhase('waiting', 'Mempool'), 'Mempool')
  assert.equal(bumpPhase('Mempool', 'Settled'), 'Settled')
})

test('mempool is never paid; Settled and paid flag at Deposited+ are paid', () => {
  assert.equal(phaseIsPaid('waiting'), false)
  assert.equal(phaseIsPaid('Mempool'), false)
  assert.equal(phaseIsPaid('Deposited'), true)
  assert.equal(phaseIsPaid('Settled'), true)
  assert.equal(phaseIsPaid('Mempool', true), false)
  assert.equal(phaseIsPaid('Settled', true), true)
})

test('ticket UI maps mint phases onto waiting/mempool/confirmed/accepted', () => {
  assert.equal(ticketStepOf('waiting'), 'waiting')
  assert.equal(ticketStepOf('Mempool'), 'mempool')
  assert.equal(ticketStepOf('Deposited'), 'confirmed')
  assert.equal(ticketStepOf('Entitled'), 'accepted')
  assert.equal(ticketStepOf('Settled'), 'accepted')
})

test('statusFromPaid maps invoice paid to Settled and pending to waiting', () => {
  assert.equal(statusFromPaid({ paid: true, status: 'paid' }).phase, 'Settled')
  assert.equal(statusFromPaid({ paid: false, status: 'pending' }).phase, 'waiting')
  assert.equal(statusFromPaid({ paid: false, phase: 'Mempool', invoice: { txid: 'ab' } }).phase, 'Mempool')
})
