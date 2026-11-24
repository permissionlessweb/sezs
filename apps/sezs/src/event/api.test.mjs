import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8'))

const priceCents = (tier, rail) => {
  const bps = (tier.discountsBps || {})[rail] || 0
  return Math.floor((tier.listCents * (10000 - bps)) / 10000)
}
const discountPct = (tier, rail) => ((tier.discountsBps || {})[rail] || 0) / 100

test('api version is 2 with nip-52 shaped event fields', () => {
  assert.equal(FIXTURE.api, 2)
  assert.equal(FIXTURE.schema, 'sezs-event-v2')
  assert.equal(FIXTURE.event.name, 'Speakez Sessions')
  assert.equal(FIXTURE.event.domain, 'http://127.0.0.1:3051')
  assert.equal(FIXTURE.event.kind, 31923)
  assert.equal(FIXTURE.event.dTag, 'speakez-sessions')
  assert.ok(FIXTURE.event.summary)
  assert.ok(!FIXTURE.event.domain.includes('localhost'))
  assert.ok(Array.isArray(FIXTURE.faq) && FIXTURE.faq.length >= 1)
})

test('fixture prices: $40 list, half off ZEC and Penumbra; no ETH or Base rails', () => {
  const tier = FIXTURE.tiers[0]
  assert.equal(tier.listCents, 4000)
  assert.equal(priceCents(tier, 'zec'), 2000)
  assert.equal(priceCents(tier, 'penumbra'), 2000)
  assert.equal(discountPct(tier, 'zec'), 50)
  assert.deepEqual(tier.rails, ['zec', 'penumbra'])
  assert.ok(!tier.rails.includes('eth'))
  assert.ok(!tier.rails.includes('base'))
})

test('fixture has no dated October 18 and no real artist names', () => {
  const blob = JSON.stringify(FIXTURE)
  assert.doesNotMatch(blob, /October 18|Oct 18|SEZS Speakeasy|SPEAK-EZ/i)
  for (const name of ['Morphics', 'Howhippie', 'babypufff', 'Treebug', 'Chris Baker', 'Limbus']) {
    assert.doesNotMatch(blob, new RegExp(name))
  }
  assert.match(FIXTURE.lineup.map((s) => s.handle).join(' '), /Artist 01/)
})
