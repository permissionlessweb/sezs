import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as L from './lib.mjs'

const fake = ({ id, kind, role }) => ({ id, kind, role, address: `terp1${id}`, pubHex: '02' + '11'.repeat(32), credId: `splash-${id}`, createdAt: 0 })

test('bech32 matches BIP-173 vectors', () => {
  assert.equal(L.bech32('a', []), 'a12uel5l')
})

test('test keys derive a terp1 address and round-trip', () => {
  const k = L.newTestKey()
  assert.match(k.address, /^terp1[02-9ac-hj-np-z]{38}$/)
  assert.equal(L.publicOf(k.secretHex).address, k.address)
})

test('public state and tab session never carry a secret', () => {
  const k = L.newTestKey()
  const r = L.seed('clean', (s) => ({ ...fake(s), pubHex: k.pubHex, secretHex: k.secretHex }))
  const out = JSON.stringify(L.publicState(r.state, 'admin-1')) + JSON.stringify(L.tabSession(r.state.identities[0]))
  assert.ok(!out.includes(k.secretHex))
  assert.ok(!/secret/i.test(out))
})

test('clean: 6 identities, 3 paid tickets, allowlist has admin-1, coord-1 + usher-1', () => {
  const { state: s } = L.seed('clean', fake)
  assert.equal(s.identities.length, 6)
  assert.deepEqual(s.tickets.map((t) => t.status), ['paid', 'paid', 'paid'])
  const al = L.allowlistOf(s)
  assert.deepEqual(al.admins.map((a) => a.id), ['admin-1'])
  assert.deepEqual(al.ushers.map((a) => a.id), ['usher-1'])
  assert.equal(L.roleOf(s, 'guest-zafu'), 'guest')
  assert.equal(L.roleOf(s, 'nobody'), null)
})

test('door: usher admits once; replay, guest, unpaid and unknown are refused', async () => {
  const { state: s } = L.seed('clean', fake)
  const t = s.tickets[0].id
  assert.equal((await L.consume(s, 'usher-1', t)).ok, true)
  assert.equal((await L.consume(s, 'usher-1', t)).error, 'already_used')
  assert.equal((await L.consume(s, 'guest-zafu', s.tickets[1].id)).error, 'not_usher')
  assert.equal((await L.consume(s, 'admin-1', s.tickets[1].id)).error, 'not_usher')
  assert.equal((await L.consume(s, 'usher-1', 'tkt-nope')).error, 'unknown_ticket')
  const p = L.issueTicket(s, 'guest-eph', { status: 'pending' }).ticket
  assert.equal((await L.consume(s, 'usher-1', p.id)).error, 'unpaid')
  assert.equal(L.markPaid(s, p.id).ok, true)
  assert.equal((await L.consume(s, 'usher-1', p.id)).ok, true)
})

test('presets: door rush, sold out, payment pending, replay', () => {
  const rush = L.seed('door-rush', fake).state
  assert.equal(rush.tickets.filter((t) => t.status === 'used').length, 4)
  assert.equal(L.allowlistOf(rush).ushers.length, 2)
  const sold = L.seed('sold-out', fake).state
  assert.equal(sold.tickets.length, 6)
  assert.ok(sold.log.some((l) => /sold out/.test(l.msg)))
  assert.equal(L.issueTicket(sold, 'admin-1').error, 'sold_out')
  const pend = L.seed('payment-pending', fake).state
  assert.equal(pend.tickets.filter((t) => t.status === 'pending').length, 2)
  assert.equal(pend.dregg.zec, 'pending')
  const rep = L.seed('replay', fake).state
  assert.equal(rep.tickets[0].status, 'used')
  assert.ok(rep.log.some((l) => /already_used/.test(l.msg)))
})

test('unknown preset and bad rail fail closed', () => {
  assert.equal(L.seed('mainnet', fake).ok, false)
  const { state: s } = L.seed('clean', fake)
  assert.equal(L.issueTicket(s, 'guest-eph', { rail: 'cashapp' }).error, 'bad_rail')
})

test('lab watcher marks paid by memo C; v2 invoices refuse correlators; secret stays off public state', async () => {
  const { newSecret, ticketRecord, toHex, nullifierOf, EVENT_ID } = await import('../../src/ticket/commitment.mjs')
  const { ticketKeypair } = await import('../../src/ticket/auth.mjs')
  const { state: s } = L.seed('clean', fake)
  const secret = newSecret(() => { const b = new Uint8Array(32); b[0] = 3; return b })
  const rec = ticketRecord({ secret, rail: 'zec' })
  const pair = await ticketKeypair({ secret, eventId: EVENT_ID, domain: 'http://127.0.0.1:3051' })
  const refused = L.issueInvoice(s, { rail: 'zec', commitment: rec.commitmentHex, ticketPubkey: pair.publicHex, nullifier: toHex(nullifierOf(secret, EVENT_ID)) })
  assert.equal(refused.ok, false)
  assert.equal(refused.error, 'v2_no_correlators')
  const issued = L.issueInvoice(s, { rail: 'zec', commitment: rec.commitmentHex })
  assert.equal(issued.ok, true)
  assert.ok(!issued.invoice.ticketPubkey)
  assert.ok(!issued.invoice.nullifier)
  assert.equal(L.markPaidByCommitment(s, rec.memo).ok, true)
  const out = JSON.stringify(L.publicState(s, 'usher-1'))
  assert.ok(!out.includes(rec.secretHex))
  assert.ok(!out.includes(toHex(secret)))
})
