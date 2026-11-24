import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'

import {
  sha256ForTest,
  ticketLeaf,
  doorNullifier,
  toHex,
  fromHex,
  makeTree,
  poseidon2,
  fromU64,
  toBytes,
  TREE_DEPTH,
} from './poseidon.mjs'
import {
  newSecret,
  commitmentOf,
  nullifierOf,
  memoOf,
  parseMemo,
  qrPayload,
  parseQr,
  ticketRecord,
  EVENT_ID,
  DEFAULT_SKU,
} from './commitment.mjs'
import { buildZip321, parseZip321 } from './zip321.mjs'
import { zecUriLabOk, penumbraDestOk } from '../pay/network.ts'

test('sha256 matches node crypto', () => {
  for (const s of ['', 'abc', 'sezs-poseidon-pallas-t3-v1']) {
    assert.equal(toHex(sha256ForTest(Buffer.from(s))), createHash('sha256').update(s).digest('hex'))
  }
})

// These C / N / root hex values are from the legacy SEZS-custom Poseidon
// (SHA256("sezs-poseidon-pallas-t3-v1") constants in poseidon.mjs). They are
// known stale versus the production P128Pow5T3 suite used by
// circuits/sezs-ticket-v2 and the Node wasm. Do not rewrite them to match
// the circuit; keep them as a lock on the legacy JS implementation.
test('fixed secret produces a 32-byte leaf and a different nullifier', () => {
  const secret = new Uint8Array(32)
  secret[0] = 1
  const C = ticketLeaf(secret, 'ga', 'speakez-sessions')
  const N = doorNullifier(secret, 'speakez-sessions')
  assert.equal(toHex(C), '5d0a9000ba970e7adb34477c2e327dc8d769aeb03abed95d94934299e0083a3a')
  assert.equal(toHex(N), '7a9f989d4d0de0a56cbd87c31f1ee102fbae6e21da14dbddfd5b2123bdc2181f')
  assert.notEqual(toHex(C), toHex(N))
  // sku-before-event_id: swapping the string arguments must not match the circuit leaf
  const wrong = ticketLeaf(secret, 'speakez-sessions', 'ga')
  assert.notEqual(toHex(wrong), toHex(C))
})

test('tree empty root is stable; append is incremental', () => {
  const t = makeTree()
  assert.equal(t.depth, TREE_DEPTH)
  assert.equal(toHex(t.rootBytes()), 'ae1b19a7651f5f06095c21e6c29e9b35926903ec973dec784e31fa43b2182b3d')
  const secret = new Uint8Array(32)
  secret[0] = 1
  const idx = t.append(ticketLeaf(secret, 'ga', 'speakez-sessions'))
  assert.equal(idx, 0)
  assert.equal(toHex(t.rootBytes()), 'b154c58a77abc1ce48b5b74f870fae6c3972863e096a59889b6c519ff4be7e34')
})

test('newSecret masks the top two bits and is 32 bytes', () => {
  const fixed = newSecret(() => {
    const b = new Uint8Array(32)
    b.fill(0xff)
    return b
  })
  assert.equal(fixed.length, 32)
  assert.equal(fixed[31], 0x3f)
})

test('memo and QR bind C without putting the secret in the memo', () => {
  const secret = newSecret(() => {
    const b = new Uint8Array(32)
    b[0] = 1
    return b
  })
  const C = commitmentOf(secret, DEFAULT_SKU, EVENT_ID)
  const memo = memoOf(C)
  assert.match(memo, /^sezs1:[0-9a-f]{64}$/)
  assert.equal(toHex(parseMemo(memo)), toHex(C))
  assert.ok(!memo.includes(toHex(secret)))
  const qr = qrPayload(secret, DEFAULT_SKU, EVENT_ID)
  const parsed = parseQr(qr)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.eventId, EVENT_ID)
  assert.equal(parsed.sku, DEFAULT_SKU)
  assert.equal(toHex(parsed.secret), toHex(secret))
  assert.equal(toHex(parsed.commitment), toHex(C))
  assert.equal(toHex(parsed.nullifier), toHex(nullifierOf(secret, EVENT_ID)))
  assert.equal(parseQr('zcash:utest1abc').ok, false)
})

test('ZIP-321 carries the memo; lab URIs are accepted, mainnet is not', () => {
  const uri = buildZip321({
    address: 'uregtest1labonlydonotsendrealfunds00000000000000000000000000',
    memo: 'sezs1:5d0a9000ba970e7adb34477c2e327dc8d769aeb03abed95d94934299e0083a3a',
    message: 'Speakez Sessions',
  })
  assert.ok(zecUriLabOk(uri))
  const p = parseZip321(uri)
  assert.equal(p.memo.startsWith('sezs1:'), true)
  assert.equal(zecUriLabOk('zcash:u1thisisnotalab'), false)
  assert.equal(zecUriLabOk('zcash://uregtest1abc'), false)
  assert.equal(penumbraDestOk('penumbra1mainnet'), false)
  assert.equal(penumbraDestOk('penumbratest1labonlydonotsendrealfunds00000000000000'), true)
})

test('ticket record keeps the secret off the memo line', () => {
  const secret = new Uint8Array(32)
  secret[0] = 2
  const rec = ticketRecord({ secret, rail: 'zec' })
  assert.equal(rec.eventId, EVENT_ID)
  assert.ok(rec.qr.startsWith('sezs3') || rec.qr.startsWith('sezs1://ticket?'))
  assert.ok(!rec.memo.includes(rec.secretHex))
})
