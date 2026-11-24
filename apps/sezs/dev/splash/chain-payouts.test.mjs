import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { chainsReady, frostGate, loadSession } from './chain-payouts.mjs'

describe('local-chain payroll payouts', () => {
  it('describes the FROST gate as an approval-gated treasury by default', () => {
    const prev = process.env.SEZS_FROST_SPEND
    delete process.env.SEZS_FROST_SPEND
    const g = frostGate()
    assert.equal(g.kind, 'approval-gated-treasury')
    assert.match(g.note, /treasury/i)
    process.env.SEZS_FROST_SPEND = prev || ''
  })

  it('is fail-closed when the ict-rs session has no local chains', () => {
    const prev = process.env.SEZS_SESSION_ROOT
    process.env.SEZS_SESSION_ROOT = '/tmp/sezs-session-does-not-exist'
    const ready = chainsReady(loadSession('/tmp/sezs-session-does-not-exist'))
    assert.equal(ready.ok, false)
    process.env.SEZS_SESSION_ROOT = prev || ''
  })
})
