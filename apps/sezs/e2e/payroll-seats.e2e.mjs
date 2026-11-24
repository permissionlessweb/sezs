/**
 * E2E: three separate payroll-seat.mjs processes over an isolated loopback
 * minirelay, bouncer, and frostd-lite. Never talks to a public relay, and
 * does not share the long-running :3053/:3055/:3056 lab processes.
 * Does not print keys.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, rmSync, readFileSync, existsSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { randomBytes } from 'node:crypto'
import { startFrostdLite } from '../dev/frost-relay/frostd-lite.mjs'
import { startBouncer } from '../dev/bouncer/serve.mjs'
import { spawnLoopbackRelay, waitRelay } from '../dev/minirelay-loopback/run.mjs'
import { assertLocalRelay } from '../src/zafu/relay-guard.mjs'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const seatBin = join(APP, 'src/frost/payroll-seat.mjs')

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

const waitHttp = async (url, tries = 200) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (r.ok || r.status < 500) return
    } catch {}
    await delay(100)
  }
  throw new Error(`timeout waiting for ${url}`)
}

const runCeremony = async ({ bouncerUrl, dir, attempt }) => {
  const digest = randomBytes(32).toString('hex')
  const rendezvous = join(dir, `rendezvous-${attempt}`)
  mkdirSync(rendezvous, { recursive: true, mode: 0o700 })
  const kids = []
  const spawnSeat = (seat, extra = []) => {
    const child = spawn(process.execPath, [
      seatBin,
      '--seat', seat,
      '--host', bouncerUrl,
      '--rendezvous', rendezvous,
      ...extra,
    ], {
      cwd: APP,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (d) => {
      try { appendFileSync(join(rendezvous, `seat-${seat}.out`), d) } catch {}
    })
    child.stderr.on('data', (d) => {
      try { appendFileSync(join(rendezvous, `seat-${seat}.err`), d) } catch {}
    })
    kids.push(child)
    return child
  }
  spawnSeat('desk', ['--digest', digest, '--coord'])
  spawnSeat('steward')
  spawnSeat('spare')

  const resultPath = join(rendezvous, 'result.json')
  const errorPath = join(rendezvous, 'error.txt')
  let result = null
  for (let i = 0; i < 2400; i++) {
    if (existsSync(resultPath)) {
      try { result = JSON.parse(readFileSync(resultPath, 'utf8')) } catch { result = null }
      if (result) break
    }
    await delay(75)
  }
  for (const k of kids) {
    try { k.kill('SIGTERM') } catch {}
  }
  for (const k of kids) {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 1000)
      k.once('exit', () => { clearTimeout(t); resolve() })
    })
  }
  if (!result) {
    const err = existsSync(errorPath) ? readFileSync(errorPath, 'utf8').trim() : ''
    const outs = ['desk', 'steward', 'spare'].map((s) => {
      const f = join(rendezvous, `seat-${s}.err`)
      const o = join(rendezvous, `seat-${s}.out`)
      const et = existsSync(f) ? readFileSync(f, 'utf8').trim() : ''
      const ot = existsSync(o) ? readFileSync(o, 'utf8').trim() : ''
      return `${s}: out=${ot || 'empty'} err=${et || 'empty'}`
    })
    const error = new Error(`no ceremony result (attempt ${attempt}). ${err} ${outs.join(' | ')}`)
    error.rendezvous = rendezvous
    throw error
  }
  return result
}

describe('payroll seats as three processes', () => {
  let frostSrv, bouncerSrv, relay, dir, bouncerUrl

  before(async () => {
    dir = join('/tmp', `sezs-seats-e2e-${process.pid}`)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const frostPort = await freePort()
    const bouncerPort = await freePort()
    const relayPort = await freePort()
    relay = spawnLoopbackRelay({
      port: relayPort,
      dbPath: join(dir, 'minirelay.sqlite'),
      extraEnv: {
        SEZS_MINIRELAY_PORT: String(relayPort),
        SEZS_ZIRC_RELAY: `http://127.0.0.1:${relayPort}`,
        SEZS_RELAY_STDIO: 'ignore',
      },
    })
    await waitRelay(relay.url, { tries: 200, ms: 100 })
    frostSrv = await startFrostdLite({ port: frostPort })
    bouncerSrv = await startBouncer({
      port: bouncerPort,
      relayUrl: relay.url,
      frostUrl: `http://127.0.0.1:${frostPort}`,
    })
    bouncerUrl = `http://127.0.0.1:${bouncerPort}`
    assertLocalRelay(bouncerUrl, 'payroll seats e2e')
    assertLocalRelay(relay.url, 'payroll seats minirelay')
    await waitHttp(`http://127.0.0.1:${frostPort}/health`)
    await waitHttp(`${bouncerUrl}/bouncer/health`)
  })

  after(async () => {
    try { frostSrv?.close() } catch {}
    try { bouncerSrv?.close() } catch {}
    try { relay?.child?.kill('SIGTERM') } catch {}
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  })

  it('signs a payroll digest with three seat processes', async () => {
    let result = null
    let lastErr = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await runCeremony({ bouncerUrl, dir, attempt })
        lastErr = null
        break
      } catch (e) {
        lastErr = e
      }
    }
    if (!result) {
      assert.fail(lastErr?.message || 'no ceremony result')
    }
    assert.equal(result.t, 2)
    assert.equal(result.n, 3)
    assert.equal(result.seats, 'separate-processes')
    assert.equal(result.cipher, 'zafu-frost-relay-cipher')
    assert.match(String(result.signature), /^[0-9a-f]+$/i)
    assert.match(String(result.verifyingKey), /^[0-9a-f]+$/i)
  })
})
