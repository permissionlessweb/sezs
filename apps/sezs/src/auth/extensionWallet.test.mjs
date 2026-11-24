import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  EXTENSION_READY_EVENTS,
  ZAFU_TERP_CHAIN_ID,
  extensionPresent,
  requestChainId,
  waitForExtension,
} from './extensionWallet.ts'

const ADDR = 'terp1xjysxqa0l2flh0kxnps4r3peljep8872qwr3u6'

const stub = (readyState = 'complete') => {
  const listeners = new Map()
  const win = {
    document: { readyState },
    addEventListener(type, fn) {
      const list = listeners.get(type) || []
      list.push(fn)
      listeners.set(type, list)
    },
    removeEventListener(type, fn) {
      listeners.set(
        type,
        (listeners.get(type) || []).filter((h) => h !== fn),
      )
    },
    dispatchEvent(ev) {
      for (const h of listeners.get(ev.type) || []) h()
      return true
    },
  }
  return { win, listeners }
}

const provider = () => ({
  enable: async () => {},
  getKey: async () => ({ bech32Address: ADDR, pubKey: new Uint8Array([1, 2, 3]) }),
})

test('ready events match the injected Zafu provider and do not mention Keplr', () => {
  assert.deepEqual([...EXTENSION_READY_EVENTS.zafu], ['zafu_keystorechange'])
  assert.equal('keplr' in EXTENSION_READY_EVENTS, false)
})

test('Zafu request chain id is terp-1 when the app chain is not already terp-*', () => {
  assert.equal(ZAFU_TERP_CHAIN_ID, 'terp-1')
  assert.equal(requestChainId('zafu'), 'terp-1')
})

test('extensionPresent is false until enable and getKey exist', () => {
  const { win } = stub()
  assert.equal(extensionPresent('zafu', win), false)
  win.zafu = { enable: async () => {} }
  assert.equal(extensionPresent('zafu', win), false)
  win.zafu = provider()
  assert.equal(extensionPresent('zafu', win), true)
})

test('waitForExtension resolves immediately when the provider is already present', async () => {
  const { win } = stub()
  win.zafu = provider()
  assert.equal(await waitForExtension('zafu', { timeoutMs: 1000 }, win), true)
})

test('waitForExtension sees Zafu via zafu_keystorechange without a delay', async () => {
  const { win } = stub()
  const pending = waitForExtension('zafu', { timeoutMs: 1000, pollMs: 1000, clock: { sleep() {} } }, win)
  win.zafu = provider()
  win.dispatchEvent({ type: 'zafu_keystorechange' })
  assert.equal(await pending, true)
})

test('waitForExtension is false after the timeout when nothing injects, using an injected clock', async () => {
  const { win } = stub()
  const later = []
  const clock = {
    sleep: (ms, cb) => later.push({ ms, cb }),
  }
  const pending = waitForExtension('zafu', { timeoutMs: 80, pollMs: 20, clock }, win)
  const timeout = later.find((j) => j.ms === 80)
  assert.ok(timeout)
  timeout.cb()
  assert.equal(await pending, false)
  assert.equal(extensionPresent('zafu', win), false)
})
