import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '../..')
const require = createRequire(import.meta.url)
const Q = require(join(app, 'public/sezs-assets/artist-pay.js'))

const sessionTs = readFileSync(join(here, 'session.ts'), 'utf8')
const typesTs = readFileSync(join(here, 'types.ts'), 'utf8')
const desk = readFileSync(join(app, 'pages/desk.tsx'), 'utf8')
const admin = readFileSync(join(app, 'pages/admin.tsx'), 'utf8')
const doc = readFileSync(join(app, 'pages/_document.tsx'), 'utf8')
const cfg = readFileSync(join(app, 'next.config.js'), 'utf8')
const pay = readFileSync(join(app, 'public/sezs-assets/artist-pay.js'), 'utf8')
const artistSession = readFileSync(join(here, 'artistSession.ts'), 'utf8')
const rate = readFileSync(join(here, 'rateLimit.ts'), 'utf8')
const authCtx = readFileSync(join(here, 'AuthContext.tsx'), 'utf8')
const headersInc = readFileSync(join(app, 'nginx/sezs-security-headers.inc'), 'utf8')

const guestSess = {
  role: 'guest',
  wallet: { kind: 'zid', zidPubkey: 'ab'.repeat(32), address: 'terp1guestsessionaddress000000000000000', connectedAt: 1 },
}
const adminSess = {
  role: 'admin',
  wallet: { kind: 'zafu', address: 'terp1adminsessionaddress00000000000000' },
}
const browserPending = {
  role: 'guest',
  wallet: { kind: 'browser', address: 'terp1pending00000000000000000000000000' },
}

test('artist-pay: no password fields, no ADMIN_PW, billed ids stay public', () => {
  assert.equal(Q.ARTISTS.length, 7)
  for (const a of Q.ARTISTS) {
    assert.equal('pw' in a, false)
    assert.equal(typeof a.id, 'string')
    assert.equal(typeof a.name, 'string')
  }
  assert.equal('ADMIN_PW' in Q, false)
  assert.doesNotMatch(pay, /ADMIN_PW/)
  assert.doesNotMatch(pay, /\bpw\s*:/)
  assert.match(pay, /does not take a password/)
})

test('unlock: any string fails; session + billed id works; vendors not billed', () => {
  assert.equal(Q.unlock('').ok, false)
  assert.equal(Q.unlock('nope').ok, false)
  assert.match(Q.unlock('nope').message, /does not take a password/)
  assert.equal(Q.unlock(null, 'morphics').ok, false)
  assert.equal(Q.unlock({}, 'morphics').ok, false)
  assert.equal(Q.unlock(browserPending, 'morphics').ok, false)
  const hit = Q.unlock(guestSess, 'morphics')
  assert.equal(hit.ok, true)
  assert.equal(hit.id, 'morphics')
  assert.equal(hit.name, 'Morphics')
  assert.equal(hit.address, guestSess.wallet.address)
  assert.equal('pw' in hit, false)
  assert.equal(Q.unlock(guestSess, 'wall').ok, false)
  assert.equal(Q.unlock(guestSess, 'wall').message, 'Not billed.')
  for (const v of Q.VENDOR_IDS) {
    assert.equal(Q.billed(v), null)
  }
})

test('unlockAdmin: password always No; admin role needs a complete session', () => {
  assert.deepEqual(Q.unlockAdmin(''), { ok: false, message: 'No.' })
  assert.deepEqual(Q.unlockAdmin('nope'), { ok: false, message: 'No.' })
  assert.deepEqual(Q.unlockAdmin(guestSess), { ok: false, message: 'No.' })
  assert.deepEqual(Q.unlockAdmin({ role: 'admin' }), { ok: false, message: 'No.' })
  assert.deepEqual(Q.unlockAdmin(adminSess), { ok: true, message: 'Ok.' })
})

test('queued flags are still not a send', () => {
  const artists = {}
  const r = Q.seed(artists, 'trey')
  assert.equal(r.ok, true)
  assert.deepEqual(Q.req20(r.rec), { ok: false, message: 'Save keys first.' })
  Q.saveKeys(r.rec, 't1example', '', '')
  const q20 = Q.req20(r.rec)
  assert.equal(q20.ok, true)
  assert.equal(q20.message, '20% queued.')
  assert.equal(q20.message.includes('paid'), false)
  const q80 = Q.req80(r.rec)
  assert.equal(q80.ok, true)
  assert.equal(q80.message, '80% queued.')
})

test('desk page: sign-in gate, no password field, flags are not a send', () => {
  assert.match(desk, /does not take a password/)
  assert.match(desk, /flags here are not a send/)
  assert.match(desk, /signInComplete/)
  assert.doesNotMatch(desk, /type=["']password["']/)
  assert.doesNotMatch(desk, /unlockArtist/)
  assert.match(artistSession, /artistSessionOk/)
})

test('admin page: passkey unlock, not a password', () => {
  assert.match(admin, /Unlock with passkey/)
  assert.match(admin, /Admin is not a password/)
  assert.match(admin, /signInComplete/)
  assert.doesNotMatch(admin, /type=["']password["']/)
  assert.doesNotMatch(admin, /ADMIN_PW|cellar-ops/)
})

test('session is cookie-backed; admin allowlist is not NEXT_PUBLIC', () => {
  assert.doesNotMatch(sessionTs, /NEXT_PUBLIC_SEZS_ADMIN_CREDS/)
  assert.doesNotMatch(sessionTs, /NEXT_PUBLIC_SEZS_USHER_CREDS/)
  assert.doesNotMatch(sessionTs, /SEZS_ADMIN_CREDS/)
  assert.doesNotMatch(sessionTs, /SEZS_USHER_CREDS/)
  assert.match(sessionTs, /sessionStorage/)
  assert.match(sessionTs, /sealHttpSession/)
  assert.match(sessionTs, /\/sezs\/session\/me/)
  assert.match(sessionTs, /credentials: 'include'/)
  assert.match(authCtx, /sealHttpSession/)
  assert.match(authCtx, /logoutRemote/)
  assert.match(typesTs, /sezs-auth-v1/)
  assert.doesNotMatch(sessionTs, /mnemonic|PRIVATE_KEY/)
  assert.match(artistSession, /HttpOnly cookie/)
})

test('CSP meta + nginx include; Next still has no headers()', () => {
  assert.match(doc, /Content-Security-Policy/)
  assert.match(doc, /X-Content-Type-Options/)
  assert.match(doc, /frame-ancestors 'none'/)
  assert.match(doc, /Permissions-Policy/)
  assert.match(cfg, /compress: true/)
  assert.match(cfg, /poweredByHeader: false/)
  assert.doesNotMatch(cfg, /async headers\(/)
  assert.match(cfg, /sezs-security-headers\.inc/)
  assert.match(rate, /sessionStorage/)
  assert.match(headersInc, /frame-ancestors 'none'/)
  assert.match(headersInc, /X-Content-Type-Options/)
  assert.match(headersInc, /Referrer-Policy/)
  assert.match(headersInc, /Permissions-Policy/)
  assert.match(headersInc, /Strict-Transport-Security/)
  assert.match(headersInc, /Do not enable on HTTP loopback/)
  assert.match(headersInc, /include \/opt\/homebrew\/etc\/nginx\/sezs-security-headers.inc;/)
})
