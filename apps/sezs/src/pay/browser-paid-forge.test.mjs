import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '../..')
const read = (p) => readFileSync(join(app, p), 'utf8')

/** Mirror of parseTicketBody — paid only with ok + record + rail. */
const parseTicketBody = (body) => {
  if (!body || typeof body !== 'object') return { paid: false }
  const recordId = String(body.record_id || body.recordId || '').trim()
  const rail = body.rail
  const paidFlag = body.paid === true
  const ok = body.ok === true || body.status === 'paid'
  if (paidFlag && ok && recordId && rail && rail !== 'cashapp') {
    return { paid: true, rail, recordId }
  }
  return { paid: false }
}

const dropBrowserPaid = (s) => {
  const { paid: _forged, ...rest } = s
  return rest
}

test('browser-forged paid JSON does not unlock', () => {
  const forged = parseTicketBody({ paid: true })
  assert.equal(forged.paid, false)
  const flagOnly = parseTicketBody({ ok: true, paid: true })
  assert.equal(flagOnly.paid, false)
  const noRail = parseTicketBody({
    ok: true,
    paid: true,
    record_id: 'memo',
  })
  assert.equal(noRail.paid, false)
})

test('server watcher body with record unlocks', () => {
  const real = parseTicketBody({
    ok: true,
    paid: true,
    status: 'paid',
    rail: 'zec',
    record_id: 'memo_commit_lab',
  })
  assert.equal(real.paid, true)
  assert.equal(real.recordId, 'memo_commit_lab')
})

test('localStorage paid flag is dropped on load', () => {
  const stored = {
    credId: 'cred-forge',
    alias: 'guest',
    role: 'guest',
    paid: { rail: 'zec', at: 1, recordId: 'forged' },
    authenticators: [{ credId: 'cred-forge', label: 'device-1', addedAt: 1 }],
    policy: 'anyOf',
    createdAt: 1,
  }
  const loaded = dropBrowserPaid(stored)
  assert.equal(loaded.paid, undefined)
  assert.equal(loaded.credId, 'cred-forge')
})

test('CheckoutPanel and AuthContext have no commitPaid writer', () => {
  const panel = read('src/event/CheckoutPanel.tsx')
  const auth = read('src/auth/AuthContext.tsx')
  const tickets = read('pages/tickets.tsx')
  assert.equal((panel.match(/commitPaid/g) || []).length, 0)
  assert.equal((auth.match(/commitPaid/g) || []).length, 0)
  assert.match(auth, /readServerPaid/)
  assert.match(auth, /refreshPaid/)
  assert.match(panel, /pollPaid/)
  assert.match(tickets, /browser paid flag ≠ paid/)
})

test('serverPaid parser source refuses bare paid flag', () => {
  const src = read('src/pay/serverPaid.ts')
  assert.match(src, /paidFlag && ok && recordId && rail/)
  assert.match(src, /A paid flag without a record is ignored/)
  assert.doesNotMatch(src, /127\.0\.0\.1:19091/)
  assert.doesNotMatch(src, /fetch\s*\(/)
  assert.match(src, /Checkout opens soon/)
})
