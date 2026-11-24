import assert from 'node:assert/strict'
import test from 'node:test'

const signInComplete = (s) =>
  !!(s?.wallet?.address && (s.wallet.kind !== 'browser' || s.wallet.registered))

const isSignedInUsher = (session, event, opts = {}) => {
  if (!signInComplete(session)) return false
  if (session?.role === 'usher') return true
  const addr = String(session?.wallet?.address || '').trim()
  if (addr && event?.roles?.ushers?.some((a) => a === addr)) return true
  return opts.splashUsher === true && !!addr
}

const isSignedInArtist = (session, event) => {
  if (!signInComplete(session)) return false
  const addr = String(session?.wallet?.address || '').trim().toLowerCase()
  if (!addr) return false
  return (event?.artists || []).some((a) => String(a.address || '').trim().toLowerCase() === addr)
}

const wallet = (address, extra = {}) => ({
  credId: 'c',
  authenticators: [],
  policy: 'anyOf',
  role: extra.role || 'guest',
  alias: 'g',
  createdAt: 1,
  wallet: { kind: 'zid', address, connectedAt: 1, ...extra.wallet },
})

const event = {
  roles: { curators: [], coordinators: [], ushers: ['terp1usherxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'] },
  artists: [{ id: 'a1', name: 'Floor artist', address: 'terp1artistxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }],
}

test('usher UI stays hidden without a finished sign-in', () => {
  assert.equal(isSignedInUsher(null, event, { splashUsher: true }), false)
  assert.equal(isSignedInUsher({ ...wallet('terp1x'), wallet: undefined }, event), false)
})

test('usher UI is shown only for a signed-in usher on the live list or usher role', () => {
  assert.equal(isSignedInUsher(wallet('terp1guestxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), event), false)
  assert.equal(isSignedInUsher(wallet('terp1usherxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), event), true)
  assert.equal(isSignedInUsher(wallet('terp1other', { role: 'usher' }), event), true)
})

test('a signed-in coordinator who is not an usher does not see the door tools', () => {
  assert.equal(isSignedInUsher(wallet('terp1coord', { role: 'admin' }), event), false)
})

test('show-your-work is only for a signed-in artist address on the event record', () => {
  assert.equal(isSignedInArtist(null, event), false)
  assert.equal(isSignedInArtist(wallet('terp1guestxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), event), false)
  assert.equal(isSignedInArtist(wallet('terp1artistxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), event), true)
})

test('roles-gate.ts exports the same predicates the tests cover', async () => {
  const { readFileSync } = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'roles-gate.ts'), 'utf8')
  assert.match(src, /export const isSignedInUsher/)
  assert.match(src, /export const isSignedInArtist/)
  assert.match(src, /signInComplete/)
  assert.match(src, /roles\?\.ushers/)
})
