import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fetchSessionRole, loadSession, saveSession, sealHttpSession } from './session.ts'
import { signInComplete } from './types.ts'

const define = (obj, key, value) => {
  const prev = Object.getOwnPropertyDescriptor(obj, key)
  Object.defineProperty(obj, key, { configurable: true, writable: true, value })
  return () => {
    if (prev) Object.defineProperty(obj, key, prev)
    else delete obj[key]
  }
}

const makeMemStorage = () => {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  }
}

test('loadSession preserves ZID and passkey sessions across reload (empty address)', () => {
  const ss = makeMemStorage()
  const ls = makeMemStorage()
  const restores = [
    define(globalThis, 'window', { location: { hostname: 'permissionless.money', port: '' } }),
    define(globalThis, 'sessionStorage', ss),
    define(globalThis, 'localStorage', ls),
  ]
  try {
    const zidSession = {
      credId: '',
      authenticators: [],
      policy: 'anyOf',
      role: 'guest',
      alias: 'guest',
      wallet: { kind: 'zid', zidPubkey: 'ab'.repeat(32), address: '', connectedAt: 1 },
      createdAt: 1,
    }
    saveSession(zidSession)
    const loadedZid = loadSession()
    assert.equal(loadedZid?.wallet?.kind, 'zid')
    assert.equal(loadedZid?.wallet?.zidPubkey, 'ab'.repeat(32))
    assert.equal(signInComplete(loadedZid), true)

    const passkeySession = {
      credId: 'cred-alpha-123',
      authenticators: [{ credId: 'cred-alpha-123', label: 'device-1', addedAt: 1 }],
      policy: 'anyOf',
      role: 'guest',
      alias: 'guest',
      wallet: { kind: 'passkey', address: '', passkeyCredId: 'cred-alpha-123', passkeyVerified: true, connectedAt: 1 },
      createdAt: 1,
    }
    saveSession(passkeySession)
    const loadedPk = loadSession()
    assert.equal(loadedPk?.wallet?.kind, 'passkey')
    assert.equal(loadedPk?.wallet?.passkeyCredId, 'cred-alpha-123')
    assert.equal(signInComplete(loadedPk), true)
  } finally {
    restores.reverse().forEach((fn) => fn())
  }
})

test('fetchSessionRole passes contract query parameter and sealHttpSession accepts passkey/zid', async () => {
  let fetchedUrl = ''
  const prevInbox = process.env.NEXT_PUBLIC_SEZS_FROST_INBOX
  process.env.NEXT_PUBLIC_SEZS_FROST_INBOX = '/alpha/sezs/api'
  const restoreFetch = define(globalThis, 'fetch', async (url) => {
    fetchedUrl = String(url)
    return new Response(JSON.stringify({ ok: true, role: 'guest', login_id: 'cred-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  try {
    const res = await fetchSessionRole('terp1qf4plkes8hmtpdjp06qmggdd69z067gt2jz6ffgymunxmwcj5p6s60vkyz')
    assert.equal(res.ok, true)
    assert.equal(
      fetchedUrl,
      '/alpha/sezs/api/sezs/session/me?contract=terp1qf4plkes8hmtpdjp06qmggdd69z067gt2jz6ffgymunxmwcj5p6s60vkyz',
    )
    const sealed = await sealHttpSession({ kind: 'passkey', address: '', passkeyCredId: 'cred-1', passkeyVerified: true, connectedAt: 1 })
    assert.equal(sealed.ok, true)
  } finally {
    restoreFetch()
    if (prevInbox === undefined) delete process.env.NEXT_PUBLIC_SEZS_FROST_INBOX
    else process.env.NEXT_PUBLIC_SEZS_FROST_INBOX = prevInbox
  }
})
