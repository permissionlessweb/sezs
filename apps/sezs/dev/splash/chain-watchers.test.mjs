import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { applyHits, pollPayments } from './chain-watchers.mjs'
import { ticketV2WasmAvailable } from '../../src/ticket/v2/node.mjs'

describe('local-chain ticket watchers', () => {
  it('is fail-closed when no local session is up', async () => {
    const prev = process.env.SEZS_SESSION_ROOT
    process.env.SEZS_SESSION_ROOT = '/tmp/sezs-session-does-not-exist'
    const r = await pollPayments()
    assert.equal(r.ok, false)
    process.env.SEZS_SESSION_ROOT = prev || ''
  })

  it('applies matching memo commitments onto invoices', () => {
    const paid = []
    const applied = applyHits({}, [
      { rail: 'zec', commitment: 'ab'.repeat(32), txid: 'cd'.repeat(32), amountCents: 2000 },
    ], (_s, c, extra) => {
      paid.push({ c, ...extra })
      return { ok: true }
    })
    assert.equal(applied.length, 1)
    assert.equal(paid[0].txid, 'cd'.repeat(32))
  })

  it('does not mark a mempool hit as paid', (tt) => {
    if (!ticketV2WasmAvailable()) { tt.skip('ticket v2 wasm not built'); return }
    const paid = []
    const applied = applyHits({}, [
      { rail: 'zec', commitment: 'ab'.repeat(32), txid: 'cd'.repeat(32), confirmed: false },
    ], (_s, c, extra) => {
      paid.push({ c, ...extra })
      return { ok: true }
    })
    assert.equal(applied.length, 0)
    assert.equal(paid.length, 0)
  })
})
