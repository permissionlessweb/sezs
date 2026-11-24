import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  emptyTree, loadTree, saveTree, mergeLeaves, rebuildFromPayments,
} from './ticket-leaves.mjs'

const A = 'aa'.repeat(32)
const B = 'bb'.repeat(32)
const C = 'cc'.repeat(32)

test('mergeLeaves is append-only and de-duplicates', () => {
  assert.deepEqual(mergeLeaves([A], [A, B, A]), [A, B])
  assert.deepEqual(mergeLeaves([], [B, A]), [B, A])
})

test('rebuildFromPayments keeps existing order and appends by height', () => {
  const tree = { ...emptyTree(), leaves: [A] }
  const next = rebuildFromPayments(tree, [
    { commitment: C, txid: 'tx-c', height: 20, rail: 'zec' },
    { commitment: B, txid: 'tx-b', height: 10, rail: 'penumbra' },
    { commitment: A, txid: 'tx-a', height: 5, rail: 'zec' },
  ])
  assert.deepEqual(next.leaves, [A, B, C])
  assert.equal(next.payments.length, 3)
})

test('save and load round-trip under a session root', () => {
  const root = mkdtempSync(join(tmpdir(), 'sezs-leaves-'))
  try {
    const saved = saveTree(root, { ...emptyTree(), eventId: 'speakez-sessions', leaves: [A, B] })
    assert.ok(saved && saved.endsWith('ticket-v2-tree.json'))
    const loaded = loadTree(root)
    assert.deepEqual(loaded.leaves, [A, B])
    assert.equal(loaded.eventId, 'speakez-sessions')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
