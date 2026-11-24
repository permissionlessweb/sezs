/**
 * E2E: registration keys + 2-of-3 FROST payroll over the local bouncer.
 * Starts isolated loopback services. Never talks to a public relay.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { startFrostdLite } from '../dev/frost-relay/frostd-lite.mjs'
import { startBouncer } from '../dev/bouncer/serve.mjs'
import { assertLocalRelay } from '../src/zafu/relay-guard.mjs'
import { runPayrollCeremony } from '../src/frost/payroll-ceremony.mjs'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const zec = 'u1testzecaddrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const um = 'penumbra1qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qursceg62w'

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

const waitHttp = async (url, tries = 80) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (r.ok || r.status < 500) return
    } catch {}
    await delay(100)
  }
  throw new Error(`timeout waiting for ${url}`)
}

const json = async (url, { method = 'GET', body, as, splash = false } = {}) => {
  const headers = { 'content-type': 'application/json' }
  if (as) headers.cookie = `sezs_splash=${as}`
  if (splash) headers['x-sezs-splash'] = '1'
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  return { status: res.status, data }
}

describe('payroll + FROST over bouncer', () => {
  let frostSrv, bouncerSrv, splashProc, dir, splashBase, bouncerUrl, frostPort, bouncerPort

  before(async () => {
    dir = join(tmpdir(), `sezs-pay-e2e-${process.pid}`)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    frostPort = await freePort()
    bouncerPort = await freePort()
    const splashPort = await freePort()
    frostSrv = await startFrostdLite({ port: frostPort })
    bouncerSrv = await startBouncer({
      port: bouncerPort,
      relayUrl: 'http://127.0.0.1:3053',
      frostUrl: `http://127.0.0.1:${frostPort}`,
    })
    bouncerUrl = `http://127.0.0.1:${bouncerPort}`
    assertLocalRelay(bouncerUrl, 'payroll e2e bouncer')
    splashBase = `http://127.0.0.1:${splashPort}`
    splashProc = spawn(process.execPath, [join(APP, 'dev/splash/server.mjs')], {
      cwd: APP,
      env: {
        ...process.env,
        SEZS_SPLASH: '1',
        NODE_ENV: 'test',
        SEZS_SPLASH_PORT: String(splashPort),
        SEZS_SPLASH_DIR: dir,
        SEZS_SPLASH_APP: 'http://127.0.0.1:3051',
        SEZS_FROST_BOUNCER: bouncerUrl,
      },
      stdio: 'ignore',
    })
    await waitHttp(`${splashBase}/sezs/session/me`)
    const seeded = await json(`${splashBase}/__splash/api/scenario`, {
      method: 'POST',
      splash: true,
      body: { id: 'clean' },
    })
    assert.equal(seeded.data.ok, true)
  })

  after(() => {
    try { splashProc?.kill('SIGTERM') } catch {}
    try { bouncerSrv?.close() } catch {}
    try { frostSrv?.close() } catch {}
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  })

  it('refuses an usher and a non-member on payroll, and allows a registered event admin', async () => {
    const nobody = await json(`${splashBase}/sezs/payroll/invites`, {
      method: 'POST',
      body: { role: 'artist', label: 'nope' },
    })
    assert.equal(nobody.status, 403)
    assert.equal(nobody.data.error, 'not_member')
    const usher = await json(`${splashBase}/sezs/payroll/invites`, {
      method: 'POST',
      as: 'usher-1',
      body: { role: 'artist', label: 'nope' },
    })
    assert.equal(usher.status, 403)
    assert.equal(usher.data.error, 'usher_forbidden')
    const guest = await json(`${splashBase}/sezs/payroll/invites`, {
      method: 'POST',
      as: 'guest-keplr',
      body: { role: 'artist', label: 'nope' },
    })
    assert.equal(guest.status, 403)
    assert.equal(guest.data.error, 'not_coordinator')
    const admin = await json(`${splashBase}/sezs/payroll/state`, { as: 'admin-1' })
    assert.equal(admin.status, 200)
    assert.equal(admin.data.ok !== false, true)
  })

  it('generates a key, registers, and refuses reuse and a wrong key', async () => {
    const made = await json(`${splashBase}/sezs/payroll/invites`, {
      method: 'POST',
      as: 'coord-1',
      body: { role: 'artist', label: 'Asha' },
    })
    assert.equal(made.data.ok, true)
    const key = made.data.key
    assert.match(key, /^sezsreg_[0-9a-f]{64}$/)
    assert.match(made.data.share.local, /\/register\?c=/)
    assert.match(made.data.share.public, /permissionless\.money\/sez\/register\?c=/)

    const ok = await json(`${splashBase}/sezs/payroll/register`, {
      method: 'POST',
      body: { registrationKey: key, displayName: 'Asha', zec, um },
    })
    assert.equal(ok.data.ok, true)
    assert.equal(ok.data.participant.status, 'registered')
    assert.ok(ok.data.participant.zec.includes('…'))

    const reuse = await json(`${splashBase}/sezs/payroll/register`, {
      method: 'POST',
      body: { registrationKey: key, displayName: 'Other', zec, um },
    })
    assert.equal(reuse.data.ok, false)
    assert.equal(reuse.data.error, 'key_consumed')

    const wrong = await json(`${splashBase}/sezs/payroll/register`, {
      method: 'POST',
      body: {
        registrationKey: 'sezsreg_' + 'ab'.repeat(32),
        displayName: 'No',
        zec,
        um,
      },
    })
    assert.equal(wrong.data.ok, false)
    assert.equal(wrong.data.error, 'unknown_key')
  })

  it('proposes a batch, runs 2-of-3 FROST with the Zafu cipher over the bouncer, and executes on-chain when the local chains are up', async () => {
    const amounts = await json(`${splashBase}/sezs/payroll/amounts`, {
      method: 'POST',
      as: 'coord-1',
      body: { roleAmounts: { artist: '15', vendor: '8', staff: '10', usher: '6' } },
    })
    assert.equal(amounts.data.ok, true)
    const row = amounts.data.participants[0]
    await json(`${splashBase}/sezs/payroll/amounts`, {
      method: 'POST',
      as: 'coord-1',
      body: { amounts: [{ id: row.id, amount: '15' }] },
    })
    const proposed = await json(`${splashBase}/sezs/payroll/batches`, {
      method: 'POST',
      as: 'coord-1',
      body: { note: 'session one' },
    })
    assert.equal(proposed.data.ok, true)
    assert.equal(proposed.data.batch.status, 'proposed')
    const digest = proposed.data.batch.digest

    // Direct ceremony through the bouncer (same path the splash handler uses).
    const frost = await json(`${splashBase}/sezs/payroll/batches/frost`, {
      method: 'POST',
      as: 'coord-1',
      body: { batchId: proposed.data.batch.id },
    })
    assert.equal(frost.data.ok, true, frost.data.error || 'frost')
    assert.equal(frost.data.batch.status, 'signed')
    assert.ok(frost.data.sessionId)
    assert.equal(frost.data.via, bouncerUrl)

    // Sanity: the digest really verifies under a second independent run would be expensive;
    // confirm the helper is real by signing the same digest directly too (fresh DKG).
    const independent = await runPayrollCeremony({ host: bouncerUrl, digestHex: digest })
    assert.ok(independent.signature)
    assert.ok(independent.sessionId)
    assert.notEqual(independent.sessionId, frost.data.sessionId)
    assert.equal(independent.cipher, 'zafu-frost-relay-cipher')

    const executed = await json(`${splashBase}/sezs/payroll/batches/execute`, {
      method: 'POST',
      as: 'coord-1',
      body: { batchId: proposed.data.batch.id },
    })
    if (executed.data.ok) {
      assert.equal(executed.data.batch.status, 'executed')
      assert.equal(executed.data.batch.execution.kind, 'local-chain')
      assert.ok(executed.data.batch.execution.frostGate)
      const state = await json(`${splashBase}/sezs/payroll/state`, { as: 'coord-1' })
      assert.equal(state.data.participants[0].status, 'paid')
    } else {
      assert.equal(executed.data.error, 'chain_unavailable')
    }
  })
})
