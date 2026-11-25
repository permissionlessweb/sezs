import assert from 'node:assert/strict'
import { test } from 'node:test'

import { defaultPasskeyName, passkeyDisplayName } from './passkeyName.ts'

test('defaultPasskeyName is sez-<yy-mm-dd> in the local calendar', () => {
  assert.equal(defaultPasskeyName(new Date(2026, 10, 25)), 'sez-26-11-25')
  assert.equal(defaultPasskeyName(new Date(2026, 0, 5)), 'sez-26-01-05')
  assert.equal(defaultPasskeyName(new Date(1999, 8, 9)), 'sez-99-09-09')
})

test('passkeyDisplayName keeps a chosen alias and replaces empty or guest', () => {
  const now = new Date(2026, 10, 25)
  assert.equal(passkeyDisplayName('ada', now), 'ada')
  assert.equal(passkeyDisplayName('  ada  ', now), 'ada')
  assert.equal(passkeyDisplayName('', now), 'sez-26-11-25')
  assert.equal(passkeyDisplayName('   ', now), 'sez-26-11-25')
  assert.equal(passkeyDisplayName(null, now), 'sez-26-11-25')
  assert.equal(passkeyDisplayName(undefined, now), 'sez-26-11-25')
  assert.equal(passkeyDisplayName('guest', now), 'sez-26-11-25')
  assert.equal(passkeyDisplayName('Guest', now), 'Guest')
})
