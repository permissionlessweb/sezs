import assert from 'node:assert/strict'
import test from 'node:test'
import { asCoin, formatCoin, normalizeRaffle, rafflePhase } from './raffle-shape.mjs'

test('formatCoin uses six decimals for micro denoms and does not invent amounts', () => {
  assert.equal(formatCoin(), '—')
  assert.equal(formatCoin({ denom: 'uterp', amount: '1500000' }), '1.5 TERP')
  assert.equal(formatCoin({ denom: 'uterp', amount: '2000000' }), '2 TERP')
  assert.equal(formatCoin({ denom: 'uthiol', amount: '250000' }), '0.25 THIOL')
})

test('normalizeRaffle maps the nftfi_raffle wire shape used by pweb', () => {
  const row = normalizeRaffle({
    raffle_id: 3,
    state: 'started',
    info: {
      owner: 'terp1ownerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      ticket_count: 4,
      ticket_price: { coin: { denom: 'uterp', amount: '1000000' } },
      assets: [{ cw721: { address: 'terp1nft', token_id: '12' } }],
      raffle_options: {
        raffle_start_timestamp: '1763500000000000000',
        raffle_duration: 3600,
        max_ticket_number: 20,
        min_ticket_number: 2,
        comment: 'A floor print',
      },
    },
  })
  assert.ok(row)
  assert.equal(row.raffleId, 3)
  assert.equal(row.state, 'started')
  assert.equal(row.ticketsSold, 4)
  assert.equal(row.maxTickets, 20)
  assert.equal(row.minTickets, 2)
  assert.deepEqual(row.ticketPrice, { denom: 'uterp', amount: '1000000' })
  assert.equal(row.assets[0].kind, 'cw721')
  assert.equal(row.assets[0].tokenId, '12')
  assert.ok(row.startsAt)
  assert.ok(row.endsAt)
  assert.equal(Date.parse(row.endsAt) - Date.parse(row.startsAt), 3600 * 1000)
})

test('rafflePhase labels follow the pweb listing states', () => {
  const base = {
    raffleId: 1,
    state: 'started',
    ticketsSold: 1,
    winners: [],
    assets: [],
    cancelled: false,
    endsAt: new Date(Date.now() + 60_000).toISOString(),
  }
  assert.equal(rafflePhase(base).key, 'live')
  assert.equal(rafflePhase({ ...base, state: 'closed' }).key, 'closed')
  assert.equal(rafflePhase({ ...base, state: 'finished' }).key, 'drawn')
  assert.equal(rafflePhase({ ...base, cancelled: true }).key, 'cancelled')
  assert.equal(rafflePhase({ ...base, state: 'created' }).key, 'soon')
})

test('asCoin unwraps AssetInfo coin wrappers', () => {
  assert.deepEqual(asCoin({ coin: { denom: 'uterp', amount: '1' } }), { denom: 'uterp', amount: '1' })
  assert.deepEqual(asCoin({ denom: 'uterp', amount: '1' }), { denom: 'uterp', amount: '1' })
})
