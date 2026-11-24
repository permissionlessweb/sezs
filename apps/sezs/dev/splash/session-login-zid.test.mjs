import assert from 'node:assert/strict'
import { ed25519 } from '@noble/curves/ed25519'
import { bytesToHex } from '@noble/hashes/utils'
import test from 'node:test'

import { makeSessionLogin, zidChallengeHex, zidLoginMessage } from './session-login.mjs'

test('zid challenge is origin-bound and verify sets a session for the site-scoped pubkey', async () => {
  const secret = ed25519.utils.randomPrivateKey()
  const publicKey = bytesToHex(ed25519.getPublicKey(secret))
  const login = makeSessionLogin({ liveConfig: () => ({ lcd: '', contract: '' }) })

  const refused = login.handlers['POST /sezs/session/challenge']({}, { origin: 'https://evil.example', kind: 'zid' })
  assert.equal(refused[0], 403)

  const [code, ch] = login.handlers['POST /sezs/session/challenge'](
    {},
    { origin: 'http://localhost:3051', kind: 'zid' },
  )
  assert.equal(code, 200)
  assert.equal(ch.ok, true)
  const message = zidLoginMessage({ origin: 'http://localhost:3051', nonce: ch.nonce, ts: ch.ts })
  assert.equal(ch.message, message)
  assert.equal(ch.challengeHex, zidChallengeHex(message))

  const signature = bytesToHex(ed25519.sign(Buffer.from(message, 'utf8'), secret))
  const [vcode, body, headers] = await login.handlers['POST /sezs/session/verify'](
    {},
    {
      origin: 'http://localhost:3051',
      nonce: ch.nonce,
      ts: ch.ts,
      method: 'zid',
      publicKey,
      signature,
    },
  )
  assert.equal(vcode, 200)
  assert.equal(body.ok, true)
  assert.equal(body.kind, 'ed25519/zid')
  assert.equal(body.login_id, publicKey)
  assert.match(headers['set-cookie'], /^sezs_splash=sess-[a-f0-9]+; Path=\/; HttpOnly; SameSite=Strict$/)
})

test('zid verify refuses a foreign origin, a bad signature, and a reused challenge', async () => {
  const secret = ed25519.utils.randomPrivateKey()
  const publicKey = bytesToHex(ed25519.getPublicKey(secret))
  const login = makeSessionLogin({ liveConfig: () => ({ lcd: '', contract: '' }) })
  const [, ch] = login.handlers['POST /sezs/session/challenge'](
    {},
    { origin: 'http://localhost:3051', kind: 'zid' },
  )
  const signature = bytesToHex(ed25519.sign(Buffer.from(ch.message, 'utf8'), secret))
  const base = { origin: 'http://localhost:3051', nonce: ch.nonce, ts: ch.ts, method: 'zid', publicKey, signature }

  const foreign = await login.handlers['POST /sezs/session/verify']({}, { ...base, origin: 'http://127.0.0.1:3051' })
  assert.equal(foreign[0], 403)

  const [, ch2] = login.handlers['POST /sezs/session/challenge'](
    {},
    { origin: 'http://localhost:3051', kind: 'zid' },
  )
  const bad = await login.handlers['POST /sezs/session/verify'](
    {},
    { origin: 'http://localhost:3051', nonce: ch2.nonce, ts: ch2.ts, method: 'zid', publicKey, signature: 'aa'.repeat(64) },
  )
  assert.equal(bad[0], 403)
  assert.equal(bad[1].error, 'bad_signature')

  const [, ch3] = login.handlers['POST /sezs/session/challenge'](
    {},
    { origin: 'http://localhost:3051', kind: 'zid' },
  )
  const sig3 = bytesToHex(ed25519.sign(Buffer.from(ch3.message, 'utf8'), secret))
  const body = { origin: 'http://localhost:3051', nonce: ch3.nonce, ts: ch3.ts, method: 'zid', publicKey, signature: sig3 }
  const first = await login.handlers['POST /sezs/session/verify']({}, body)
  assert.equal(first[0], 200)
  const second = await login.handlers['POST /sezs/session/verify']({}, body)
  assert.equal(second[0], 400)
  assert.equal(second[1].error, 'unknown_challenge')
})
