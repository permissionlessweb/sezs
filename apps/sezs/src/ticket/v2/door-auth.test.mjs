import { test } from 'node:test'
import assert from 'node:assert/strict'
import { doorAuthPubkeyString } from './door-auth.mjs'

test('door auth hex decodes to the utf-8 string wasm signPrinted expects', () => {
  const door = 'sezs-lab-door-auth-v2'.padEnd(32, 'x')
  const hex = Buffer.from(door, 'utf8').toString('hex')
  assert.equal(hex.length, 64)
  assert.equal(doorAuthPubkeyString(hex), door)
  assert.equal(doorAuthPubkeyString('0x' + hex), door)
  assert.equal(doorAuthPubkeyString(''), '')
  const asciiHex = Buffer.from('A', 'utf8').toString('hex')
  assert.equal(doorAuthPubkeyString(asciiHex), 'A')
  // latin-1 widening of UTF-8 é is not the same as a utf-8 decode
  assert.notEqual(String.fromCharCode(...Buffer.from('c3a9', 'hex')), doorAuthPubkeyString('c3a9'))
})

test('door auth hex that is not utf-8 is rejected', () => {
  assert.throws(() => doorAuthPubkeyString('ff'))
})
