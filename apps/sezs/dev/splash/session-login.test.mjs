import assert from 'node:assert/strict'
import test from 'node:test'

import { newAdmin, signAdr036 } from '../../src/ble/lab-sign.mjs'
import { loginMessage, makeSessionLogin } from './session-login.mjs'

test('login challenge is origin-bound and verify sets a staff session for a coordinator', async () => {
  const admin = newAdmin()
  const login = makeSessionLogin({
    liveConfig: () => ({ lcd: '', contract: '' }),
  })
  const [code, ch] = login.handlers['POST /sezs/session/challenge'](
    {},
    { origin: 'http://127.0.0.1:3051', artist_id: admin.address },
  )
  assert.equal(code, 200)
  assert.equal(ch.ok, true)
  assert.equal(ch.message, loginMessage({ origin: 'http://127.0.0.1:3051', address: admin.address, nonce: ch.nonce, ts: ch.ts }))

  const refused = login.handlers['POST /sezs/session/challenge'](
    {},
    { origin: 'https://evil.example', artist_id: admin.address },
  )
  assert.equal(refused[0], 403)

  const signed = signAdr036(admin.address, ch.message, admin.secret)
  const [vcode, body, headers] = await login.handlers['POST /sezs/session/verify'](
    {},
    {
      origin: 'http://127.0.0.1:3051',
      artist_id: admin.address,
      nonce: ch.nonce,
      ts: ch.ts,
      method: 'adr036',
      pub_key: signed.pub_key,
      signature: signed.signature,
    },
  )
  assert.equal(vcode, 200)
  assert.equal(body.ok, true)
  assert.equal(body.login_id, admin.address)
  assert.match(headers['set-cookie'], /^sezs_splash=sess-[a-f0-9]+; Path=\/; HttpOnly; SameSite=Strict$/)
  const id = /sezs_splash=([a-z0-9-]+)/.exec(headers['set-cookie'])[1]
  assert.equal(login.addressOfSession(id), admin.address)
  assert.ok(id.length <= 32)
})

test('login verify refuses a reused challenge', async () => {
  const admin = newAdmin()
  const login = makeSessionLogin({ liveConfig: () => ({ lcd: '', contract: '' }) })
  const [, ch] = login.handlers['POST /sezs/session/challenge'](
    {},
    { origin: 'http://127.0.0.1:3051', artist_id: admin.address },
  )
  const signed = signAdr036(admin.address, ch.message, admin.secret)
  const body = {
    origin: 'http://127.0.0.1:3051',
    artist_id: admin.address,
    nonce: ch.nonce,
    ts: ch.ts,
    method: 'adr036',
    pub_key: signed.pub_key,
    signature: signed.signature,
  }
  const first = await login.handlers['POST /sezs/session/verify']({}, body)
  assert.equal(first[0], 200)
  const second = await login.handlers['POST /sezs/session/verify']({}, body)
  assert.equal(second[0], 400)
  assert.equal(second[1].error, 'unknown_challenge')
})
