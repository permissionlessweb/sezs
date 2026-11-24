import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { decodeBech32, encodeBech32, looksUmBech32, parseAddressQr } from './bech32.mjs'

describe('UM bech32 and address QR', () => {
  it('encodes and accepts a penumbra1 address with a valid checksum', () => {
    const addr = encodeBech32('penumbra', new Uint8Array(32).fill(7), 'bech32m')
    assert.ok(addr.startsWith('penumbra1'))
    assert.equal(looksUmBech32(addr), true)
    assert.ok(decodeBech32(addr))
    assert.equal(looksUmBech32('penumbra1thisisnotavalidchecksumxxxxx'), false)
  })

  it('parses a Zigner QR payload as UM or ZEC', () => {
    const um = encodeBech32('penumbra', new Uint8Array(32).fill(3), 'bech32m')
    assert.equal(parseAddressQr(um).kind, 'um')
    assert.equal(parseAddressQr('zcash:' + um).ok, false)
    const zec = 'uregtest1labonlydonotsendrealfunds00000000000000000000000000'
    assert.equal(parseAddressQr(`zcash:${zec}`).kind, 'zec')
  })
})

describe('long UM bech32m', () => {
  it('accepts a long official-length Penumbra address (bech32m)', () => {
    const payload = Uint8Array.from({ length: 80 }, (_, i) => (i * 17 + 3) & 0xff)
    const addr = encodeBech32('penumbra', payload, 'bech32m')
    assert.ok(addr.startsWith('penumbra1'))
    assert.ok(addr.length > 120)
    assert.equal(looksUmBech32(addr), true)
    const d = decodeBech32(addr)
    assert.equal(d.hrp, 'penumbra')
    assert.equal(d.encoding, 'bech32m')
  })
})
