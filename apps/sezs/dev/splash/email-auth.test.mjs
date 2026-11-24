import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ed25519 } from '@noble/curves/ed25519'
import { bytesToHex } from '@noble/hashes/utils'

import { emailBindMessage, emailLoginMessage, emailMeBody, makeEmailAuth, normalizeEmail } from './email-auth.mjs'
import { makeFileSink, makeMemorySink } from './email-sink.mjs'

const ORIGIN = 'http://localhost:3051'
const sha256 = (d) => createHash('sha256').update(d).digest()
const b64url = (buf) => Buffer.from(buf).toString('base64url')

// A fake loopback request. Handlers read origin / csrf / cookie / socket only.
const req = ({ origin = ORIGIN, csrf = '1', cookie = '', ip = '127.0.0.1' } = {}) => ({
  headers: { origin, 'x-sezs-csrf': csrf, cookie },
  socket: { remoteAddress: ip },
})
const cookieId = (headers) => /sezs_splash=([^;]+)/.exec(headers?.['set-cookie'] || '')?.[1] || ''
const withCookie = (id, extra = {}) => req({ cookie: `sezs_splash=${id}`, ...extra })

// Issue + verify a mailbox, returning the session cookie id and the OTP the sink saw.
const signIn = async (auth, sink, email = 'guest@example.com', origin = ORIGIN) => {
  const [rcode] = await auth.handlers['POST /sezs/auth/email/request'](req({ origin }), { email })
  assert.equal(rcode, 200)
  const msg = sink.inbox.at(-1)
  const code = /code is (\d{6})/.exec(msg.text)[1]
  const [vcode, vbody, vheaders] = await auth.handlers['POST /sezs/auth/email/verify'](req({ origin }), { email, code })
  assert.equal(vcode, 200)
  return { id: cookieId(vheaders), body: vbody, code }
}

// Build a real P-256 WebAuthn get() assertion for a bind challenge.
const makePasskey = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])
  const credId = b64url(Buffer.from('test-cred-1'))
  const assert_ = (challengeB64, { origin = ORIGIN, signCount = 1, flags = 0x05, rpId = 'localhost' } = {}) => {
    const authData = Buffer.concat([sha256(rpId), Buffer.from([flags]), (() => { const b = Buffer.alloc(4); b.writeUInt32BE(signCount); return b })()])
    const clientDataJSON = JSON.stringify({ type: 'webauthn.get', challenge: challengeB64, origin, crossOrigin: false })
    const clientBytes = Buffer.from(clientDataJSON, 'utf8')
    const signature = cryptoSign('sha256', Buffer.concat([authData, sha256(clientBytes)]), privateKey)
    return { clientDataJSON: b64url(clientBytes), authenticatorData: b64url(authData), signature: b64url(signature) }
  }
  return { credId, publicKey: b64url(point), assert_ }
}

test('normalizeEmail trims, lowercases, and rejects malformed addresses', () => {
  assert.equal(normalizeEmail('  Guest@Example.COM '), 'guest@example.com')
  assert.equal(normalizeEmail('no-at-sign'), null)
  assert.equal(normalizeEmail('a@b'), null)
  assert.equal(normalizeEmail(''), null)
  assert.equal(normalizeEmail(`${'x'.repeat(65)}@example.com`), null)
})

test('request + verify issues the cookie and /session returns the email login', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  const { id, body } = await signIn(auth, sink)
  assert.match(id, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
  assert.equal(body.kind, 'email')
  assert.match(body.login_id, /^mail-[a-f0-9]+$/)
  assert.notEqual(body.login_id, 'guest@example.com') // random id, not the raw address

  const [scode, sbody] = auth.handlers['GET /sezs/auth/email/session'](withCookie(id))
  assert.equal(scode, 200)
  assert.equal(sbody.email, 'guest@example.com')
  assert.equal(sbody.login_id, body.login_id)
  assert.equal(sbody.kind, 'email')

  // /sezs/session/me shape for the same cookie.
  const rec = auth.recordOf(id)
  const me = emailMeBody(rec)
  assert.equal(me.ok, true)
  assert.equal(me.kind, 'email')
  assert.equal(me.login_id, body.login_id)
  assert.equal(me.role, 'guest') // no role registry yet; email is not an on-chain kind
})

test('sendEmail uses sezs@permissionless.money as the default From', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'guest@example.com' })
  assert.equal(sink.inbox.at(-1).from, 'sezs@permissionless.money')

  const sink2 = makeMemorySink()
  const auth2 = makeEmailAuth({ sendEmail: sink2.sendEmail, emailFrom: 'desk@permissionless.money' })
  await auth2.handlers['POST /sezs/auth/email/request'](req(), { email: 'guest@example.com' })
  assert.equal(sink2.inbox.at(-1).from, 'desk@permissionless.money')
})

test('the issued challenge commits to origin, audience, mailbox, nonce, ts', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'guest@example.com' })
  const msg = sink.inbox.at(-1)
  assert.match(msg.text, /code is \d{6}/)
  assert.match(msg.text, /\?email_code=\d{6}&email=guest%40example\.com/)
  assert.ok(msg.tokenRef) // nonce reference, not the raw code, as the correlation id
  const message = emailLoginMessage({ origin: ORIGIN, email: 'guest@example.com', nonce: msg.tokenRef, ts: 0 })
  assert.match(message, /^SEZS-LOGIN-EMAIL-V1/)
  assert.match(message, /audience: sezs/)
})

test('a code is one-time: reuse returns unknown_challenge', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  const { code } = await signIn(auth, sink)
  const [again, body] = await auth.handlers['POST /sezs/auth/email/verify'](req(), { email: 'guest@example.com', code })
  assert.equal(again, 400)
  assert.equal(body.error, 'unknown_challenge')
})

test('a wrong code is refused and the challenge burns after too many guesses', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail, verifyLimit: 100 })
  await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'guest@example.com' })
  for (let i = 0; i < 5; i++) {
    const [c, b] = await auth.handlers['POST /sezs/auth/email/verify'](req(), { email: 'guest@example.com', code: '000000' })
    assert.equal(c, 400)
    assert.equal(b.error, 'bad_code')
  }
  const [c, b] = await auth.handlers['POST /sezs/auth/email/verify'](req(), { email: 'guest@example.com', code: '000000' })
  assert.equal(c, 400)
  assert.equal(b.error, 'unknown_challenge') // burned
})

test('an expired code returns expired', async () => {
  let t = 1_000_000
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail, now: () => t, otpTtlMs: 1000 })
  await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'guest@example.com' })
  const code = /code is (\d{6})/.exec(sink.inbox.at(-1).text)[1]
  t += 2000
  const [c, b] = await auth.handlers['POST /sezs/auth/email/verify'](req(), { email: 'guest@example.com', code })
  assert.equal(c, 400)
  assert.equal(b.error, 'expired')
})

test('a foreign origin is refused on request and verify; missing CSRF is refused', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  const [rc] = await auth.handlers['POST /sezs/auth/email/request'](req({ origin: 'https://evil.example' }), { email: 'guest@example.com' })
  assert.equal(rc, 403)
  const { code } = await signIn(auth, sink)
  const [vc, vb] = await auth.handlers['POST /sezs/auth/email/verify'](req({ origin: 'https://evil.example' }), { email: 'guest@example.com', code })
  assert.equal(vc, 403)
  assert.equal(vb.error, 'origin_refused')
  const [noCsrf] = await auth.handlers['POST /sezs/auth/email/request'](req({ csrf: '' }), { email: 'guest@example.com' })
  assert.equal(noCsrf, 403)
})

test('a code issued for one origin cannot be verified from the other allowed origin', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  await auth.handlers['POST /sezs/auth/email/request'](req({ origin: ORIGIN }), { email: 'guest@example.com' })
  const code = /code is (\d{6})/.exec(sink.inbox.at(-1).text)[1]
  const [c, b] = await auth.handlers['POST /sezs/auth/email/verify'](req({ origin: 'http://127.0.0.1:3051' }), { email: 'guest@example.com', code })
  assert.equal(c, 400)
  assert.equal(b.error, 'unknown_challenge') // challenge is keyed to the issuing origin
})

test('request rate limit returns a generic 429', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail }) // requestLimit 3
  const codes = []
  for (let i = 0; i < 4; i++) {
    const [c, b] = await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'guest@example.com' })
    codes.push(c)
    if (c === 429) assert.equal(b.error, 'rate_limited')
  }
  assert.deepEqual(codes, [200, 200, 200, 429])
})

test('verify rate limit returns 429', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail }) // verifyLimit 5
  await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'guest@example.com' })
  const seen = []
  for (let i = 0; i < 6; i++) {
    const [c] = await auth.handlers['POST /sezs/auth/email/verify'](req(), { email: 'guest@example.com', code: '000000' })
    seen.push(c)
  }
  assert.equal(seen.at(-1), 429)
})

test('a per-IP cap stops a scripted client from spraying mailboxes', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail, ipRequestLimit: 2 })
  const a = await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'a@example.com' })
  const b = await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'b@example.com' })
  const c = await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'c@example.com' })
  assert.equal(a[0], 200)
  assert.equal(b[0], 200)
  assert.equal(c[0], 429)
})

test('a second request inside the cooldown is idempotent and does not re-send', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  const [c1, b1] = await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'guest@example.com' })
  const [c2, b2] = await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'guest@example.com' })
  assert.equal(c1, 200)
  assert.equal(c2, 200)
  assert.deepEqual(b1, b2)
  assert.equal(sink.inbox.length, 1) // no second message, no enumeration leak
})

test('delivery failure is a 503 and stores no challenge (fail closed)', async () => {
  const auth = makeEmailAuth({ sendEmail: async () => { throw new Error('sink down') } })
  const [c, b] = await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'guest@example.com' })
  assert.equal(c, 503)
  assert.equal(b.error, 'delivery_unavailable')
  const [vc, vb] = await auth.handlers['POST /sezs/auth/email/verify'](req(), { email: 'guest@example.com', code: '123456' })
  assert.equal(vc, 400)
  assert.equal(vb.error, 'unknown_challenge')
})

test('verify mints a fresh session id and invalidates the prior cookie (no fixation)', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail, resendCooldownMs: 0 })
  const first = await signIn(auth, sink)
  // Re-request and verify again, presenting the first cookie as a browser would.
  await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'guest@example.com' })
  const code = /code is (\d{6})/.exec(sink.inbox.at(-1).text)[1]
  const [vc, , vh] = await auth.handlers['POST /sezs/auth/email/verify'](withCookie(first.id), { email: 'guest@example.com', code })
  assert.equal(vc, 200)
  const secondId = cookieId(vh)
  assert.notEqual(first.id, secondId)
  assert.equal(auth.handlers['GET /sezs/auth/email/session'](withCookie(first.id))[0], 401)
  assert.equal(auth.handlers['GET /sezs/auth/email/session'](withCookie(secondId))[0], 200)
})

test('logout clears the cookie and the session', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  const { id } = await signIn(auth, sink)
  const [c, , headers] = auth.handlers['POST /sezs/auth/email/logout'](withCookie(id))
  assert.equal(c, 200)
  assert.match(headers['set-cookie'], /Max-Age=0/)
  assert.equal(auth.handlers['GET /sezs/auth/email/session'](withCookie(id))[0], 401)
})

test('bind without a session is refused', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  const [c] = await auth.handlers['POST /sezs/auth/email/bind'](req(), { kind: 'ed25519/zid', zidPubkey: 'aa'.repeat(32) })
  assert.equal(c, 401)
})

test('bind of a ZID without a proof is refused; with a fresh signature it binds and me shows it', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  const { id } = await signIn(auth, sink)
  const secret = ed25519.utils.randomPrivateKey()
  const zidPubkey = bytesToHex(ed25519.getPublicKey(secret))

  // Raw identifier, no proof → refused.
  const [noProof, npBody] = await auth.handlers['POST /sezs/auth/email/bind'](withCookie(id), { kind: 'ed25519/zid', zidPubkey })
  assert.equal(noProof, 400)
  assert.equal(npBody.error, 'proof_required')

  // Fresh origin-bound bind nonce, signed.
  const [cc, challenge] = auth.handlers['POST /sezs/auth/email/bind-challenge'](withCookie(id))
  assert.equal(cc, 200)
  assert.equal(challenge.message, emailBindMessage({ origin: ORIGIN, nonce: challenge.nonce, ts: challenge.ts }))
  const signature = bytesToHex(ed25519.sign(Buffer.from(challenge.message, 'utf8'), secret))
  const [bc, bbody] = await auth.handlers['POST /sezs/auth/email/bind'](withCookie(id), { kind: 'ed25519/zid', zidPubkey, nonce: challenge.nonce, signature })
  assert.equal(bc, 200)
  assert.equal(bbody.bound.zidPubkey, zidPubkey)

  const me = emailMeBody(auth.recordOf(id))
  assert.equal(me.bound.zidPubkey, zidPubkey)
  const [, sbody] = auth.handlers['GET /sezs/auth/email/session'](withCookie(id))
  assert.equal(sbody.bound.zidPubkey, zidPubkey)
})

test('a bind nonce is one-time and bound to the session that asked for it', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  const { id } = await signIn(auth, sink)
  const secret = ed25519.utils.randomPrivateKey()
  const zidPubkey = bytesToHex(ed25519.getPublicKey(secret))
  const [, ch] = auth.handlers['POST /sezs/auth/email/bind-challenge'](withCookie(id))
  const signature = bytesToHex(ed25519.sign(Buffer.from(ch.message, 'utf8'), secret))
  const bindBody = { kind: 'ed25519/zid', zidPubkey, nonce: ch.nonce, signature }
  assert.equal((await auth.handlers['POST /sezs/auth/email/bind'](withCookie(id), bindBody))[0], 200)
  const [reuse, rb] = await auth.handlers['POST /sezs/auth/email/bind'](withCookie(id), bindBody)
  assert.equal(reuse, 400)
  assert.equal(rb.error, 'unknown_challenge')

  // A different session cannot use this nonce.
  const other = await signIn(auth, sink, 'other@example.com')
  const [, ch2] = auth.handlers['POST /sezs/auth/email/bind-challenge'](withCookie(id))
  const sig2 = bytesToHex(ed25519.sign(Buffer.from(ch2.message, 'utf8'), secret))
  const [cross, cb] = await auth.handlers['POST /sezs/auth/email/bind'](withCookie(other.id), { kind: 'ed25519/zid', zidPubkey, nonce: ch2.nonce, signature: sig2 })
  assert.equal(cross, 403)
  assert.equal(cb.error, 'challenge_mismatch')
})

test('bind of a passkey without a proof is refused; a valid assertion binds it', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  const { id } = await signIn(auth, sink)
  const pk = makePasskey()

  const [noProof] = await auth.handlers['POST /sezs/auth/email/bind'](withCookie(id), { kind: 'p256/passkey', credId: pk.credId })
  assert.equal(noProof, 400)

  const [, ch] = auth.handlers['POST /sezs/auth/email/bind-challenge'](withCookie(id))
  const assertion = pk.assert_(ch.challengeB64)
  const [bc, bbody] = await auth.handlers['POST /sezs/auth/email/bind'](withCookie(id), { kind: 'p256/passkey', credId: pk.credId, publicKey: pk.publicKey, nonce: ch.nonce, assertion })
  assert.equal(bc, 200)
  assert.equal(bbody.bound.passkeyCredId, pk.credId)
  assert.equal(emailMeBody(auth.recordOf(id)).bound.passkeyCredId, pk.credId)
})

test('a passkey assertion with the wrong origin, challenge, or missing UV is refused', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  const { id } = await signIn(auth, sink)
  const pk = makePasskey()
  // Fresh bind challenge per attempt; build the assertion against it.
  const attempt = async (opts) => {
    const [, ch] = auth.handlers['POST /sezs/auth/email/bind-challenge'](withCookie(id))
    return auth.handlers['POST /sezs/auth/email/bind'](withCookie(id), { kind: 'p256/passkey', credId: pk.credId, publicKey: pk.publicKey, nonce: ch.nonce, assertion: pk.assert_(ch.challengeB64, opts) })
  }
  const [co, bo] = await attempt({ origin: 'https://evil.example' })
  assert.equal(co, 403)
  assert.equal(bo.error, 'passkey_origin')

  const [, chC] = auth.handlers['POST /sezs/auth/email/bind-challenge'](withCookie(id))
  const [cc2, bc2] = await auth.handlers['POST /sezs/auth/email/bind'](withCookie(id), { kind: 'p256/passkey', credId: pk.credId, publicKey: pk.publicKey, nonce: chC.nonce, assertion: pk.assert_('not-the-challenge') })
  assert.equal(cc2, 403)
  assert.equal(bc2.error, 'passkey_challenge')

  const [cu, bu] = await attempt({ flags: 0x01 }) // user present, but not verified
  assert.equal(cu, 403)
  assert.equal(bu.error, 'passkey_flags')
})

test('a passkey assertion signed by a different key is refused', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  const { id } = await signIn(auth, sink)
  const pk = makePasskey()
  const other = makePasskey()
  const [, ch] = auth.handlers['POST /sezs/auth/email/bind-challenge'](withCookie(id))
  // assertion signed by `other` but presented with pk's public key
  const assertion = other.assert_(ch.challengeB64)
  const [c, b] = await auth.handlers['POST /sezs/auth/email/bind'](withCookie(id), { kind: 'p256/passkey', credId: pk.credId, publicKey: pk.publicKey, nonce: ch.nonce, assertion })
  assert.equal(c, 403)
  assert.equal(b.error, 'bad_signature')
})

test('the file sink writes 0600 messages and never touches the network', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sezs-email-sink-'))
  try {
    const sink = makeFileSink(join(dir, 'outbox'))
    await sink.sendEmail({ to: 'guest@example.com', subject: 's', text: 'code is 123456', tokenRef: 'nonce-1' })
    const files = readdirSync(join(dir, 'outbox'))
    assert.equal(files.length, 1)
    const mode = (statSync(join(dir, 'outbox', files[0])).mode & 0o777).toString(8)
    assert.equal(mode, '600')
    const stored = JSON.parse(readFileSync(join(dir, 'outbox', files[0]), 'utf8'))
    assert.equal(stored.to, 'guest@example.com')
    assert.equal(stored.from, 'sezs@permissionless.money')
    assert.equal(stored.tokenRef, 'nonce-1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the runtime never logs the raw code, full address, or session id', async () => {
  const sink = makeMemorySink()
  const events = []
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail, onEvent: (e) => events.push(e) })
  const { id, code } = await signIn(auth, sink)
  const blob = JSON.stringify(events)
  assert.ok(!blob.includes(code))
  assert.ok(!blob.includes('guest@example.com'))
  assert.ok(!blob.includes(id))
  assert.ok(events.every((e) => typeof e.emailHash === 'string' && e.emailHash.length === 64))
})

import { createEmailAuthHttpServer } from './email-server.mjs'
import { makeSqliteEmailStore } from './email-store.mjs'
import { verifySessionToken } from './email-token.mjs'

test('SQLite persistence survives restart: hashed challenge, mailbox, binding, and revocation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sezs-email-sqlite-'))
  const dbPath = join(dir, 'email-auth.sqlite')
  try {
    const sink1 = makeMemorySink()
    const auth1 = makeEmailAuth({ sendEmail: sink1.sendEmail, dbPath, stateDir: dir })
    const { id, body } = await signIn(auth1, sink1, 'persist@example.com')

    // Bind ZID in instance 1
    const secret = ed25519.utils.randomPrivateKey()
    const zidPubkey = bytesToHex(ed25519.getPublicKey(secret))
    const [, ch] = auth1.handlers['POST /sezs/auth/email/bind-challenge'](withCookie(id))
    const sig = bytesToHex(ed25519.sign(Buffer.from(ch.message, 'utf8'), secret))
    const [bcode] = await auth1.handlers['POST /sezs/auth/email/bind'](withCookie(id), {
      kind: 'ed25519/zid',
      nonce: ch.nonce,
      zidPubkey,
      signature: sig,
    })
    assert.equal(bcode, 200)
    auth1.close()

    // Restart a second instance against the same SQLite + key dir (simulating worker restart or horizontal peer)
    const sink2 = makeMemorySink()
    const auth2 = makeEmailAuth({ sendEmail: sink2.sendEmail, dbPath, stateDir: dir })
    const [scode, sbody] = auth2.handlers['GET /sezs/auth/email/session'](withCookie(id))
    assert.equal(scode, 200)
    assert.equal(sbody.login_id, body.login_id)
    assert.equal(sbody.bound.zidPubkey, zidPubkey)

    // Verify no plaintext OTP was persisted in SQLite
    const store = makeSqliteEmailStore({ dbPath })
    await auth2.handlers['POST /sezs/auth/email/request'](req(), { email: 'noptext@example.com' })
    const rawCode = /code is (\d{6})/.exec(sink2.inbox.at(-1).text)[1]
    const chKey = `${createHash('sha256').update('sezs-email-v1\nnoptext@example.com').digest('hex')}:${ORIGIN}`
    const row = store.getChallenge(chKey)
    assert.ok(row)
    assert.ok(!JSON.stringify(row).includes(rawCode))
    assert.equal(row.secretHash.length, 64)
    store.close()

    // Revocation persists across restart
    const [lcode] = auth2.handlers['POST /sezs/auth/email/logout'](withCookie(id))
    assert.equal(lcode, 200)
    auth2.close()

    const auth3 = makeEmailAuth({ sendEmail: makeMemorySink().sendEmail, dbPath, stateDir: dir })
    const [afterCode] = auth3.handlers['GET /sezs/auth/email/session'](withCookie(id))
    assert.equal(afterCode, 401)
    auth3.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tampered signed session tokens fail statelessly before store lookup', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail, sessionSecret: 'test-secret-only' })
  const { id } = await signIn(auth, sink)
  const parts = id.split('.')
  assert.equal(parts.length, 3)
  const tamperedPayload = Buffer.from(JSON.stringify({ v: 1, sid: 'sess-fake', lid: 'mail-1', sub: 'x', kind: 'email', exp: Date.now() + 99999 }), 'utf8').toString('base64url')
  const forged = `v1.${tamperedPayload}.${parts[2]}`
  const [scode] = auth.handlers['GET /sezs/auth/email/session'](withCookie(forged))
  assert.equal(scode, 401)
  assert.equal(verifySessionToken(forged, createHash('sha256').update('test-secret-only').digest()), null)
})

test('stateless PoW challenges protect /request before DB write or mail delivery', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail, powBits: 8 })
  const [c1, b1] = await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'pow@example.com' })
  assert.equal(c1, 428)
  assert.equal(b1.error, 'pow_required')
  assert.equal(sink.inbox.length, 0)

  // Solve 8-bit PoW
  const pow = b1.pow
  let nonce = ''
  for (let i = 0; i < 10_000; i++) {
    const cand = String(i)
    const d = createHash('sha256').update(`${pow.salt}:${cand}`).digest()
    if (d[0] === 0) { nonce = cand; break }
  }
  assert.ok(nonce)

  const [c2, b2] = await auth.handlers['POST /sezs/auth/email/request'](req(), {
    email: 'pow@example.com',
    pow: { ...pow, nonce },
  })
  assert.equal(c2, 200)
  assert.equal(b2.status, 'awaiting')
  assert.equal(sink.inbox.length, 1)

  // Replaying the same solved PoW salt is refused
  const [c3] = await auth.handlers['POST /sezs/auth/email/request'](req(), {
    email: 'pow2@example.com',
    pow: { ...pow, nonce },
  })
  assert.equal(c3, 428)
})

test('enumeration-neutral responses: existing vs new mailbox return identical request shape', async () => {
  const sink = makeMemorySink()
  const auth = makeEmailAuth({ sendEmail: sink.sendEmail })
  await signIn(auth, sink, 'known@example.com')
  const [c1, b1] = await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'known@example.com' })
  const [c2, b2] = await auth.handlers['POST /sezs/auth/email/request'](req(), { email: 'brandnew@example.com' })
  assert.equal(c1, 200)
  assert.equal(c2, 200)
  assert.deepEqual(b1, { ok: true, status: 'awaiting' })
  assert.deepEqual(b2, { ok: true, status: 'awaiting' })
})

test('standalone email-server binds loopback, enforces 4 KiB body cap, and refuses secret fields', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sezs-email-http-'))
  const sink = makeMemorySink()
  const srv = createEmailAuthHttpServer({
    host: '127.0.0.1',
    port: 0,
    stateDir: dir,
    dbPath: join(dir, 'email.sqlite'),
    sendEmail: sink.sendEmail,
  })
  const addr = await srv.listen()
  const base = `http://127.0.0.1:${addr.port}`
  try {
    const h = await fetch(`${base}/sezs/auth/email/health`)
    assert.equal(h.status, 200)
    const hb = await h.json()
    assert.equal(hb.ok, true)
    assert.equal(hb.store, 'sqlite')

    const big = await fetch(`${base}/sezs/auth/email/request`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-sezs-csrf': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', pad: 'x'.repeat(5000) }),
    })
    assert.equal(big.status, 413)

    const sec = await fetch(`${base}/sezs/auth/email/request`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-sezs-csrf': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', mnemonic: 'abandon' }),
    })
    assert.equal(sec.status, 400)
    const sb = await sec.json()
    assert.equal(sb.error, 'secret_refused')
  } finally {
    await srv.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
