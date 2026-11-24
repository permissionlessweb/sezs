#!/usr/bin/env node
/**
 * Store the v2 manifold, instantiate it, register sezs_consume_v2, SetZkid,
 * fund the service/usher lab keys, write boot.json.
 * Loopback only. Never prints key material.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadTicketV2Node } from '../../src/ticket/v2/node.mjs'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOME = process.env.HOME
const TERPD = process.env.SEZS_V2_TERPD || process.env.SEZS_V2_TERPD || process.env.TERPD || 'terpd'
const APP_ROOT = join(APP, '..', '..')
const SESSION_TERP = process.env.SEZS_SESSION_ROOT ? join(process.env.SEZS_SESSION_ROOT, 'terp') : ''
const LAB = process.env.SEZS_LOCALTERP_HOME || SESSION_TERP
if (!LAB) throw new Error('SEZS_LOCALTERP_HOME or SEZS_SESSION_ROOT is required (session keyring, not sezs-lab)')
const CHAIN = process.env.SEZS_CHAIN_ID || 'sezs-local-1'
const NODE = 'tcp://127.0.0.1:26657'
const LCD = 'http://127.0.0.1:1317'
const CONTRACTS = process.env.SEZS_CONTRACTS || join(APP_ROOT, 'contracts')
const CIRCUITS = process.env.SEZS_CIRCUITS || join(APP_ROOT, 'circuits', 'sezs-ticket-v2', 'artifacts')
const firstExisting = (cs) => cs.find((c) => c && existsSync(c))
const WASM = process.env.SEZS_MANIFOLD_WASM || firstExisting([
  join(CONTRACTS, 'cw-ave/artifacts/cw_event_manifold.wasm'),
  join(CONTRACTS, 'cw-ave/target/wasm32-unknown-unknown/release/cw_event_manifold.wasm'),
  join(LAB, 'artifacts/cw_event_manifold.wasm'),
])
const CW420_WASM = process.env.SEZS_CW420_WASM || firstExisting([
  join(CONTRACTS, 'cw-ave/artifacts/cw420.wasm'),
  join(CONTRACTS, 'cw-ave/target/wasm32-unknown-unknown/release/cw420.wasm'),
  join(LAB, 'artifacts/cw420.wasm'),
])
const PARAMS = process.env.SEZS_CONSUME_PARAMS || firstExisting([
  join(CIRCUITS, 'sezs_consume_v2.params'),
])
const VKBODY = process.env.SEZS_CONSUME_VKBODY || firstExisting([
  join(CIRCUITS, 'sezs_consume_v2.vkbody'),
])
const BOOT = process.env.SEZS_BOOT_OUT || join(APP, 'dev/localterp/boot.json')
const FIXTURE = JSON.parse(readFileSync(join(APP, 'src/event/fixture.json'), 'utf8'))
const LOG = `${LAB}/upgrade-v2.log`
const EVENT = FIXTURE.event?.id || 'speakez-sessions'
const DOMAIN = 'http://127.0.0.1:3051'
// Contract door_auth_of requires exactly 32 bytes. wasm signPrinted
// uses door_auth_pubkey.as_bytes() of a UTF-8 string, so store 32 ASCII
// bytes (a raw SHA-256 digest is usually invalid UTF-8 and will not
// round-trip through the wasm string ABI).
const DOOR_STR = 'sezs-lab-door-auth-v2'.padEnd(32, 'x')
const DOOR = Buffer.from(DOOR_STR, 'utf8').toString('hex')

const flags = (from) => [
  '--from', from, '--keyring-backend', 'test', '--home', LAB, '--node', NODE,
  '--chain-id', CHAIN, '--gas', 'auto', '--gas-adjustment', '1.6', '-y', '-o', 'json', '-b', 'sync',
]

const run = (args, { fromEnv } = {}) => {
  const r = spawnSync(TERPD, args, { encoding: 'utf8', maxBuffer: 20_000_000 })
  writeFileSync(LOG, `\n$ terpd ${args.filter((a) => !String(a).includes('mnemonic')).join(' ')}\nexit=${r.status}\n`, { flag: 'a' })
  // do not write stdout if it might contain key material; tx json is ok
  if (r.stdout && !/priv_key|mnemonic|secret/i.test(r.stdout.slice(0, 200))) {
    writeFileSync(LOG, r.stdout.slice(0, 4000) + '\n', { flag: 'a' })
  }
  if (r.stderr) writeFileSync(LOG, r.stderr.slice(0, 2000) + '\n', { flag: 'a' })
  return r
}

const addr = (name) => {
  const r = run(['keys', 'show', name, '-a', '--keyring-backend', 'test', '--home', LAB])
  if (r.status !== 0) throw new Error(`missing lab key name ${name}`)
  return r.stdout.trim()
}

const waitTx = (hash) => {
  for (let i = 0; i < 40; i++) {
    const q = run(['q', 'tx', hash, '--node', NODE, '-o', 'json'])
    if (q.status === 0) {
      const j = JSON.parse(q.stdout)
      return j
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
  }
  throw new Error(`tx not found`)
}

const tx = (args, from) => {
  const r = run([...args, ...flags(from)])
  let j
  try { j = JSON.parse(r.stdout || '{}') } catch { throw new Error(`bad tx json: ${(r.stderr || r.stdout || '').slice(-300)}`) }
  if (!j.txhash || j.code) throw new Error(`broadcast failed: ${(j.raw_log || r.stderr || '').slice(0, 400)}`)
  const inc = waitTx(j.txhash)
  if (inc.code) throw new Error(`tx failed: ${(inc.raw_log || '').slice(0, 400)}`)
  return inc
}

const attr = (txj, key) => {
  for (const e of txj.events || []) {
    for (const a of e.attributes || []) if (a.key === key) return a.value
  }
  return ''
}

const log = (m) => console.log(`[upgrade-v2] ${m}`)

if (!WASM || !existsSync(WASM)) throw new Error('missing cw-event-manifold wasm')
if (!PARAMS || !VKBODY || !existsSync(PARAMS) || !existsSync(VKBODY)) throw new Error('missing circuit artifacts')
if (!existsSync(TERPD)) throw new Error('missing terpd')

const waitFirstBlock = () => {
  for (let i = 0; i < 90; i++) {
    const r = spawnSync('python3', ['-c', 'import json,urllib.request; j=json.load(urllib.request.urlopen("http://127.0.0.1:26657/status", timeout=2)); print(j["result"]["sync_info"]["latest_block_height"])'], { encoding: 'utf8' })
    const h = Number((r.stdout || '').trim())
    if (h >= 1) { log(`terp height ${h}`); return h }
    spawnSync('sleep', ['1'])
  }
  throw new Error('terp did not commit the first block')
}
waitFirstBlock()

writeFileSync(LOG, `upgrade-v2 ${new Date().toISOString()}\n`)

const curator = addr('curator')
const service = addr('service')
const usher = addr('usher')
const coord = addr('coord')
log(`addresses curator=${curator} service=${service} usher=${usher} coord=${coord}`)

const existing = existsSync(BOOT) ? JSON.parse(readFileSync(BOOT, 'utf8')) : {}
const oldContract = existing.contract
let coordGroup = process.env.SEZS_COORD_GROUP || ''
let usherGroup = process.env.SEZS_USHER_GROUP || ''
if (oldContract && (!coordGroup || !usherGroup)) {
  try {
    const q = await fetch(`${LCD}/cosmwasm/wasm/v1/contract/${oldContract}/smart/${Buffer.from(JSON.stringify({ event_view: {} })).toString('base64')}`)
    const view = (await q.json()).data
    coordGroup = coordGroup || view?.roles?.coordinators_group || ''
    usherGroup = usherGroup || view?.roles?.usher_group || ''
    log(`reusing groups from existing event`)
  } catch (e) {
    log(`could not read existing event view: ${e.message}`)
  }
}
if (!coordGroup || !usherGroup) {
  if (!CW420_WASM) throw new Error('need coordinator and usher group addresses, and cw420.wasm is missing')
  log('storing cw420 for coordinator and usher groups')
  const stored420 = tx(['tx', 'wasm', 'store', CW420_WASM], 'curator')
  const code420 = attr(stored420, 'code_id')
  if (!code420) throw new Error('no cw420 code_id')
  const instGroup = (label, members) => {
    const init = { admin: curator, members: members.map((addr) => ({ addr, weight: 1 })) }
    const instg = tx(['tx', 'wasm', 'instantiate', code420, JSON.stringify(init), '--label', label, '--admin', curator], 'curator')
    const addr = attr(instg, '_contract_address')
    if (!addr) throw new Error(`no address for ${label}`)
    return addr
  }
  if (!coordGroup) {
    coordGroup = instGroup(`sezs-coord-${Date.now()}`, [curator, coord, service])
    log(`coordinators group instantiated`)
  }
  if (!usherGroup) {
    usherGroup = instGroup(`sezs-usher-${Date.now()}`, [usher])
    log(`usher group instantiated`)
  }
}

// fund service + usher + coord so they can sign
for (const [name, a] of [['service', service], ['usher', usher], ['coord', coord]]) {
  const bal = run(['q', 'bank', 'balances', a, '--node', NODE, '-o', 'json'])
  const uter = JSON.parse(bal.stdout || '{"balances":[]}').balances?.find((c) => c.denom === 'uterp')
  const amt = Number(uter?.amount || 0)
  if (amt < 1_000_000_000) {
    log(`funding ${name}`)
    tx(['tx', 'bank', 'send', curator, a, '10000000000uterp'], 'curator')
  } else {
    log(`${name} already funded`)
  }
}

log('storing cw-event-manifold wasm')
const stored = tx(['tx', 'wasm', 'store', WASM], 'curator')
const codeId = attr(stored, 'code_id')
log(`code_id=${codeId} gas=${stored.gas_used}`)
if (!codeId) throw new Error('no code_id')

const t = loadTicketV2Node()
const eventIdFp = Buffer.from(t.eventIdFp(EVENT)).toString('hex')
const domainFp = Buffer.from(t.domainFp(DOMAIN)).toString('hex')
const ev = FIXTURE.event || {}
const ns = (iso) => {
  const s = Date.parse(iso || 0)
  const sec = Number.isFinite(s) ? Math.floor(s / 1000) : 1_799_280_000
  return String(sec) + '000000000'
}

const init = {
  curator,
  coordinators: coordGroup,
  id: EVENT,
  name: ev.name || 'Speakez Sessions',
  status: ev.status || 'announced',
  start: ns(ev.start),
  end: ns(ev.end),
  timezone: ev.timezone || 'America/New_York',
  domain: DOMAIN,
  door_auth_pubkey: DOOR,
  summary: ev.summary || '',
  tags: ev.tags || ['music', 'night'],
  service_key: service,
  usher_group: usherGroup,
  kind: ev.kind || 31923,
}

log('instantiating manifold')
const inst = tx(['tx', 'wasm', 'instantiate', codeId, JSON.stringify(init), '--label', `sezs-event-v2-${Date.now()}`, '--admin', curator], 'curator')
const contract = attr(inst, '_contract_address')
log(`contract=${contract} gas=${inst.gas_used}`)
if (!contract) throw new Error('no contract address')

const exec = (msg, from = 'coord') => tx(['tx', 'wasm', 'execute', contract, JSON.stringify(msg)], from)

// seed programme from fixture
const seedOne = (items, wrap) => {
  for (const item of items || []) {
    try { exec(wrap(item), 'coord') } catch (e) { log(`seed skip: ${e.message.slice(0, 120)}`) }
  }
}
const tsto = (s) => ns(s)
seedOne(FIXTURE.faq, (item) => ({ upsert_faq: { item: { id: item.id, question: item.question || item.q, answer: item.answer || item.a, audience: item.audience || 'attendees' } } }))
seedOne(FIXTURE.lineup, (slot) => ({ upsert_lineup_slot: { slot: { id: slot.id, index: slot.index, role: slot.role, handle: slot.handle, start: tsto(slot.start), duration_min: slot.durationMin || slot.duration_min || 50, lane: slot.lane || '' } } }))
seedOne(FIXTURE.timeline, (item) => ({ upsert_timeline_item: { item: { id: item.id, start: tsto(item.start), end: item.end ? tsto(item.end) : tsto(item.start), label: item.label, lane: item.lane || '', untimed: !!item.untimed } } }))
seedOne(FIXTURE.sponsors, (sp) => ({ upsert_sponsor: { sponsor: { id: sp.id, handle: sp.handle, note: sp.note || '' } } }))
seedOne(FIXTURE.tiers, (tier) => ({ upsert_tier: { tier: {
  id: tier.id, label: tier.label, list_cents: tier.listCents || tier.list_cents || 4000,
  discounts_bps: Object.fromEntries(Object.entries(tier.discountsBps || tier.discounts_bps || { zec: 5000, penumbra: 5000 }).filter(([k]) => k === 'zec' || k === 'penumbra')),
  supply: tier.supply || 0, sold: 0, guest_weight: tier.guestWeight || 1,
} } }))

log('storing sezs_consume_v2 circuit')
throw new Error('upgrade-v2 no longer registers circuits with terpd store-full-circuit; use make deploy-local / sezs-orch-deploy (cw-orch upload_circuit)')
