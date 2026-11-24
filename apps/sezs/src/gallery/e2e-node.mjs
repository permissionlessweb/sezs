import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const showcaseSrc = readFileSync(join(here, 'showcase.ts'), 'utf8')
const editorSrc = readFileSync(join(here, 'ShowcaseEditor.tsx'), 'utf8')
const prepSrc = readFileSync(join(here, 'CollectionsPrep.tsx'), 'utf8')
const gallerySrc = readFileSync(join(here, '../../pages/gallery.tsx'), 'utf8')

const TERP = /^terp1[02-9ac-hj-np-z]{58}$/
const EVM = /^0x[0-9a-fA-F]{40}$/
const HTTPS = /^https:\/\/[^\s]+$/i
const ASSET = /^(https:\/\/[^\s]+|\/sezs-assets\/[A-Za-z0-9._/-]+)$/

function validate(s) {
  const err = []
  if (!s.displayName || s.displayName.length > 80) err.push('displayName')
  if ((s.synopsis || '').length > 500) err.push('synopsis')
  for (const row of s.socials || []) {
    if (!HTTPS.test(row.href) || /javascript:/i.test(row.href)) err.push('social')
  }
  for (const row of s.assets || []) {
    if (!ASSET.test(row.href) || /javascript:|data:/i.test(row.href)) err.push('asset')
  }
  for (const row of s.collections || []) {
    const ok = row.chain === 'terp' ? TERP.test(row.addr) : EVM.test(row.addr)
    if (!ok) err.push('collection')
  }
  for (const row of s.works || []) {
    if (row.listed) err.push('listed')
    if (!(row.priceZec > 0)) err.push('price')
  }
  return err
}

function parseInviteFragment(hash) {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return { error: 'No invite in this link.' }
  const q = new URLSearchParams(raw)
  const v = q.get('v') || ''
  const i = q.get('i') || ''
  const B = q.get('B') || ''
  const o = q.get('o') || ''
  const x = q.get('x') || ''
  const s = q.get('s') || ''
  if (v !== '1' || !i || !B || !s) return { error: 'Invite is incomplete.' }
  const exp = Number(x)
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return { error: 'Invite has expired.' }
  return { v, i, B, o, x, s }
}

test('empty showcase is invalid until named', () => {
  assert.ok(validate({ displayName: '', socials: [], assets: [], collections: [], works: [] }).includes('displayName'))
})

test('https socials pass; javascript is refused', () => {
  const base = { displayName: 'Ada', socials: [], assets: [], collections: [], works: [] }
  assert.equal(validate({ ...base, socials: [{ href: 'https://example.com/a' }] }).length, 0)
  assert.ok(validate({ ...base, socials: [{ href: 'javascript:alert(1)' }] }).includes('social'))
})

test('collection addresses match spec', () => {
  const base = { displayName: 'Ada', socials: [], assets: [], collections: [], works: [] }
  assert.ok(validate({ ...base, collections: [{ chain: 'ethereum', addr: '0x123' }] }).includes('collection'))
  assert.equal(
    validate({
      ...base,
      collections: [{ chain: 'ethereum', addr: '0x' + 'ab'.repeat(20) }],
    }).length,
    0
  )
})

test('listed works stay drafts until escrow', () => {
  const err = validate({
    displayName: 'Ada',
    socials: [],
    assets: [],
    collections: [],
    works: [{ title: 'Study', priceZec: 1, listed: true }],
  })
  assert.ok(err.includes('listed'))
})

test('unlisted work with a price is a valid draft', () => {
  const err = validate({
    displayName: 'Ada',
    socials: [],
    assets: [],
    collections: [],
    works: [{ title: 'Study', priceZec: 1, listed: false }],
  })
  assert.equal(err.length, 0)
})

test('invite fragment required fields; expired and incomplete fail', () => {
  const far = Math.floor(Date.now() / 1000) + 86400
  const ok = parseInviteFragment(`#v=1&i=abc&B=QQ&o=deadbeef&x=${far}&s=sig`)
  assert.equal('error' in ok, false)
  assert.equal(parseInviteFragment('#v=1&i=abc').error, 'Invite is incomplete.')
  assert.equal(parseInviteFragment('#v=1&i=abc&B=QQ&o=x&x=1&s=sig').error, 'Invite has expired.')
  assert.ok(!JSON.stringify(ok).includes('mnemonic'))
})

test('schema refuses listed works and javascript hrefs in source', () => {
  assert.match(showcaseSrc, /if \(row\.listed\)/)
  assert.match(showcaseSrc, /Listing waits on a live escrow/)
  assert.match(showcaseSrc, /javascript:/)
  assert.match(showcaseSrc, /parseInviteFragment/)
  assert.match(showcaseSrc, /startsWith\('#'\)/)
  assert.doesNotMatch(showcaseSrc, /location\.search/)
  assert.doesNotMatch(showcaseSrc, /mnemonic|PRIVATE_KEY/)
  assert.match(showcaseSrc, /u\.password/)
  assert.doesNotMatch(showcaseSrc, /process\.env/)
})

test('editor is page-local; CollectionsPrep never signs', () => {
  assert.match(editorSrc, /Drafts stay on this page/)
  assert.match(editorSrc, /listed: false/)
  assert.match(prepSrc, /disabled/)
  assert.match(prepSrc, /Sign authorizations/)
  assert.match(prepSrc, /Nothing here signs or broadcasts/)
  assert.doesNotMatch(prepSrc, /eth_sendTransaction|broadcastTx|signAndBroadcast/)
  assert.doesNotMatch(editorSrc, /mnemonic|PRIVATE_KEY|password/i)
})

test('gallery consumes ShowcaseEditor and CollectionsPrep; catalog stays empty', () => {
  assert.match(gallerySrc, /ShowcaseEditor/)
  assert.match(gallerySrc, /CollectionsPrep/)
  assert.match(gallerySrc, /parseInviteFragment/)
  assert.match(gallerySrc, /view === 'studio'/)
})
test('gallery copy says only what is live', () => {
  assert.match(gallerySrc, /Buy is off/)
  assert.match(gallerySrc, /no escrow contract/)
  assert.doesNotMatch(gallerySrc, /Payments are held in escrow until the artist releases/)
  assert.doesNotMatch(gallerySrc, /Coming soon/)
  assert.doesNotMatch(gallerySrc, /Invites open soon/)
  assert.doesNotMatch(gallerySrc, /Artists are being invited now/)
  assert.doesNotMatch(gallerySrc, /You receive a receipt token/)
  assert.doesNotMatch(gallerySrc, /Shielded ZEC goes into escrow/)
})

test('editor does not interpolate unescaped HTML', () => {
  assert.doesNotMatch(editorSrc, /dangerouslySetInnerHTML/)
  assert.match(editorSrc, /escapeHtml/)
  assert.match(editorSrc, /listed: false/)
})
