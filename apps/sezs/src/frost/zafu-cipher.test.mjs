import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createFrostRelayCipher,
  generateCipherIdentity,
  loadZafuCipher,
  resolveZafuWasmDir,
} from './zafu-cipher.mjs'

describe('Zafu FrostRelayCipher (Noise_K)', () => {
  it('loads the wasm package and round-trips a payload', async () => {
    assert.ok(resolveZafuWasmDir(), 'SEZS_ZAFU_WASM or the local zafu package must be present')
    const { src } = await loadZafuCipher()
    assert.ok(src.includes('zcash-wasm'))
    const a = await generateCipherIdentity()
    const b = await generateCipherIdentity()
    assert.match(a.publicKey, /^[0-9a-f]{64}$/i)
    assert.notEqual(a.publicKey, b.publicKey)
    const ca = await createFrostRelayCipher(a, [b.publicKey])
    const cb = await createFrostRelayCipher(b, [a.publicKey])
    const enc = ca.encrypt(b.publicKey, 'sezs-frost-hello')
    assert.match(enc, /^[0-9a-f]+$/i)
    assert.equal(cb.decrypt(a.publicKey, enc), 'sezs-frost-hello')
    // A relabelled sender must not decrypt (Noise_K binds the static key).
    const c = await generateCipherIdentity()
    const cc = await createFrostRelayCipher(c, [b.publicKey])
    const spoof = cc.encrypt(b.publicKey, 'nope')
    assert.throws(() => cb.decrypt(a.publicKey, spoof))
    ca.free(); cb.free(); cc.free()
  })
})
