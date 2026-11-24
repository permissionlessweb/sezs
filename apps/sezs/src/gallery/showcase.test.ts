import assert from 'node:assert/strict'
import test from 'node:test'

import {
  emptyShowcase,
  escapeHtml,
  isHttpsUrl,
  renderShowcaseHtml,
  validateShowcase,
  type ArtistShowcase,
} from './showcase.ts'

const named = (p: Partial<ArtistShowcase> = {}): ArtistShowcase => ({
  ...emptyShowcase(),
  displayName: 'Ada',
  ...p,
  payout: p.payout || {},
})

test('empty showcase is invalid until named', () => {
  const err = validateShowcase(emptyShowcase())
  assert.ok(err.some((e) => e.path === 'displayName'))
})

test('https socials pass; javascript, data, http, and credentials fail', () => {
  assert.equal(
    validateShowcase(named({ socials: [{ kind: 'site', href: 'https://example.com/a' }] }))
      .length,
    0
  )
  const bad = [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>x</script>',
    'http://example.com',
    'https://user:pass@example.com/',
    '//example.com',
  ]
  for (const href of bad) {
    const err = validateShowcase(named({ socials: [{ kind: 'site', href }] }))
    assert.ok(
      err.some((e) => e.path === 'socials.0.href'),
      'should refuse ' + href
    )
    assert.equal(isHttpsUrl(href), false, href)
  }
})

test('oversized synopsis is refused', () => {
  const err = validateShowcase(named({ synopsis: 'x'.repeat(501) }))
  assert.ok(err.some((e) => e.path === 'synopsis'))
  assert.equal(validateShowcase(named({ synopsis: 'x'.repeat(500) })).length, 0)
})

test('script injection in synopsis is escaped on render; angle brackets in hrefs are refused', () => {
  const s = named({
    displayName: '<img src=x onerror=alert(1)>',
    synopsis: '<script>alert(1)</script>',
    socials: [{ kind: 'site', href: 'https://example.com/a' }],
  })
  assert.equal(validateShowcase(s).length, 0)
  const html = renderShowcaseHtml(s)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;img src=x/)
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;')
  const angled = named({
    socials: [{ kind: 'site', href: 'https://example.com/?q=<script>x</script>' }],
  })
  assert.ok(validateShowcase(angled).some((e) => e.path === 'socials.0.href'))
})

test('javascript href never appears in rendered html', () => {
  const s = named({
    socials: [{ kind: 'x', href: 'javascript:alert(1)' }],
  })
  assert.ok(validateShowcase(s).some((e) => e.path === 'socials.0.href'))
  const html = renderShowcaseHtml(s)
  assert.doesNotMatch(html, /javascript:/i)
  assert.doesNotMatch(html, /<a /)
})

test('listed works stay drafts until escrow', () => {
  const err = validateShowcase(
    named({
      works: [{ id: 'w1', title: 'Study', priceZec: 1, listed: true }],
    })
  )
  assert.ok(err.some((e) => e.path === 'works.0.listed'))
})

test('spec login methods and optional payout formats', () => {
  assert.equal(validateShowcase(named({ loginMethod: 'passkey' })).length, 0)
  assert.ok(
    validateShowcase(named({ loginMethod: 'password' as never })).some(
      (e) => e.path === 'loginMethod'
    )
  )
  assert.ok(
    validateShowcase(named({ payout: { evm: '0x123' } })).some((e) => e.path === 'payout.evm')
  )
  assert.equal(
    validateShowcase(
      named({ payout: { evm: '0x' + 'ab'.repeat(20) } })
    ).length,
    0
  )
})
