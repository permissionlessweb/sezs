/**
 * pnpm dev:splash → splash mock backend (127.0.0.1:3052) + next dev (127.0.0.1:3051)
 * + loopback Zafu minirelay (127.0.0.1:3053). Plain `pnpm dev` keeps the board off (404).
 * See apps/sezs/docs/BACKEND-ROLE.md.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { existsSync, readFileSync } from 'node:fs'
import { assertLocalRelay } from '../../src/zafu/relay-guard.mjs'
import { spawnLoopbackRelay, waitRelay, RELAY_URL } from '../minirelay-loopback/run.mjs'
import { startFrostdLite } from '../frost-relay/frostd-lite.mjs'
import { startBouncer } from '../bouncer/serve.mjs'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = { ...process.env, SEZS_SPLASH: '1', NEXT_PUBLIC_SEZS_SPLASH: '1' }

// Lab root publisher + usher ConsumeTicket: key NAMES and loopback paths only.
// Never read or print key material. Guest-root publish is signed by the session admin FROST set; coord only broadcasts.
const sessionRoot = env.SEZS_SESSION_ROOT || ''
const bootPath = env.SEZS_V2_BOOT || (sessionRoot ? join(sessionRoot, 'terp-boot.json') : join(APP, 'dev/localterp/boot.json'))
if (existsSync(bootPath)) {
  try {
    const boot = JSON.parse(readFileSync(bootPath, 'utf8'))
    env.SEZS_V2_ROOT_CONTRACT = env.SEZS_V2_ROOT_CONTRACT || boot.contract || ''
    env.SEZS_V2_CHAIN_ID = env.SEZS_V2_CHAIN_ID || boot.chainId || 'sezs-local-1'
    env.SEZS_V2_NODE = env.SEZS_V2_NODE || (boot.rpc ? boot.rpc.replace(/^http/, 'tcp') : 'tcp://127.0.0.1:26657')
    env.SEZS_V2_LCD = env.SEZS_V2_LCD || boot.lcd || 'http://127.0.0.1:1317'
    env.NEXT_PUBLIC_SEZS_RAFFLE_CONTRACT = env.NEXT_PUBLIC_SEZS_RAFFLE_CONTRACT || boot.raffle || ''
    env.NEXT_PUBLIC_SEZS_RANDOMNESS_CONTRACT = env.NEXT_PUBLIC_SEZS_RANDOMNESS_CONTRACT || boot.randomness || ''
  } catch {}
}
env.SEZS_V2_ROOT_SIGNER = env.SEZS_V2_ROOT_SIGNER || 'frost'
env.SEZS_V2_KEYRING_HOME = env.SEZS_V2_KEYRING_HOME || env.SEZS_LOCALTERP_HOME || (sessionRoot ? join(sessionRoot, 'terp') : '')
env.SEZS_V2_KEY_NAME = env.SEZS_V2_KEY_NAME || 'coord'
env.SEZS_V2_USHER_KEY = env.SEZS_V2_USHER_KEY || 'usher'
env.SEZS_V2_TERPD = env.SEZS_V2_TERPD || 'terpd'
env.NEXT_PUBLIC_SEZS_EVENT_CONTRACT = env.NEXT_PUBLIC_SEZS_EVENT_CONTRACT || env.NEXT_PUBLIC_SEZS_CONTRACT || env.SEZS_V2_ROOT_CONTRACT || ''
env.NEXT_PUBLIC_SEZS_CONTRACT = env.NEXT_PUBLIC_SEZS_CONTRACT || env.SEZS_V2_ROOT_CONTRACT || ''
env.NEXT_PUBLIC_SEZS_LCD = env.NEXT_PUBLIC_SEZS_LCD || env.SEZS_V2_LCD || 'http://127.0.0.1:1317'
env.NEXT_PUBLIC_SEZS_CHAIN_ID = env.NEXT_PUBLIC_SEZS_CHAIN_ID || env.SEZS_V2_CHAIN_ID || 'sezs-local-1'
if (env.NODE_ENV === 'production') {
  console.error('splash: refusing to run with NODE_ENV=production')
  process.exit(2)
}
assertLocalRelay(process.env.SEZS_ZIRC_RELAY || RELAY_URL, 'dev:splash relay')
env.SEZS_ZIRC_RELAY = process.env.SEZS_ZIRC_RELAY || RELAY_URL
env.NEXT_PUBLIC_SEZS_ZIRC_RELAY = env.SEZS_ZIRC_RELAY

const kids = []
const stop = () => kids.forEach((k) => k.kill('SIGTERM'))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

const { child: relay } = spawnLoopbackRelay({ extraEnv: { SEZS_RELAY_STDIO: 'inherit' } })
kids.push(relay)
relay.on('exit', (c) => {
  if (c && c !== 0) {
    console.error('splash: minirelay exited', c)
  }
})

try {
  await waitRelay(env.SEZS_ZIRC_RELAY)
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  stop()
  process.exit(1)
}

const frostPort = Number(env.FROSTD_LITE_PORT || 3056)
const bouncerPort = Number(env.BOUNCER_PORT || 3055)
const frostSrv = await startFrostdLite({ port: frostPort })
const bouncerSrv = await startBouncer({
  port: bouncerPort,
  relayUrl: env.SEZS_ZIRC_RELAY || RELAY_URL,
  frostUrl: `http://127.0.0.1:${frostPort}`,
})
const trackServer = (server) => ({
  kill: () => { try { server.close() } catch {} },
  on: () => {},
})
kids.push(trackServer(frostSrv), trackServer(bouncerSrv))
env.SEZS_FROST_BOUNCER = env.SEZS_FROST_BOUNCER || `http://127.0.0.1:${bouncerPort}`
env.NEXT_PUBLIC_SEZS_FROST_BOUNCER = env.SEZS_FROST_BOUNCER
assertLocalRelay(env.SEZS_FROST_BOUNCER, 'dev:splash FROST bouncer')
console.log(`splash: frostd-lite 127.0.0.1:${frostPort} · bouncer ${env.SEZS_FROST_BOUNCER}`)
kids.push(spawn(process.execPath, [join(APP, 'dev/splash/server.mjs')], { cwd: APP, env, stdio: 'inherit' }))
kids.push(spawn(join(APP, 'node_modules/.bin/next'), ['dev', '-p', '3051', '-H', '127.0.0.1'], { cwd: APP, env, stdio: 'inherit' }))
for (const k of kids) k.on('exit', (c) => { stop(); process.exitCode = c ?? 0 })
