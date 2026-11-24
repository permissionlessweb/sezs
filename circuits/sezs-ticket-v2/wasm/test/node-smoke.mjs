// Node smoke + timing for the wasm bindings (single-threaded, like a browser tab).
// The secret below is random per run and never printed or written.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { webcrypto as crypto } from 'node:crypto'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const w = require('../pkg-node/sezs_ticket_v2_wasm.js')
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n))
const hex = (b) => Buffer.from(b).toString('hex')
const cat = (arr) => { const o = new Uint8Array(arr.length * 32); arr.forEach((x, i) => o.set(x, i * 32)); return o }
const ms = (t) => Math.round(performance.now() - t)

const EVENT = 'speakez-sessions', SKU = 'ga', DOMAIN = 'http://127.0.0.1:3051'
const out = { info: JSON.parse(w.circuitInfo()) }

// 1. cross-check tree root with the native Rust fixture
let t0 = performance.now(); const vkHash0 = w.warmUp(); out.warmup_keygen_ms = ms(t0)
const fixPath = process.argv[2]
if (fixPath) {
  const f = JSON.parse(readFileSync(fixPath, 'utf8'))
  assert.equal(hex(w.treeRoot(cat(f.leaves.map((h) => Buffer.from(h, 'hex'))))), f.root)
  assert.equal(hex(w.domainFp(f.domain)), f.domain_fp)
  assert.equal(hex(w.eventIdFp(f.event)), f.event_id_fp)
  assert.equal(w.verifyBundle(Buffer.from(f.bundle, 'hex'), f.event, f.domain), true)
  out.native_fixture_crosscheck = 'ok'
}

let t = performance.now()
const vkHash = w.warmUp()
out.warmup_again_ms = ms(t)
out.vk_hash = hex(vkHash)

const secret = w.fitSecret(rnd(32))
const C = w.commitment(secret, SKU, EVENT)
const leaves = [...Array(40)].map((_, i) => (i === 17 ? C : w.fitSecret(rnd(32))))
const all = cat(leaves)
const runs = []
let p
for (let i = 0; i < 3; i++) {
  t = performance.now()
  p = w.prove(secret, SKU, EVENT, DOMAIN, all, rnd(32))
  runs.push(ms(t))
}
out.prove_ms = runs
out.bundle_bytes = p.bundle.length
assert.equal(p.leafIndex, 17)
assert.equal(hex(p.root), hex(w.treeRoot(all)))
assert.equal(hex(p.nullifier), hex(w.nullifier(secret, EVENT)))
t = performance.now()
assert.equal(w.verifyBundle(p.bundle, EVENT, DOMAIN), true)
out.verify_ms = ms(t)
assert.equal(w.verifyBundle(p.bundle, EVENT, 'https://evil.example'), false)

const f = JSON.parse(w.bundleFields(p.bundle))
const ch = w.liveChallenge(EVENT, DOMAIN, rnd(16), BigInt(Math.floor(Date.now() / 1000)), 'terp1usher')
assert.equal(JSON.parse(w.parseChallenge(ch)).usher, 'terp1usher')
t = performance.now()
const sig = w.signLive(secret, EVENT, DOMAIN, p.alphaNonce, ch, rnd(32))
out.sign_ms = ms(t)
assert.equal(w.verifyConsent(Buffer.from(f.rk, 'hex'), ch, sig), true)
const other = w.liveChallenge('other-event', DOMAIN, rnd(16), 1n, 'terp1usher')
assert.throws(() => w.signLive(secret, EVENT, DOMAIN, p.alphaNonce, other, rnd(32)))
const pm = w.printedMessage(EVENT, DOMAIN, p.nullifier, 'lab-door-auth')
const ps = w.signPrinted(secret, EVENT, DOMAIN, p.alphaNonce, p.nullifier, 'lab-door-auth', rnd(32))
assert.equal(w.verifyConsent(Buffer.from(f.rk, 'hex'), pm, ps), true)
assert.throws(() => w.prove(w.fitSecret(rnd(32)), SKU, EVENT, DOMAIN, all, rnd(32)), /not in this leaf list/)
console.log(JSON.stringify(out))
