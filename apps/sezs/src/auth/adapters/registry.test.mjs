import assert from 'node:assert/strict'
import { test } from 'node:test'

import { adapterById, listWalletAdapters, registerWalletAdapter } from './registry.ts'

test('sign-in adapter registry lists built-in wallets in order and has no Keplr', () => {
  const prev = process.env.NEXT_PUBLIC_SEZS_HIDE_EMAIL
  delete process.env.NEXT_PUBLIC_SEZS_HIDE_EMAIL
  try {
    const ids = listWalletAdapters().map((a) => a.id)
    assert.deepEqual(
      ids.filter((id) => ['zafu', 'zafu-passkey', 'ephemeral', 'email', 'keplr'].includes(id)),
      ['zafu', 'zafu-passkey', 'ephemeral', 'email'],
    )
    assert.equal(adapterById('keplr'), undefined)
    assert.equal(adapterById('zafu')?.title, 'Zafu')
    assert.equal(adapterById('zafu')?.walletKind, 'zid')
    assert.equal(adapterById('zafu-passkey')?.walletKind, 'passkey')
    assert.equal(adapterById('ephemeral')?.walletKind, 'browser')
    assert.equal(adapterById('email')?.walletKind, 'email')

    process.env.NEXT_PUBLIC_SEZS_HIDE_EMAIL = '1'
    assert.equal(adapterById('email'), undefined)
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SEZS_HIDE_EMAIL
    else process.env.NEXT_PUBLIC_SEZS_HIDE_EMAIL = prev
  }
})

test('registerWalletAdapter plugs a new option into the list', () => {
  registerWalletAdapter({
    id: 'lab-wallet',
    title: 'Lab wallet',
    logo: '/wallets/zafu.svg',
    blurb: 'Lab',
    docs: 'https://example.invalid',
    walletKind: 'zid',
    facts: [],
  })
  assert.equal(adapterById('lab-wallet')?.title, 'Lab wallet')
  assert.ok(listWalletAdapters().some((a) => a.id === 'lab-wallet'))
})

test('built-in adapters carry info facts and Zafu is a ZID login', () => {
  const zafu = adapterById('zafu')
  const passkey = adapterById('zafu-passkey')
  const browser = adapterById('ephemeral')
  assert.equal(zafu?.blurb || '', '')
  assert.ok(zafu?.facts.some((f) => f.label === 'Identity' && /ed25519 ZID/.test(f.value)))
  assert.ok(passkey?.facts.some((f) => /WebAuthn passkey/.test(f.value)))
  assert.ok(browser?.facts.some((f) => /PRF/.test(f.value) || f.label === 'PRF'))
  assert.equal(zafu?.official, 'https://zafu.pro')
  assert.ok(!JSON.stringify(listWalletAdapters()).includes('Keplr'))
})

test('listWalletAdapters hides the This browser option when PRF is known to be absent', () => {
  const ids = listWalletAdapters({ prf: 'no' }).map((a) => a.id)
  assert.ok(!ids.includes('ephemeral'))
  assert.ok(ids.includes('zafu-passkey'))
  assert.ok(ids.includes('zafu'))
  const shown = listWalletAdapters({ prf: 'yes' }).map((a) => a.id)
  assert.ok(shown.includes('ephemeral'))
  const unknown = listWalletAdapters({ prf: 'unknown' }).map((a) => a.id)
  assert.ok(unknown.includes('ephemeral'))
  assert.equal(adapterById('ephemeral')?.requiresPrf, true)
})

