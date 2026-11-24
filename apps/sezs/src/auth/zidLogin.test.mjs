import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loginWithZid, zafuErrorMessage } from './zidLogin.ts'

const PUB = 'ab'.repeat(32)
const SIG = 'cd'.repeat(32)

const challenge = {
  nonce: 'aa'.repeat(16),
  ts: 1,
  challengeHex: '11'.repeat(16),
  statement: 'Sign in to http://localhost:3051',
}

const mockSdk = (opts = {}) => ({
  detect: async () => opts.detect || { installed: true, compatible: true },
  requireWallet: async () => {
    if (opts.requireError) throw opts.requireError
    return { id: 'wallet' }
  },
  sign: async (_w, hex, statement) => {
    if (opts.signError) throw opts.signError
    assert.equal(hex, challenge.challengeHex)
    assert.equal(statement, challenge.statement)
    return { signature: SIG, publicKey: PUB }
  },
})

class FakeZafuError extends Error {
  constructor(code, message) {
    super(message || code)
    this.name = 'ZafuError'
    this.code = code
  }
}

test('loginWithZid walks idle → connecting → connected and returns a zid wallet', async () => {
  const phases = []
  const wallet = await loginWithZid({
    sdk: mockSdk(),
    origin: 'http://localhost:3051',
    issueChallenge: async (origin) => {
      assert.equal(origin, 'http://localhost:3051')
      return challenge
    },
    verifySignature: async (args) => {
      assert.equal(args.publicKey, PUB)
      assert.equal(args.signature, SIG)
      assert.equal(args.nonce, challenge.nonce)
      return { ok: true, login_id: PUB, role: 'guest' }
    },
    onState: (s) => phases.push(s.phase + (s.waiting ? ':waiting' : '')),
  })
  assert.equal(wallet.kind, 'zid')
  assert.equal(wallet.zidPubkey, PUB)
  assert.deepEqual(phases[0], 'connecting')
  assert.ok(phases.includes('connecting:waiting'))
  assert.equal(phases.at(-1), 'connected')
})

test('loginWithZid maps unavailable and denied without pretending the extension is missing after a decline', async () => {
  await assert.rejects(
    () =>
      loginWithZid({
        sdk: mockSdk({ detect: { installed: false } }),
        origin: 'http://localhost:3051',
        issueChallenge: async () => challenge,
        verifySignature: async () => ({ ok: true }),
      }),
    /isn’t in this browser/,
  )

  const denied = new FakeZafuError('denied', 'user declined')
  await assert.rejects(
    () =>
      loginWithZid({
        sdk: mockSdk({ signError: denied }),
        origin: 'http://localhost:3051',
        issueChallenge: async () => challenge,
        verifySignature: async () => ({ ok: true }),
      }),
    /declined/,
  )
})

test('loginWithZid fails closed when the server rejects the signature', async () => {
  await assert.rejects(
    () =>
      loginWithZid({
        sdk: mockSdk(),
        origin: 'http://localhost:3051',
        issueChallenge: async () => challenge,
        verifySignature: async () => ({ ok: false, error: 'bad_signature' }),
      }),
    /bad_signature/,
  )
})

test('zafuErrorMessage covers the documented codes', () => {
  assert.match(zafuErrorMessage('locked'), /locked/i)
  assert.match(zafuErrorMessage('incompatible'), /Update Zafu/)
  assert.match(zafuErrorMessage('not_available'), /identity layer/)
})
