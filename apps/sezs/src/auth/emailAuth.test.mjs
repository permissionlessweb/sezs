import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EMAIL_CSRF_HEADER, createEmailAuthClient } from './emailAuth.ts'

const mockFetch = (handler) => {
  const calls = []
  const fetch = async (input, init = {}) => {
    calls.push({ input, init })
    const out = await handler(input, init, calls.length)
    if (out instanceof Response) return out
    const { status = 200, body = {} } = out || {}
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
  return { fetch, calls }
}

test('email client walks idle → connecting → connected when verify succeeds', async () => {
  const { fetch, calls } = mockFetch(async (input) => {
    if (String(input).endsWith('/verify')) return { status: 200, body: { ok: true, login_id: 'mail-1' } }
    return { status: 501, body: { error: 'not_implemented' } }
  })
  const client = createEmailAuthClient({ fetch })
  const phases = []
  client.subscribe((s) => phases.push(s.adapter.phase))
  await client.verifyCode('Guest@Example.com', '123456')
  const s = client.getState()
  assert.equal(s.isAuthenticated, true)
  assert.equal(s.session.email, 'guest@example.com')
  assert.equal(s.sessionVersion, 1)
  assert.equal(s.adapter.phase, 'connected')
  assert.equal(calls[0].init.credentials, 'include')
  assert.equal(calls[0].init.headers[EMAIL_CSRF_HEADER], '1')
  assert.ok(phases.includes('connecting'))
  assert.equal(phases.at(-1), 'connected')
})

test('requestLink fails closed on 501 and does not claim a message was sent', async () => {
  const { fetch } = mockFetch(async () => ({ status: 501, body: { error: 'not_implemented' } }))
  const client = createEmailAuthClient({ fetch })
  await assert.rejects(() => client.requestLink('guest@example.com'), /isn’t available yet/)
  const s = client.getState()
  assert.equal(s.available, false)
  assert.equal(s.isAuthenticated, false)
  assert.equal(s.adapter.phase, 'error')
})

test('refreshSession keeps a prior session when the request fails', async () => {
  let mode = 'ok'
  const { fetch } = mockFetch(async (input) => {
    if (String(input).endsWith('/verify')) return { status: 200, body: { ok: true, login_id: 'mail-1' } }
    if (mode === 'down') throw new Error('offline')
    return { status: 200, body: { ok: true, email: 'guest@example.com', login_id: 'mail-1' } }
  })
  const client = createEmailAuthClient({ fetch })
  await client.verifyCode('guest@example.com', '123456')
  const v = client.getState().sessionVersion
  mode = 'down'
  await client.refreshSession()
  const s = client.getState()
  assert.equal(s.isAuthenticated, true)
  assert.equal(s.session.email, 'guest@example.com')
  assert.equal(s.sessionVersion, v)
})

test('logout increments sessionVersion and clears the session', async () => {
  const { fetch } = mockFetch(async (input) => {
    if (String(input).endsWith('/verify')) return { status: 200, body: { ok: true } }
    return { status: 200, body: { ok: true } }
  })
  const client = createEmailAuthClient({ fetch })
  await client.verifyCode('guest@example.com', '000000')
  await client.logout()
  const s = client.getState()
  assert.equal(s.isAuthenticated, false)
  assert.equal(s.session, null)
  assert.equal(s.sessionVersion, 2)
  assert.equal(s.adapter.phase, 'idle')
})


import { createHash } from 'node:crypto'

test('requestLink solves stateless 428 pow_required challenge transparently', async () => {
  const salt = '0123456789abcdef0123456789abcdef'
  let attempts = 0
  const { fetch } = mockFetch(async (_input, init) => {
    attempts += 1
    const payload = JSON.parse(String(init.body || '{}'))
    if (!payload.pow) {
      return { status: 428, body: { ok: false, error: 'pow_required', pow: { salt, bits: 8, exp: Date.now() + 60_000, sig: 'sig' } } }
    }
    const digest = createHash('sha256').update(`${salt}:${payload.pow.nonce}`).digest()
    assert.equal(digest[0], 0)
    return { status: 200, body: { ok: true, status: 'awaiting' } }
  })
  const client = createEmailAuthClient({ fetch })
  const out = await client.requestLink('pow@example.com')
  assert.equal(out.ok, true)
  assert.equal(attempts, 2)
})

test('bindZid and bindPasskey fetch bind-challenge and submit cryptographic proof', async () => {
  const { fetch, calls } = mockFetch(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/verify')) return { status: 200, body: { ok: true, login_id: 'mail-1' } }
    if (url.endsWith('/bind-challenge')) {
      return { status: 200, body: { ok: true, nonce: 'n-1', ts: 1, message: 'SEZS-EMAIL-BIND-V1', challengeHex: 'aa', challengeB64: 'qg' } }
    }
    if (url.endsWith('/bind')) {
      const b = JSON.parse(String(init.body || '{}'))
      assert.equal(b.nonce, 'n-1')
      if (b.kind === 'ed25519/zid') return { status: 200, body: { ok: true, bound: { zidPubkey: b.zidPubkey } } }
      if (b.kind === 'p256/passkey') return { status: 200, body: { ok: true, bound: { zidPubkey: 'zid-1', passkeyCredId: b.credId } } }
    }
    return { status: 400, body: { ok: false } }
  })
  const client = createEmailAuthClient({ fetch })
  await client.verifyCode('guest@example.com', '123456')
  await client.bindZid({ zidPubkey: 'zid-1', signChallenge: async (ch) => `sig-${ch.nonce}` })
  await client.bindPasskey({
    credId: 'cred-1',
    publicKey: 'pub-1',
    assertChallenge: async (ch) => ({ clientDataJSON: ch.challengeB64, authenticatorData: 'ad', signature: 'sig' }),
  })
  const s = client.getState()
  assert.equal(s.session.bound.zidPubkey, 'zid-1')
  assert.equal(s.session.bound.passkeyCredId, 'cred-1')
  assert.ok(calls.some((c) => String(c.input).endsWith('/bind-challenge')))
})
