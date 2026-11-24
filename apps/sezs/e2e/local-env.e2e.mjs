/**
 * End-to-end checks against an ict-rs SEZS session when one is already up.
 * Does not kill reused services. Refuses public relays.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { assertLocalRelay } from '../src/zafu/relay-guard.mjs'
import { getConnectedAddresses, randomizeConnectedAddresses } from '../src/frost/zafu-addresses.mjs'
import { encodeBech32, looksUmBech32 } from '../src/pay/bech32.mjs'
import { chainsReady, loadSession } from '../dev/splash/chain-payouts.mjs'
import { refusalFor } from '../src/auth/roles.mjs'

const sessionFile = () => {
  if (process.env.SEZS_SESSION_ROOT && existsSync(`${process.env.SEZS_SESSION_ROOT}/session.json`)) {
    return `${process.env.SEZS_SESSION_ROOT}/session.json`
  }
  if (existsSync('/tmp/sezs-session/current/session.json')) return '/tmp/sezs-session/current/session.json'
  return null
}

describe('ict-rs local session e2e', () => {
  it('reads session.json (ports only) and refuses public relays', () => {
    const file = sessionFile()
    if (!file) {
      assert.equal(chainsReady(null).ok, false)
      return
    }
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const blob = JSON.stringify(raw)
    assert.doesNotMatch(blob, /mnemonic|private[_-]?key|seed|password|\.env/i)
    assert.doesNotMatch(blob, /relay\.zafu\.pro|penumbra\.zone|morocco-1/)
    if (raw.backends?.bouncer) assertLocalRelay(raw.backends.bouncer, 'session bouncer')
  })

  it('autofills and randomizes addresses from a connected Zafu hook', async () => {
    const um1 = encodeBech32('penumbra', new Uint8Array(32).fill(4), 'bech32m')
    const um2 = encodeBech32('penumbra', new Uint8Array(32).fill(5), 'bech32m')
    globalThis.__SEZS_ZAFU__ = {
      getAddresses: async () => ({ zec: 'uregtest1labonlydonotsendrealfunds00000000000000000000000000', um: um1 }),
      randomize: async () => ({ zec: 'uregtest1seconddiversifiedaddress000000000000000000000000000', um: um2 }),
    }
    const first = await getConnectedAddresses()
    assert.equal(first.ok, true)
    assert.equal(looksUmBech32(first.um), true)
    const next = await randomizeConnectedAddresses()
    assert.notEqual(next.um, first.um)
    delete globalThis.__SEZS_ZAFU__
  })

  it('refuses an usher and a non-member on payroll', () => {
    assert.equal(refusalFor('usher').error, 'usher_forbidden')
    assert.equal(refusalFor(null).error, 'not_member')
  })

  it('reports whether local ZEC and UM chains are ready for payouts and ticket watches', () => {
    const ready = chainsReady(loadSession())
    if (!ready.ok) {
      assert.equal(ready.error === 'chain_unavailable' || ready.error === 'no_session', true)
      return
    }
    assert.ok(ready.zec || ready.um)
  })
})
