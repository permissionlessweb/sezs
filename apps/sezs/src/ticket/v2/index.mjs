/**
 * Ticket v2 library for the front end: sezs_consume_v2 prover + rk consent.
 * See apps/sezs/docs/TICKET-V2-SPEC.md and TICKET-V2-INTERFACE.md.
 *
 * Firm rule (BACKEND-ROLE.md): the browser generates the ticket secret and it
 * never leaves the holder's device. Nothing in this module sends it anywhere;
 * proving happens in a worker on this page.
 *
 * Usage:
 *   const t = await loadTicketV2()                       // main-thread helpers (fast ops)
 *   const C = t.commitment(secret, 'ga', 'speakez-sessions')  // memo sezs1:<hex C>
 *   const prover = createProver()                        // Web Worker
 *   const p = await prover.prove({ secret, sku, eventId, domain, leaves })
 *   // store { bundle, alphaNonce } with the ticket; show bundle as animated QR
 *   const sig = t.signLive({ secret, eventId, domain, alphaNonce, challenge })
 */

export const SUITE = 'P128Pow5T3'
export const TREE_DEPTH = 10
export const BUNDLE_VERSION = 2
export const DEFAULT_BASE = '/zk/sezs-ticket-v2/'

const rnd = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (s) => Uint8Array.from(String(s).match(/../g) || [], (h) => parseInt(h, 16))

/** n × 32-byte leaves (hex strings or Uint8Arrays) → one Uint8Array. */
export const packLeaves = (leaves) => {
  const out = new Uint8Array(leaves.length * 32)
  leaves.forEach((l, i) => out.set(typeof l === 'string' ? unhex(l) : l, i * 32))
  return out
}

/** Wrap a loaded wasm-bindgen module (web or node build) in the ticket API. */
export const wrap = (w) => ({
  info: () => JSON.parse(w.circuitInfo()),
  /** SHA-256(cs‖vk): must equal the on-chain circuit footer vk_hash. */
  vkHash: () => hex(w.warmUp()),
  fitSecret: (bytes32) => w.fitSecret(bytes32),
  newSecret: () => w.fitSecret(rnd(32)),
  commitment: (secret, sku, eventId) => w.commitment(secret, sku, eventId),
  nullifier: (secret, eventId) => w.nullifier(secret, eventId),
  memo: (C) => `sezs1:${hex(C)}`,
  treeRoot: (leaves) => w.treeRoot(packLeaves(leaves)),
  eventIdFp: (s) => w.eventIdFp(s),
  domainFp: (s) => w.domainFp(s),
  /** Synchronous prove (Node / tests). Pages should use createProver(). */
  prove: ({ secret, sku, eventId, domain, leaves }) => {
    const p = w.prove(secret, sku, eventId, domain, packLeaves(leaves), rnd(32))
    const r = { bundle: p.bundle, alphaNonce: p.alphaNonce, root: p.root, nullifier: p.nullifier, leafIndex: p.leafIndex }
    p.free()
    return r
  },
  verifyBundle: ({ bundle, eventId, domain }) => w.verifyBundle(bundle, eventId, domain),
  bundleFields: (bundle) => JSON.parse(w.bundleFields(bundle)),
  /** Usher device: challenge bytes for the small QR. */
  liveChallenge: ({ eventId, domain, usher, issuedAt = Math.floor(Date.now() / 1000), nonce = rnd(16) }) =>
    w.liveChallenge(eventId, domain, nonce, BigInt(issuedAt), usher),
  /** Holder device: decode a scanned challenge to show "Approve check-in by <usher>?". */
  parseChallenge: (bytes) => JSON.parse(w.parseChallenge(bytes)),
  /** Holder device, after an explicit approve tap. Refuses other events/domains. */
  signLive: ({ secret, eventId, domain, alphaNonce, challenge }) =>
    w.signLive(secret, eventId, domain, alphaNonce, challenge, rnd(32)),
  printedMessage: ({ eventId, domain, nullifier, doorAuthPubkey }) => w.printedMessage(eventId, domain, nullifier, doorAuthPubkey),
  /** Printed fallback (bearer): sign once at print time. */
  signPrinted: ({ secret, eventId, domain, alphaNonce, nullifier, doorAuthPubkey }) =>
    w.signPrinted(secret, eventId, domain, alphaNonce, nullifier, doorAuthPubkey, rnd(32)),
  verifyConsent: ({ rk, message, sig }) => w.verifyConsent(typeof rk === 'string' ? unhex(rk) : rk, message, sig),
  /** ConsumeTicket JSON fields (hex/base64) for cw-event-manifold. */
  consumeFields: (bundle) => {
    const f = JSON.parse(w.bundleFields(bundle))
    return { proof: f.proof, root: f.root, nullifier: f.nullifier, rk_x: f.rk_x, rk_y: f.rk_y, rk: f.rk }
  },
})

/** Main-thread module (browser). Loads the web build from `base`. */
export const loadTicketV2 = async ({ base = DEFAULT_BASE } = {}) => {
  const mod = await import(/* webpackIgnore: true */ `${base}sezs_ticket_v2_wasm.js`)
  await mod.default()
  return wrap(mod)
}

/** Web Worker prover. `prove()` resolves with { bundle, alphaNonce, root, nullifier, leafIndex, ms }. */
export const createProver = ({ base = DEFAULT_BASE } = {}) => {
  const worker = new Worker(`${base}prover-worker.js`, { type: 'module' })
  let seq = 0
  const pending = new Map()
  worker.onmessage = (ev) => {
    const { id, ok, result, error } = ev.data || {}
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    ok ? p.resolve(result) : p.reject(new Error(error))
  }
  const call = (op, args) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      worker.postMessage({ id, op, args })
    })
  return {
    warmUp: () => call('warmUp'),
    prove: ({ secret, sku, eventId, domain, leaves }) => call('prove', { secret, sku, eventId, domain, leaves: packLeaves(leaves) }),
    verifyBundle: ({ bundle, eventId, domain }) => call('verifyBundle', { bundle, eventId, domain }),
    terminate: () => worker.terminate(),
  }
}
