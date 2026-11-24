#!/usr/bin/env node
/**
 * Ticket v2 e2e on the local manifold (sezs-local-1, 127.0.0.1):
 * buy (in-process v2 invoices, ZEC + UM) → publish root (lab service key
 * stands in for the FROST set) → prove → live ConsumeTicket → replay refused
 * → printed ConsumeTicket → replay refused.
 * Never prints key material.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { loadTicketV2Node } from '../src/ticket/v2/node.mjs'
import { issueInvoiceV2, markPaidV2, leavesV2, hexOf } from '../dev/splash/ticket-v2.mjs'
import { createRootPublisher, cliSigner } from '../dev/splash/root-publisher.mjs'

const HOME = process.env.HOME
const BOOT = JSON.parse(readFileSync(process.env.SEZS_BOOT || `${SEZS_APP:?set SEZS_APP}/dev/localterp/boot.json`, 'utf8'))
const TERPD = process.env.SEZS_V2_TERPD || process.env.SEZS_V2_TERPD || process.env.TERPD || 'terpd'
const LAB = process.env.SEZS_V2_KEYRING_HOME || process.env.SEZS_LOCALTERP_HOME
const NODE = process.env.SEZS_V2_NODE || (BOOT.rpc ? BOOT.rpc.replace(/^http/, 'tcp') : 'tcp://127.0.0.1:26657')
assert.match(NODE, /^tcp:\/\/127\.0\.0\.1:\d+$/, 'loopback node only')
const CHAIN = BOOT.chainId || 'sezs-local-1'
const CONTRACT = BOOT.contract
const EVENT = 'speakez-sessions', SKU = 'ga', DOMAIN = 'http://127.0.0.1:3051'
const DOOR_STR = 'sezs-door-authxxxxxxxxxxxxxxxxxxx'
const t = loadTicketV2Node()
const b64 = (u8) => Buffer.from(u8).toString('base64')
const hx = (u8) => Buffer.from(u8).toString('hex')
const eventIdFp = hx(t.eventIdFp(EVENT))
const domainFp = hx(t.domainFp(DOMAIN))

const terpd = (args) => {
  const r = spawnSync(TERPD, args, { encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const txFlags = (from) => [
  '--from', from, '--keyring-backend', 'test', '--home', LAB, '--node', NODE,
  '--chain-id', CHAIN, '--gas', 'auto', '--gas-adjustment', '1.6', '-y', '-o', 'json', '-b', 'sync',
]
const waitTx = async (hash) => {
  for (let i = 0; i < 40; i++) {
    const q = terpd(['q', 'tx', hash, '--node', NODE, '-o', 'json'])
    if (q.code === 0) return JSON.parse(q.out)
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('tx not found')
}
const tx = async (args, from) => {
  const r = terpd([...args, ...txFlags(from)])
  const j = JSON.parse(r.out || '{}')
  if (!j.txhash) throw new Error(`broadcast failed: ${j.raw_log || r.err.slice(-300)}`)
  if (j.code) return j
  return waitTx(j.txhash)
}

const consumeMsg = (f, consent) => JSON.stringify({
  consume_ticket: {
    proof: Buffer.from(f.proof, 'hex').toString('base64'),
    root: f.root,
    nullifier: f.nullifier,
    event_id: eventIdFp,
    domain: domainFp,
    rk_x: f.rk_x,
    rk_y: f.rk_y,
    consent,
  },
})

const usherAddr = terpd(['keys', 'show', 'usher', '-a', '--keyring-backend', 'test', '--home', LAB]).out.trim()
const summary = { contract: CONTRACT, chain: CHAIN, zkid: BOOT.zkid, usher: usherAddr }

const s = { log: [] }
// Resume epoch and the published leaf list so a re-run never shrinks the tree.
const rootsQ = terpd(['q', 'wasm', 'contract-state', 'smart', CONTRACT, '{"roots":{}}', '--node', NODE, '-o', 'json'])
if (rootsQ.code === 0) {
  const data = JSON.parse(rootsQ.out).data || {}
  if (data.current_epoch) {
    const v = (s.v2 = s.v2 || {})
    v.published = [{ root: data.current_root, epoch: data.current_epoch, leafCount: data.current_leaf_count }]
    v.root = data.current_root
  }
}
try {
  const pubLeaves = await (await fetch('http://127.0.0.1:3052/sezs/v2/leaves')).json()
  if (pubLeaves && Array.isArray(pubLeaves.leaves) && pubLeaves.leaves.length) {
    const v = (s.v2 = s.v2 || {})
    v.leaves = pubLeaves.leaves.slice()
    if (pubLeaves.root) v.root = pubLeaves.root
  }
} catch {}
const zec = { secret: t.newSecret() }
zec.C = hexOf(t.commitment(zec.secret, SKU, EVENT))
const um = { secret: t.newSecret() }
um.C = hexOf(t.commitment(um.secret, SKU, EVENT))
for (const [h, rail] of [[zec, 'zec'], [um, 'penumbra']]) {
  const inv = issueInvoiceV2(s, { rail, commitment: h.C, sku: SKU, eventId: EVENT })
  assert.equal(inv.ok, true, inv.error)
  assert.equal(markPaidV2(s, h.C, { amountCents: inv.invoice.amountCents }).ok, true)
}
const tree = leavesV2(s)
assert.ok(tree.leaves.includes(zec.C) && tree.leaves.includes(um.C), 'new leaves missing')
assert.ok(tree.leafCount >= 2, 'expected at least the two new leaves')

const pub = createRootPublisher({
  signer: cliSigner({ terpd: TERPD, home: LAB, keyName: 'service', node: NODE, chainId: CHAIN }),
  contract: CONTRACT,
})
const pr = await pub.maybePublish(s, 'doors-open')
assert.equal(pr.published, true, pr.error)
summary.update_guest_root = { epoch: pr.epoch, leaf_count: pr.leafCount, gas_used: pr.gasUsed }

const L = leavesV2(s)
let t0 = performance.now()
const p = t.prove({ secret: zec.secret, sku: SKU, eventId: EVENT, domain: DOMAIN, leaves: L.leaves })
summary.node_wasm_prove_ms = Math.round(performance.now() - t0)
assert.equal(hexOf(p.root), L.root)
const f = t.consumeFields(p.bundle)
assert.equal(p.bundle.length, 4321)

const ch = t.liveChallenge({ eventId: EVENT, domain: DOMAIN, usher: usherAddr })
const sig = t.signLive({ secret: zec.secret, eventId: EVENT, domain: DOMAIN, alphaNonce: p.alphaNonce, challenge: ch })
const live = await tx(['tx', 'wasm', 'execute', CONTRACT, consumeMsg(f, { live: { challenge: b64(ch), sig: b64(sig) } })], 'usher')
assert.equal(live.code, 0, live.raw_log)
summary.consume_live = { code: live.code, gas_used: Number(live.gas_used) }

const replay = await tx(['tx', 'wasm', 'execute', CONTRACT, consumeMsg(f, { live: { challenge: b64(ch), sig: b64(sig) } })], 'usher').catch((e) => ({ code: 1, raw_log: String(e.message) }))
assert.notEqual(replay.code, 0)
summary.consume_replay = { code: replay.code, log: String(replay.raw_log || '').slice(0, 160) }

const p2 = t.prove({ secret: um.secret, sku: SKU, eventId: EVENT, domain: DOMAIN, leaves: L.leaves })
const f2 = t.consumeFields(p2.bundle)
const ps = t.signPrinted({ secret: um.secret, eventId: EVENT, domain: DOMAIN, alphaNonce: p2.alphaNonce, nullifier: p2.nullifier, doorAuthPubkey: DOOR_STR })
const printed = await tx(['tx', 'wasm', 'execute', CONTRACT, consumeMsg(f2, { printed: { sig: b64(ps) } })], 'usher')
assert.equal(printed.code, 0, printed.raw_log)
summary.consume_printed = { code: printed.code, gas_used: Number(printed.gas_used) }

const printedReplay = await tx(['tx', 'wasm', 'execute', CONTRACT, consumeMsg(f2, { printed: { sig: b64(ps) } })], 'usher').catch((e) => ({ code: 1, raw_log: String(e.message) }))
assert.notEqual(printedReplay.code, 0)
summary.consume_printed_replay = { code: printedReplay.code, log: String(printedReplay.raw_log || '').slice(0, 160) }

console.log(JSON.stringify(summary, null, 2))
