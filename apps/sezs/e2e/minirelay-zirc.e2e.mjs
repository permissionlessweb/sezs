/**
 * Local minirelay + zirc e2e. Binds 127.0.0.1 only. Refuses Rotko.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { refuseRelayEndpoint } from '../src/zafu/relay-guard.mjs'
import { spawnLoopbackRelay, waitRelay, buildLoopbackRelay } from '../dev/minirelay-loopback/run.mjs'

test('test/dev refuse the production Rotko relay', () => {
  assert.match(refuseRelayEndpoint('https://zcash.rotko.net/bucket'), /production/)
  assert.equal(refuseRelayEndpoint('http://127.0.0.1:3053'), null)
})

test('loopback minirelay: health, bucket put/get, retention sweep', async (t) => {
  buildLoopbackRelay()
  const dir = mkdtempSync(join(tmpdir(), 'sezs-relay-'))
  const port = Number(process.env.SEZS_MINIRELAY_TEST_PORT || 3153)
  const url = `http://127.0.0.1:${port}`
  const { child } = spawnLoopbackRelay({
    retentionSeconds: 1,
    sweepMs: 150,
    dbPath: join(dir, 'relay.sqlite'),
    extraEnv: { SEZS_MINIRELAY_PORT: String(port), SEZS_ZIRC_RELAY: url, SEZS_RELAY_STDIO: 'ignore' },
  })
  t.after(() => {
    child.kill('SIGTERM')
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* */ }
  })
  await waitRelay(url, { tries: 80, ms: 100 })
  const health = await fetch(url + '/health')
  assert.equal(health.ok, true)
  const coord = { appScope: 'sezs-usher-v1', epoch: 1, shard: 'ab'.repeat(8) }
  const blob = Buffer.from('sealed-lab-blob-not-a-ticket-secret').toString('base64')
  const tag = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')
  const put = await fetch(url + '/bucket', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...coord, entries: [{ tag, blob }] }),
  })
  assert.equal(put.status, 204)
  const got = await fetch(`${url}/bucket?appScope=${coord.appScope}&epoch=${coord.epoch}&shard=${coord.shard}`)
  const body = await got.json()
  assert.ok(Array.isArray(body.entries))
  assert.ok(body.entries.some((e) => e.tag === tag))
  await delay(1400)
  let left = true
  for (let i = 0; i < 20; i++) {
    const again = await (await fetch(`${url}/bucket?appScope=${coord.appScope}&epoch=${coord.epoch}&shard=${coord.shard}`)).json()
    if (!again.entries?.some((e) => e.tag === tag)) {
      left = false
      break
    }
    await delay(200)
  }
  assert.equal(left, false, 'retention should drop the entry')
})

test('zirc room create, invite, send, and sync on the loopback relay', async (t) => {
  let zirc
  try {
    zirc = await import('../src/zafu/zirc-lab.mjs')
    await zirc.loadZafuPackages()
  } catch (e) {
    t.skip(`zafu packages did not load: ${e instanceof Error ? e.message : e}`)
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'sezs-zirc-'))
  const port = Number(process.env.SEZS_ZIRC_TEST_PORT || 3154)
  const url = `http://127.0.0.1:${port}`
  const { child } = spawnLoopbackRelay({
    retentionSeconds: 3600,
    sweepMs: 60_000,
    dbPath: join(dir, 'relay.sqlite'),
    extraEnv: { SEZS_MINIRELAY_PORT: String(port), SEZS_ZIRC_RELAY: url, SEZS_RELAY_STDIO: 'ignore' },
  })
  t.after(() => {
    child.kill('SIGTERM')
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* */ }
  })
  await waitRelay(url, { tries: 80, ms: 100 })
  const a = await zirc.ed25519RoomIdentity('usher-a')
  const b = await zirc.ed25519RoomIdentity('usher-b')
  const opened = await zirc.openLabRoom({ identity: a, endpoint: url })
  const roomB = await zirc.openLabRoom({
    identity: b,
    endpoint: url,
    roomSecret: opened.secret,
    appScope: 'sezs-usher-v1',
    channel: '#ushers',
  })
  await opened.inst.send('doors open at seven')
  const seen = await roomB.inst.sync()
  const texts = (Array.isArray(seen) ? seen : seen?.messages || []).map((m) => m.body || m.text || '')
  assert.ok(
    texts.some((s) => String(s).includes('doors open at seven')) || JSON.stringify(seen).includes('doors open at seven'),
    'peer should read the sealed message; got ' + JSON.stringify(seen).slice(0, 400),
  )
  const invite = opened.invite
  assert.match(String(invite), /^zroom2:/)
  // The invite is a bearer token — do not log it. Confirm parse works.
  const parsed = opened.Room.parseInvite(invite)
  assert.equal(parsed.appScope, 'sezs-usher-v1')
})
