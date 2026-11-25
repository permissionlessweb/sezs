import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PRF_UNSUPPORTED, assertPasskeyChallenge, createPasskeyWithKey, detectPrfSupport, needsPrfAssertion, prfEnabledOf, prfOf, prfSalt } from './passkeyKey.ts'
import { defaultPasskeyName } from './passkeyName.ts'

const mockCred = (opts = {}) => {
  const rawId = opts.rawId || new Uint8Array(16).fill(7)
  const prf = opts.prf === undefined ? new Uint8Array(32).fill(9) : opts.prf
  const pub = new Uint8Array(65)
  pub[0] = 0x04
  return {
    rawId,
    response: {
      getPublicKeyAlgorithm: () => -7,
      getPublicKey: () => {
        const spki = new Uint8Array(88)
        spki.set(pub, 23)
        return spki.buffer
      },
    },
    getClientExtensionResults: () => (prf ? { prf: { results: { first: prf } } } : {}),
  }
}

const define = (obj, key, value) => {
  const prev = Object.getOwnPropertyDescriptor(obj, key)
  Object.defineProperty(obj, key, { configurable: true, writable: true, value })
  return () => {
    if (prev) Object.defineProperty(obj, key, prev)
    else delete obj[key]
  }
}

function stubBrowser({ cred, getCred }) {
  const restores = []
  restores.push(define(globalThis, 'location', {
    hostname: 'localhost',
    origin: 'http://localhost:3051',
    href: 'http://localhost:3051/',
    replace() {},
  }))
  const PK = class {
    static async getClientCapabilities() {
      return { 'extension:prf': true }
    }
  }
  restores.push(define(globalThis, 'PublicKeyCredential', PK))
  const credentials = {
    create: async (opts) => {
      credentials.lastCreate = opts
      return cred
    },
    get: async () => (getCred === undefined ? cred : getCred),
    lastCreate: null,
  }
  if (typeof navigator === 'undefined') {
    restores.push(define(globalThis, 'navigator', { credentials }))
  } else {
    const prev = Object.getOwnPropertyDescriptor(navigator, 'credentials')
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: credentials })
    restores.push(() => {
      if (prev) Object.defineProperty(navigator, 'credentials', prev)
      else delete navigator.credentials
    })
  }
  return { credentials, restore: () => restores.reverse().forEach((fn) => fn()) }
}

test('prfOf accepts only a 32-byte result and never invents a key', () => {
  assert.equal(prfOf(mockCred({ prf: null })), null)
  assert.equal(prfOf(mockCred({ prf: new Uint8Array(16) })), null)
  const ok = prfOf(mockCred({ prf: new Uint8Array(32).fill(3) }))
  assert.equal(ok.length, 32)
  assert.equal(ok[0], 3)
  const trimmed = prfOf(mockCred({ prf: new Uint8Array(40).fill(4) }))
  assert.equal(trimmed.length, 32)
})

test('detectPrfSupport is no when capabilities say the extension is absent', async () => {
  const restore = define(globalThis, 'PublicKeyCredential', class {
    static async getClientCapabilities() {
      return { 'extension:prf': false }
    }
  })
  try {
    assert.equal(await detectPrfSupport(), 'no')
  } finally {
    restore()
  }
})

test('detectPrfSupport is yes when capabilities advertise PRF', async () => {
  const restore = define(globalThis, 'PublicKeyCredential', class {
    static async getClientCapabilities() {
      return { 'extension:prf': true }
    }
  })
  try {
    assert.equal(await detectPrfSupport(), 'yes')
  } finally {
    restore()
  }
})

test('detectPrfSupport is unknown when the browser has no capability probe', async () => {
  const restore = define(globalThis, 'PublicKeyCredential', class {})
  try {
    assert.equal(await detectPrfSupport(), 'unknown')
  } finally {
    restore()
  }
})

test('prf salt is a stable 32-byte SHA-256 of the app label', async () => {
  const a = await prfSalt()
  const b = await prfSalt()
  assert.equal(a.length, 32)
  assert.deepEqual([...a], [...b])
})

test('PRF_UNSUPPORTED is short, honest, and does not mention plaintext storage', () => {
  assert.match(PRF_UNSUPPORTED, /Nothing was stored/)
  assert.match(PRF_UNSUPPORTED, /PRF is missing/)
  assert.doesNotMatch(PRF_UNSUPPORTED, /localStorage|plaintext|keep the key|Use Zafu|passkey manager/)
})

test('createPasskeyWithKey uses UV required and returns a 32-byte PRF key', async () => {
  const { credentials, restore } = stubBrowser({ cred: mockCred() })
  try {
    const out = await createPasskeyWithKey('guest')
    assert.equal(out.prfKey.length, 32)
    assert.equal(out.params.rp_id, 'localhost')
    assert.equal(credentials.lastCreate.publicKey.authenticatorSelection.userVerification, 'required')
    assert.ok(credentials.lastCreate.publicKey.extensions.prf.eval.first)
    assert.equal(credentials.lastCreate.publicKey.user.name, defaultPasskeyName())
    assert.equal(credentials.lastCreate.publicKey.user.displayName, defaultPasskeyName())
  } finally {
    restore()
  }
})

test('createPasskeyWithKey fails closed when PRF is absent and does not store a key', async () => {
  let stored = 0
  const restoreStore = define(globalThis, 'localStorage', {
    getItem() { return null },
    setItem() { stored += 1 },
    removeItem() {},
  })
  const bare = mockCred({ prf: null })
  const { restore } = stubBrowser({ cred: bare, getCred: bare })
  try {
    await assert.rejects(() => createPasskeyWithKey('guest'), /Nothing was stored/)
    assert.equal(stored, 0)
  } finally {
    restore()
    restoreStore()
  }
})


test('assertPasskeyChallenge handles non-localhost rpId (permissionless.money)', async () => {
  const rawId = new Uint8Array(16).fill(7)
  const credId = Buffer.from(rawId).toString('base64url')
  let capturedGet = null
  const restoreLoc = define(globalThis, 'location', {
    hostname: 'permissionless.money',
    origin: 'https://permissionless.money',
    href: 'https://permissionless.money/alpha/sezs/',
    replace() {},
  })
  const restoreNav = define(globalThis, 'navigator', {
    credentials: {
      get: async (opts) => {
        capturedGet = opts
        return {
          rawId,
          response: {
            clientDataJSON: new Uint8Array([1, 2, 3]).buffer,
            authenticatorData: new Uint8Array(37).fill(5).buffer,
            signature: new Uint8Array(64).fill(6).buffer,
          },
          getClientExtensionResults: () => ({}),
        }
      },
    },
  })
  try {
    const chB64 = Buffer.from(new Uint8Array(32).fill(11)).toString('base64url')
    const res = await assertPasskeyChallenge(credId, chB64)
    assert.equal(capturedGet.publicKey.rpId, 'permissionless.money')
    assert.equal(capturedGet.publicKey.userVerification, 'required')
    assert.ok(res.assertion.clientDataJSON)
    assert.ok(res.assertion.authenticatorData)
    assert.ok(res.assertion.signature)
  } finally {
    restoreNav()
    restoreLoc()
  }
})

test('prfExtension passes a 32-byte ArrayBuffer salt (BufferSource)', async () => {
  const { prfExtension } = await import('./passkeyKey.ts')
  const ext = await prfExtension()
  const first = ext.prf.eval.first
  assert.ok(first instanceof ArrayBuffer)
  assert.equal(first.byteLength, 32)
})

test('createPasskeyForSignIn works without PRF even when extension:prf is false', async () => {
  const bare = mockCred({ prf: null })
  const restores = []
  restores.push(define(globalThis, 'location', {
    hostname: 'permissionless.money',
    origin: 'https://permissionless.money',
    href: 'https://permissionless.money/alpha/sezs/',
    replace() {},
  }))
  restores.push(define(globalThis, 'PublicKeyCredential', class {
    static async getClientCapabilities() {
      return { 'extension:prf': false }
    }
  }))
  let capturedCreate = null
  const credentials = {
    create: async (opts) => {
      capturedCreate = opts
      return bare
    },
  }
  const prev = Object.getOwnPropertyDescriptor(navigator, 'credentials')
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: credentials })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, 'credentials', prev)
    else delete navigator.credentials
  })
  try {
    const { createPasskeyForSignIn } = await import('./passkeyKey.ts')
    const out = await createPasskeyForSignIn('guest')
    assert.equal(out.params.rp_id, 'permissionless.money')
    assert.equal(out.params.origin, 'https://permissionless.money')
    assert.equal(capturedCreate.publicKey.rp.id, 'permissionless.money')
    assert.equal(capturedCreate.publicKey.authenticatorSelection.residentKey, 'preferred')
    assert.equal(capturedCreate.publicKey.authenticatorSelection.userVerification, 'required')
    assert.equal(capturedCreate.publicKey.extensions, undefined)
    assert.equal(capturedCreate.publicKey.user.name, defaultPasskeyName())
    assert.equal(capturedCreate.publicKey.user.displayName, defaultPasskeyName())
    assert.ok(out.credId)
    assert.ok(out.params.public_key)
  } finally {
    restores.reverse().forEach((fn) => fn())
  }
})

test('createPasskeyWithKey follows up with get() when create() only reports prf.enabled', async () => {
  const rawId = new Uint8Array(16).fill(8)
  const pub = new Uint8Array(65)
  pub[0] = 0x04
  const createCred = {
    rawId,
    response: {
      getPublicKeyAlgorithm: () => -7,
      getPublicKey: () => {
        const spki = new Uint8Array(88)
        spki.set(pub, 23)
        return spki.buffer
      },
    },
    getClientExtensionResults: () => ({ prf: { enabled: true } }),
  }
  const getCred = {
    rawId,
    response: {
      clientDataJSON: new Uint8Array([1, 2, 3]).buffer,
      authenticatorData: new Uint8Array(37).fill(5).buffer,
      signature: new Uint8Array(64).fill(6).buffer,
    },
    getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(42).buffer } } }),
  }
  let getCalls = 0
  const restores = []
  restores.push(define(globalThis, 'location', {
    hostname: 'permissionless.money',
    origin: 'https://permissionless.money',
    href: 'https://permissionless.money/alpha/sezs/',
    replace() {},
  }))
  restores.push(define(globalThis, 'PublicKeyCredential', class {
    static async getClientCapabilities() {
      return { 'extension:prf': true }
    }
  }))
  const credentials = {
    create: async () => createCred,
    get: async () => {
      getCalls += 1
      return getCred
    },
  }
  const prev = Object.getOwnPropertyDescriptor(navigator, 'credentials')
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: credentials })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, 'credentials', prev)
    else delete navigator.credentials
  })
  try {
    const chB64 = Buffer.from(new Uint8Array(32).fill(11)).toString('base64url')
    const out = await createPasskeyWithKey('guest', { challengeB64: chB64 })
    assert.equal(getCalls, 1)
    assert.equal(out.prfKey.length, 32)
    assert.equal(out.prfKey[0], 42)
    assert.equal(out.params.rp_id, 'permissionless.money')
    assert.ok(out.assertion?.signature)
  } finally {
    restores.reverse().forEach((fn) => fn())
  }
})

test('assertPasskeyChallenge supports discoverable login without credId', async () => {
  const rawId = new Uint8Array(16).fill(12)
  let capturedGet = null
  const restoreLoc = define(globalThis, 'location', {
    hostname: 'permissionless.money',
    origin: 'https://permissionless.money',
    href: 'https://permissionless.money/alpha/sezs/',
    replace() {},
  })
  const restoreNav = define(globalThis, 'navigator', {
    credentials: {
      get: async (opts) => {
        capturedGet = opts
        return {
          rawId,
          response: {
            clientDataJSON: new Uint8Array([1, 2, 3]).buffer,
            authenticatorData: new Uint8Array(37).fill(5).buffer,
            signature: new Uint8Array(64).fill(6).buffer,
          },
          getClientExtensionResults: () => ({}),
        }
      },
    },
  })
  try {
    const chB64 = Buffer.from(new Uint8Array(32).fill(11)).toString('base64url')
    const res = await assertPasskeyChallenge(null, chB64)
    assert.equal(capturedGet.publicKey.rpId, 'permissionless.money')
    assert.equal(capturedGet.publicKey.allowCredentials, undefined)
    assert.equal(res.credId, Buffer.from(rawId).toString('base64url'))
  } finally {
    restoreNav()
    restoreLoc()
  }
})

test('createPasskeyWithKey uses a chosen alias as the passkey name', async () => {
  const { credentials, restore } = stubBrowser({ cred: mockCred() })
  try {
    await createPasskeyWithKey('ada')
    assert.equal(credentials.lastCreate.publicKey.user.name, 'ada')
    assert.equal(credentials.lastCreate.publicKey.user.displayName, 'ada')
  } finally {
    restore()
  }
})

test('prfEnabledOf and needsPrfAssertion read create() extension results', () => {
  const enabledOnly = mockCred({ prf: null })
  enabledOnly.getClientExtensionResults = () => ({ prf: { enabled: true } })
  assert.equal(prfOf(enabledOnly), null)
  assert.equal(prfEnabledOf(enabledOnly), true)
  assert.equal(needsPrfAssertion(enabledOnly), true)

  const disabled = mockCred({ prf: null })
  disabled.getClientExtensionResults = () => ({ prf: { enabled: false } })
  assert.equal(prfEnabledOf(disabled), false)
  assert.equal(needsPrfAssertion(disabled), false)

  const omitted = mockCred({ prf: null })
  assert.equal(prfEnabledOf(omitted), undefined)
  assert.equal(needsPrfAssertion(omitted), true)

  const withResults = mockCred({ prf: new Uint8Array(32).fill(3) })
  assert.equal(needsPrfAssertion(withResults), false)
  assert.equal(prfEnabledOf(withResults), true)
})

function p256CreateCred(extensionResults, rawId = new Uint8Array(16).fill(8)) {
  const pub = new Uint8Array(65)
  pub[0] = 0x04
  return {
    rawId,
    response: {
      getPublicKeyAlgorithm: () => -7,
      getPublicKey: () => {
        const spki = new Uint8Array(88)
        spki.set(pub, 23)
        return spki.buffer
      },
    },
    getClientExtensionResults: () => extensionResults,
  }
}

test('createPasskeyWithKey follows up with get() when create() only reports prf.enabled and no session challenge', async () => {
  const rawId = new Uint8Array(16).fill(8)
  const createCred = p256CreateCred({ prf: { enabled: true } }, rawId)
  const getCred = {
    rawId,
    getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(42) } } }),
  }
  let getCalls = 0
  const { restore } = stubBrowser({ cred: createCred, getCred })
  const prevGet = navigator.credentials.get
  navigator.credentials.get = async (opts) => {
    getCalls += 1
    assert.ok(opts.publicKey.extensions.prf.eval.first)
    return getCred
  }
  try {
    const out = await createPasskeyWithKey('ada')
    assert.equal(getCalls, 1)
    assert.equal(out.prfKey.length, 32)
    assert.equal(out.prfKey[0], 42)
    assert.equal(out.assertion, undefined)
  } finally {
    navigator.credentials.get = prevGet
    restore()
  }
})

test('createPasskeyWithKey follows up with get() when create() omits prf extension results', async () => {
  const rawId = new Uint8Array(16).fill(8)
  const createCred = p256CreateCred({}, rawId)
  const getCred = {
    rawId,
    getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(7) } } }),
  }
  let getCalls = 0
  const { restore } = stubBrowser({ cred: createCred, getCred })
  const prevGet = navigator.credentials.get
  navigator.credentials.get = async () => {
    getCalls += 1
    return getCred
  }
  try {
    const out = await createPasskeyWithKey('ada')
    assert.equal(getCalls, 1)
    assert.equal(out.prfKey[0], 7)
  } finally {
    navigator.credentials.get = prevGet
    restore()
  }
})

test('createPasskeyWithKey does not get() when create() reports prf.enabled false', async () => {
  const createCred = p256CreateCred({ prf: { enabled: false } })
  let getCalls = 0
  const { restore } = stubBrowser({
    cred: createCred,
    getCred: {
      rawId: createCred.rawId,
      getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(1) } } }),
    },
  })
  const prevGet = navigator.credentials.get
  navigator.credentials.get = async () => {
    getCalls += 1
    throw new Error('get() should not run when PRF is disabled')
  }
  try {
    await assert.rejects(() => createPasskeyWithKey('ada'), /Nothing was stored/)
    assert.equal(getCalls, 0)
  } finally {
    navigator.credentials.get = prevGet
    restore()
  }
})

test('createPasskeyWithKey with a session challenge still asserts when PRF already arrived on create()', async () => {
  const rawId = new Uint8Array(16).fill(8)
  const createCred = p256CreateCred({ prf: { results: { first: new Uint8Array(32).fill(9) } } }, rawId)
  const getCred = {
    rawId,
    response: {
      clientDataJSON: new Uint8Array([1, 2, 3]).buffer,
      authenticatorData: new Uint8Array(37).fill(5).buffer,
      signature: new Uint8Array(64).fill(6).buffer,
    },
    getClientExtensionResults: () => ({}),
  }
  let getCalls = 0
  let getRequestedPrf = false
  const restores = []
  const define = (obj, key, value) => {
    const prev = Object.getOwnPropertyDescriptor(obj, key)
    Object.defineProperty(obj, key, { configurable: true, writable: true, value })
    restores.push(() => {
      if (prev) Object.defineProperty(obj, key, prev)
      else delete obj[key]
    })
  }
  define(globalThis, 'location', {
    hostname: 'permissionless.money',
    origin: 'https://permissionless.money',
    href: 'https://permissionless.money/alpha/sezs/',
    replace() {},
  })
  define(globalThis, 'PublicKeyCredential', class {
    static async getClientCapabilities() {
      return { 'extension:prf': true }
    }
  })
  const credentials = {
    create: async () => createCred,
    get: async (opts) => {
      getCalls += 1
      getRequestedPrf = Boolean(opts?.publicKey?.extensions?.prf)
      return getCred
    },
  }
  const prev = Object.getOwnPropertyDescriptor(navigator, 'credentials')
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: credentials })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, 'credentials', prev)
    else delete navigator.credentials
  })
  try {
    const chB64 = Buffer.from(new Uint8Array(32).fill(11)).toString('base64url')
    const out = await createPasskeyWithKey('ada', { challengeB64: chB64 })
    assert.equal(getCalls, 1)
    assert.equal(getRequestedPrf, false)
    assert.equal(out.prfKey[0], 9)
    assert.ok(out.assertion?.signature)
  } finally {
    restores.reverse().forEach((fn) => fn())
  }
})

