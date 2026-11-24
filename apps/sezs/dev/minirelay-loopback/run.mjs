/**
 * Build (if needed) and spawn the loopback minirelay on 127.0.0.1:3053.
 * Never starts a non-loopback bind. See apps/sezs/docs/BACKEND-ROLE.md.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertLocalRelay, DEFAULT_LAB_RELAY } from '../../src/zafu/relay-guard.mjs'

const DIR = dirname(fileURLToPath(import.meta.url))
const APP = join(DIR, '..', '..')
export const RELAY_PORT = Number(process.env.SEZS_MINIRELAY_PORT || 3053)
export const RELAY_URL = process.env.SEZS_ZIRC_RELAY || `http://127.0.0.1:${RELAY_PORT}`

export const assertLabRelay = () => assertLocalRelay(RELAY_URL, 'SEZS lab minirelay')

const binary = () => {
  const release = join(DIR, 'target/release/sezs-minirelay-loopback')
  const debug = join(DIR, 'target/debug/sezs-minirelay-loopback')
  if (existsSync(release)) return release
  if (existsSync(debug)) return debug
  return null
}

export const buildLoopbackRelay = () => {
  const cargo = process.env.CARGO || 'cargo'
  const r = spawnSync(cargo, ['build', '--release', '--manifest-path', join(DIR, 'Cargo.toml')], {
    cwd: DIR,
    stdio: 'inherit',
    env: { ...process.env },
  })
  if (r.status !== 0) throw new Error('sezs-minirelay-loopback: cargo build failed')
  return binary()
}

export const spawnLoopbackRelay = ({ retentionSeconds, sweepMs, dbPath, extraEnv, port } = {}) => {
  const listen = Number(port || extraEnv?.MINIRELAY_PORT || extraEnv?.SEZS_MINIRELAY_PORT || RELAY_PORT)
  const url = `http://127.0.0.1:${listen}`
  assertLocalRelay(url, 'SEZS lab minirelay')
  let bin = binary()
  if (!bin) bin = buildLoopbackRelay()
  if (!bin) throw new Error('sezs-minirelay-loopback: binary missing after build')
  const dir = process.env.SEZS_SPLASH_DIR || join(APP, '.splash')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const db = dbPath || join(dir, 'minirelay.sqlite')
  const env = {
    ...process.env,
    MINIRELAY_BIND: '127.0.0.1',
    MINIRELAY_PORT: String(listen),
    MINIRELAY_DB: db,
    MINIRELAY_RETENTION_SECONDS: String(retentionSeconds ?? process.env.MINIRELAY_RETENTION_SECONDS ?? 3600),
    MINIRELAY_SWEEP_INTERVAL_MS: String(sweepMs ?? process.env.MINIRELAY_SWEEP_INTERVAL_MS ?? 60_000),
    MINIRELAY_ALLOW_ORIGIN: 'http://127.0.0.1:3051',
    SEZS_ZIRC_RELAY: url,
    ...extraEnv,
    MINIRELAY_PORT: String(listen),
    MINIRELAY_BIND: '127.0.0.1',
  }
  const child = spawn(bin, [], { cwd: DIR, env, stdio: env.SEZS_RELAY_STDIO === 'inherit' ? 'inherit' : 'pipe' })
  return { child, url, port: listen, db }
}

export const waitRelay = async (url = RELAY_URL, { tries = 50, ms = 100 } = {}) => {
  assertLocalRelay(url, 'waitRelay')
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url.replace(/\/$/, '') + '/health')
      if (r.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, ms))
  }
  throw new Error('sezs-minirelay-loopback: health check timed out')
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const { child } = spawnLoopbackRelay()
  child.stdout?.pipe(process.stdout)
  child.stderr?.pipe(process.stderr)
  child.on('exit', (c) => process.exit(c ?? 0))
  const stop = () => child.kill('SIGTERM')
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  waitRelay().then(() => console.log('sezs-minirelay-loopback: up on', RELAY_URL)).catch((e) => {
    console.error(e)
    stop()
    process.exit(1)
  })
}
