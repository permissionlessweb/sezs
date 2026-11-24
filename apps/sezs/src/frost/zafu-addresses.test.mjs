import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { encodeBech32 } from '../pay/bech32.mjs'
import { addressFromQrText, getConnectedAddresses, randomizeConnectedAddresses } from './zafu-addresses.mjs'

describe('Zafu-connected addresses', () => {
  it('autofills and randomizes through the connected wallet hook, never a seed', async () => {
    const um1 = encodeBech32('penumbra', new Uint8Array(32).fill(1), 'bech32m')
    const um2 = encodeBech32('penumbra', new Uint8Array(32).fill(2), 'bech32m')
    const zec1 = 'uregtest1labonlydonotsendrealfunds00000000000000000000000000'
    const zec2 = 'uregtest1seconddiversifiedaddress000000000000000000000000000'
    globalThis.__SEZS_ZAFU__ = {
      getAddresses: async () => ({ zec: zec1, um: um1 }),
      randomize: async () => ({ zec: zec2, um: um2 }),
    }
    const first = await getConnectedAddresses()
    assert.equal(first.ok, true)
    assert.equal(first.zec, zec1)
    assert.equal(first.um, um1)
    assert.equal(first.umOk, true)
    const next = await randomizeConnectedAddresses()
    assert.equal(next.um, um2)
    assert.notEqual(next.um, first.um)
    delete globalThis.__SEZS_ZAFU__
    const missing = await getConnectedAddresses()
    assert.equal(missing.ok, false)
    assert.equal(missing.error, 'zafu_not_connected')
  })

  it('accepts a Zigner QR of a penumbra1 address', () => {
    const um = encodeBech32('penumbra', new Uint8Array(32).fill(9), 'bech32m')
    const parsed = addressFromQrText(um)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.kind, 'um')
    assert.equal(parsed.address, um)
  })
})
