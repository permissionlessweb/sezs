#!/usr/bin/env node
/**
 * Reseed walkthrough event metadata: ticket tier, raffle prizes, extra
 * stage sets, vendors, NIP-52 tags (inline), and a hashed loopback URI.
 * Loopback only. Never prints key material.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '../../apps/sezs')
const SESSION = process.env.SEZS_SESSION_ROOT || '/tmp/sezs-session-walkthrough'
const LAB = process.env.SEZS_LOCALTERP_HOME || join(SESSION, 'terp')
const TERPD = process.env.SEZS_V2_TERPD || `process.env.SEZS_V2_TERPD || process.env.TERPD || 'terpd'`
const CHAIN = process.env.SEZS_CHAIN_ID || 'sezs-local-1'
const NODE = 'tcp://127.0.0.1:26657'
const BOOT = JSON.parse(readFileSync(join(SESSION, 'terp-boot.json'), 'utf8'))
const CONTRACT = BOOT.contract
const META_PATH = join(APP, 'public/event-metadata.nip52.json')
const META = readFileSync(META_PATH)
const HASH = createHash('sha256').update(META).digest('hex')
const URI = 'http://127.0.0.1:3051/event-metadata.nip52.json'
const LOG = join(SESSION, 'logs/seed-event-metadata.log')

const flags = (from) => [
  '--from', from, '--keyring-backend', 'test', '--home', LAB, '--node', NODE,
  '--chain-id', CHAIN, '--gas', 'auto', '--gas-adjustment', '1.6', '-y', '-o', 'json', '-b', 'sync',
]

const run = (args) => {
  const r = spawnSync(TERPD, args, { encoding: 'utf8', maxBuffer: 8_000_000 })
  writeFileSync(LOG, `\n$ terpd ${args.filter((a) => !/mnemonic|priv/i.test(String(a))).join(' ')}\nexit=${r.status}\n`, { flag: 'a' })
  if (r.stdout && !/priv_key|mnemonic|secret/i.test(r.stdout.slice(0, 200))) {
    writeFileSync(LOG, r.stdout.slice(0, 3000) + '\n', { flag: 'a' })
  }
  if (r.stderr) writeFileSync(LOG, r.stderr.slice(0, 1500) + '\n', { flag: 'a' })
  return r
}

const waitTx = (hash) => {
  for (let i = 0; i < 40; i++) {
    const q = run(['q', 'tx', hash, '--node', NODE, '-o', 'json'])
    if (q.status === 0) return JSON.parse(q.stdout)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400)
  }
  throw new Error(`tx not found ${hash}`)
}

const exec = (msg, from = 'curator') => {
  const r = run(['tx', 'wasm', 'execute', CONTRACT, JSON.stringify(msg), ...flags(from)])
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').slice(0, 400)
    throw new Error(`execute failed: ${err}`)
  }
  const j = JSON.parse(r.stdout)
  if (j.code && Number(j.code) !== 0) throw new Error(`tx code ${j.code}: ${j.raw_log || ''}`.slice(0, 300))
  const hash = j.txhash || j.tx_hash
  const mined = waitTx(hash)
  if (mined.code && Number(mined.code) !== 0) throw new Error(`mined code ${mined.code}: ${mined.raw_log || ''}`.slice(0, 300))
  return hash
}

const ns = (sec) => String(BigInt(sec) * 1_000_000_000n)
const log = (s) => { process.stdout.write(`[seed-meta] ${s}\n`); writeFileSync(LOG, `[seed-meta] ${s}\n`, { flag: 'a' }) }

if (!CONTRACT) throw new Error('no contract in terp-boot.json')
log(`contract present; metadata sha256=${HASH}`)

const doc = JSON.parse(META.toString('utf8'))
const encodedTags = ['music', 'night', ...doc.tags.map((t) => JSON.stringify(t))]

exec({
  upsert_tier: {
    tier: {
      id: 'ga',
      label: 'Admission',
      list_cents: 4000,
      discounts_bps: [['zec', 5000], ['penumbra', 5000]],
      supply: 200,
      sold: 0,
      guest_weight: 1,
      rails: ['zec', 'penumbra'],
    },
  },
})
log('tier ok')

for (const p of [
  { id: 'rf-01', title: 'A print from the floor wall', note: 'One paid ticket is one entry.', entries: 0, status: 'open' },
  { id: 'rf-02', title: 'A reserved late-room seat', note: 'Same entry pool. One paid ticket is one entry.', entries: 0, status: 'open' },
  { id: 'rf-03', title: 'A guest-list return', note: 'A configured randomness contract will pick the winning entry when it is live on Terp.', entries: 0, status: 'open' },
]) {
  exec({ register_raffle_prize: { prize: p } })
}
log('raffles ok')

const slot = (id, index, role, handle, start, duration, lane) =>
  exec({
    upsert_lineup_slot: {
      slot: { id, index, role, handle, start: ns(start), duration_min: duration, lane },
    },
  })

slot('slot-vendor-01', 9, 'vendor', 'Night Kitchen', 1800144000, 420, 'alcove')
slot('slot-vendor-02', 12, 'vendor', 'Print Cart', 1800144000, 420, 'alcove')
slot('slot-yard-01', 13, 'dj', 'Yard opener', 1800147600, 100, 'yard')
slot('slot-yard-02', 14, 'dj', 'Yard mid', 1800153600, 140, 'yard')
slot('slot-yard-03', 15, 'dj', 'Yard late', 1800162000, 100, 'yard')
log('lineup extras ok')

exec({
  set_nip52: {
    body: {
      kind: 31923,
      d_tag: 'speakez-sessions',
      title: 'Speakez Sessions',
      summary: 'Music until late. Ink, food, a quiet alcove, work on the wall.',
      content: 'Music until late. Ink, food, a quiet alcove, work on the wall.',
      start: ns(1800144000),
      end: ns(1800169200),
      timezone: 'America/New_York',
      location: '',
      tags: encodedTags,
    },
  },
})
log('set_nip52 inline tags ok')

exec({ set_metadata: { uri: URI, content_hash: HASH } })
log(`set_metadata uri ok (hash stored)`)
console.log(JSON.stringify({ ok: true, uri: URI, sha256: HASH, contractSet: true }))
