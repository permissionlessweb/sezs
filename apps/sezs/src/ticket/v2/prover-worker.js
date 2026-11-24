// sezs_consume_v2 prover worker (module worker). Keeps the ~2.5 s proof and the
// one-time ~4 s keygen off the UI thread. Copied next to the wasm build by
// scripts/build-ticket-v2-wasm.sh. The secret arrives by postMessage from the
// holder's own page and is never sent anywhere else.
import init, * as w from './sezs_ticket_v2_wasm.js'

let ready = null
const boot = () => (ready ||= init().then(() => ({ vkHash: Array.from(w.warmUp()) })))

self.onmessage = async (ev) => {
  const { id, op, args } = ev.data || {}
  try {
    const info = await boot()
    if (op === 'warmUp') return self.postMessage({ id, ok: true, result: info })
    if (op === 'prove') {
      const t = performance.now()
      const p = w.prove(args.secret, args.sku, args.eventId, args.domain, args.leaves, crypto.getRandomValues(new Uint8Array(32)))
      const result = { bundle: p.bundle, alphaNonce: p.alphaNonce, root: p.root, nullifier: p.nullifier, leafIndex: p.leafIndex, ms: Math.round(performance.now() - t) }
      p.free()
      return self.postMessage({ id, ok: true, result })
    }
    if (op === 'verifyBundle') return self.postMessage({ id, ok: true, result: w.verifyBundle(args.bundle, args.eventId, args.domain) })
    throw new Error(`unknown op ${op}`)
  } catch (e) {
    self.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}
