import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { generateCipherIdentity, loadZafuCipher, resolveZafuWasmDir, signRelayChallenge } from './zafu-cipher.mjs'
import { verifyXeddsa } from './xeddsa.mjs'

describe('XEdDSA login (shared with FrostRelayCipher)', () => {
  it('verifies a frost_relay_sign_challenge over the same X25519 key', async (t) => {
    if (!resolveZafuWasmDir()) {
      t.skip('SEZS_ZAFU_WASM or a zafu package is not present (optional on a clean clone; see docs/BUILD.md)'); return
    }
    await loadZafuCipher()
    const id = await generateCipherIdentity()
    const challenge = 'a'.repeat(64)
    const sig = await signRelayChallenge(id, challenge)
    assert.match(sig, /^[0-9a-f]{128}$/i)
    assert.equal(verifyXeddsa(id.publicKey, challenge, sig), true)
    assert.equal(verifyXeddsa(id.publicKey, 'b'.repeat(64), sig), false)
    const other = await generateCipherIdentity()
    assert.equal(verifyXeddsa(other.publicKey, challenge, sig), false)
  })
})
