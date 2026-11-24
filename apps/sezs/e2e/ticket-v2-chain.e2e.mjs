// Ticket v2 end to end on a LOCAL terpd (127.0.0.1), no public network:
//   browser lib (wasm) makes secrets + C → v2 backend invoices/pays/builds tree →
//   root publisher (lab key standing in for the principal admin FROST set) sends
//   UpdateGuestRoot → holder proves from the public leaf list → usher challenge →
//   holder signs under rk → usher submits Consume → contract verifies the Halo2
//   proof (proof_instance_verify) + RedPallas consent on chain.
//
// Prereq: <repo>/e2e/lab/sezs-ticket-v2/lab/p0-local-terpd.sh (writes lab/p0-env.json),
//         apps/sezs/scripts/build-ticket-v2-wasm.sh
// Run:    node e2e/ticket-v2-chain.e2e.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { loadTicketV2Node } from '../src/ticket/v2/node.mjs'
import { issueInvoiceV2, markPaidV2, leavesV2, hexOf } from '../dev/splash/ticket-v2.mjs'
import { createRootPublisher, cliSigner } from '../dev/splash/root-publisher.mjs'

const ENV = JSON.parse(readFileSync(process.env.SEZS_V2_LAB_ENV || process.env.SEZS_V2_LAB_ENV, 'utf8'))
assert.match(ENV.node, /^tcp:\/\/127\.0\.0\.1:\d+$/, 'loopback node only')
const EVENT = 'speakez-sessions', SKU = 'ga', DOMAIN = 'http://127.0.0.1:3051', DOOR = 'lab-door-auth'
const t = loadTicketV2Node()
const b64 = (u8) => Buffer.from(u8).toString('base64')
const hx = (u8) => Buffer.from(u8).toString('hex')

const terpd = (args) => {
  const r = spawnSync(ENV.terpd, args, { encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const txFlags = (from) => ['--from', from, '--keyring-backend', 'test', '--home', ENV.home, '--node', ENV.node, '--chain-id', ENV.chain_id, '--gas', '30000000', '--fees', '3000000uthiol', '-y', '-o', 'json', '-b', 'sync']
const waitTx = async (hash) => {
  for (let i = 0; i < 40; i++) {
    const q = terpd(['q', 'tx', hash, '--node', ENV.node, '-o', 'json'])
    if (q.code === 0) return JSON.parse(q.out)
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`tx ${hash} not found`)
}
const tx = async (args, from) => {
  const r = terpd([...args, ...txFlags(from)])
  const j = JSON.parse(r.out || '{}')
  if (!j.txhash || j.code) throw new Error(`broadcast failed: ${j.raw_log || r.err.slice(-300)}`)
  return waitTx(j.txhash)
}
const attr = (txj, key) => txj.events.flatMap((e) => e.attributes).find((a) => a.key === key)?.value
const summary = { node: ENV.node, chain: ENV.chain_id, zkid: ENV.zkid }

// 0. event contract stand-in (the probe runs the same verify_consume as the manifold will)
const inst = await tx(['tx', 'wasm', 'instantiate', String(ENV.probe_code_id), JSON.stringify({ zkid: ENV.zkid, event_id_fp: hx(t.eventIdFp(EVENT)), domain_fp: hx(t.domainFp(DOMAIN)), door_auth_pubkey: DOOR, root: null }), '--label', `sezs-v2-e2e-${Date.now()}`, '--no-admin'], ENV.publisher_key)
const contract = attr(inst, '_contract_address')
summary.contract = contract

// 1. purchases: secrets live only in these holder objects
const s = { log: [] }
const holders = Array.from({ length: 6 }, () => {
  const secret = t.newSecret()
  return { secret, C: hexOf(t.commitment(secret, SKU, EVENT)) }
})
for (const h of holders) {
  const inv = issueInvoiceV2(s, { rail: 'zec', commitment: h.C, sku: SKU, eventId: EVENT })
  assert.equal(inv.ok, true)
  h.invoiceId = inv.invoice.id
  assert.equal(markPaidV2(s, h.C, { amountCents: inv.invoice.amountCents }).ok, true)
}

// 2. principal admin publishes the root (lab key stands in for the FROST set)
const pub = createRootPublisher({ signer: cliSigner({ terpd: ENV.terpd, home: ENV.home, keyName: ENV.publisher_key, node: ENV.node, chainId: ENV.chain_id }), contract })
const pr = await pub.maybePublish(s, 'doors-open')
assert.equal(pr.published, true, pr.error)
summary.update_guest_root = { epoch: pr.epoch, leaf_count: pr.leafCount, gas_used: pr.gasUsed }

// 3. holder #2 proves from the public leaf list
const L = leavesV2(s)
const h2 = holders[2]
let t0 = performance.now()
const p = t.prove({ secret: h2.secret, sku: SKU, eventId: EVENT, domain: DOMAIN, leaves: L.leaves })
summary.node_wasm_prove_ms = Math.round(performance.now() - t0)
assert.equal(hexOf(p.root), L.root)
const f = t.consumeFields(p.bundle)

// 4. usher challenge → holder approves and signs → usher submits
const ch = t.liveChallenge({ eventId: EVENT, domain: DOMAIN, usher: ENV.usher })
const sig = t.signLive({ secret: h2.secret, eventId: EVENT, domain: DOMAIN, alphaNonce: p.alphaNonce, challenge: ch })
const consumeMsg = (consent) => JSON.stringify({ consume: { proof: Buffer.from(f.proof, 'hex').toString('base64'), root: f.root, nullifier: f.nullifier, rk_x: f.rk_x, rk_y: f.rk_y, consent } })
const live = await tx(['tx', 'wasm', 'execute', contract, consumeMsg({ live: { challenge: b64(ch), sig: b64(sig) } })], ENV.usher_key)
assert.equal(live.code, 0, live.raw_log)
summary.consume_live = { code: live.code, gas_used: Number(live.gas_used), consent: attr(live, 'consent') }
const replay = await tx(['tx', 'wasm', 'execute', contract, consumeMsg({ live: { challenge: b64(ch), sig: b64(sig) } })], ENV.usher_key)
assert.notEqual(replay.code, 0)
summary.consume_replay = { code: replay.code, log: replay.raw_log.slice(0, 120) }

// 5. holder #4 prints (bearer) and is admitted once
const h4 = holders[4]
const p4 = t.prove({ secret: h4.secret, sku: SKU, eventId: EVENT, domain: DOMAIN, leaves: L.leaves })
const f4 = t.consumeFields(p4.bundle)
const ps = t.signPrinted({ secret: h4.secret, eventId: EVENT, domain: DOMAIN, alphaNonce: p4.alphaNonce, nullifier: p4.nullifier, doorAuthPubkey: DOOR })
const printed = await tx(['tx', 'wasm', 'execute', contract, JSON.stringify({ consume: { proof: Buffer.from(f4.proof, 'hex').toString('base64'), root: f4.root, nullifier: f4.nullifier, rk_x: f4.rk_x, rk_y: f4.rk_y, consent: { printed: { sig: b64(ps) } } } })], ENV.usher_key)
assert.equal(printed.code, 0, printed.raw_log)
summary.consume_printed = { code: printed.code, gas_used: Number(printed.gas_used), consent: attr(printed, 'consent') }

// 6. a ticket bought after the published root cannot be used until the next publish
const late = { secret: t.newSecret() }
late.C = hexOf(t.commitment(late.secret, SKU, EVENT))
const li = issueInvoiceV2(s, { rail: 'zec', commitment: late.C })
markPaidV2(s, late.C, { amountCents: li.invoice.amountCents })
const pl = t.prove({ secret: late.secret, sku: SKU, eventId: EVENT, domain: DOMAIN, leaves: leavesV2(s).leaves })
const fl = t.consumeFields(pl.bundle)
const chl = t.liveChallenge({ eventId: EVENT, domain: DOMAIN, usher: ENV.usher })
const sl = t.signLive({ secret: late.secret, eventId: EVENT, domain: DOMAIN, alphaNonce: pl.alphaNonce, challenge: chl })
const lateMsg = JSON.stringify({ consume: { proof: Buffer.from(fl.proof, 'hex').toString('base64'), root: fl.root, nullifier: fl.nullifier, rk_x: fl.rk_x, rk_y: fl.rk_y, consent: { live: { challenge: b64(chl), sig: b64(sl) } } } })
const lateBefore = await tx(['tx', 'wasm', 'execute', contract, lateMsg], ENV.usher_key)
assert.notEqual(lateBefore.code, 0)
const pr2 = await pub.maybePublish(s, 'force')
assert.equal(pr2.epoch, 2)
const lateAfter = await tx(['tx', 'wasm', 'execute', contract, lateMsg], ENV.usher_key)
assert.equal(lateAfter.code, 0, lateAfter.raw_log)
summary.late_ticket = { before_publish: lateBefore.raw_log.slice(0, 80), after_publish_code: lateAfter.code, gas_used: Number(lateAfter.gas_used) }
console.log(JSON.stringify(summary, null, 1))
