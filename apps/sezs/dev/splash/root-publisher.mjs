/**
 * Guest-root publisher (ticket v2). The session admin FROST set (2-of-3)
 * signs UpdateGuestRoot. This runtime only builds the message, gathers the
 * signature, and broadcasts the already-authorized execute on loopback.
 *
 * Cadence: at most every 15 minutes when the root changed, and immediately on
 * 'doors-open' / 'sales-close' / 'force'. Epochs are strictly increasing.
 *
 * Signers:
 * - frostSigner: the session admin FROST set signs; a loopback broadcaster
 *   (coordinator key name only, never key material) submits the tx.
 * - cliSigner: lab broadcast helper used by frostSigner, or a loopback-only
 *   fallback when SEZS_V2_ROOT_SIGNER=cli is set explicitly. It passes a key
 *   NAME; it never reads, prints or copies key material.
 */
import { spawn } from 'node:child_process'
import { ensureV2, recordPublishV2, hydrateV2 } from './ticket-v2.mjs'
import { guestRootMessageHex, signAdminSet, adminDirOf } from '../../src/frost/admin-set.mjs'

export const ROOT_PUBLISH_MS = 15 * 60 * 1000
export const FORCE_REASONS = new Set(['doors-open', 'sales-close', 'force'])

export const updateGuestRootMsg = ({ root, leafCount, epoch, frostSignature }) => {
  const msg = { update_guest_root: { root, leaf_count: leafCount, epoch } }
  if (frostSignature) msg.update_guest_root.frost_signature = frostSignature
  return msg
}

const isLoopback = (node) => /^(tcp|http):\/\/(127\.0\.0\.1|localhost):\d+$/.test(String(node || ''))

const run = (cmd, args) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => resolve({ code, out, err }))
  })

/** LAB signer: local test keyring, loopback node only. */
export const cliSigner = ({ terpd, home, keyName, node, chainId, fees = '', gas = 'auto', gasAdjustment = '1.5' }) => {
  if (!isLoopback(node)) throw new Error('root publisher: refusing a non-loopback node')
  const base = ['--from', keyName, '--keyring-backend', 'test', '--home', home, '--node', node, '--chain-id', chainId, '--gas', gas, '-y', '-o', 'json', '-b', 'sync']
  if (gas === 'auto') base.push('--gas-adjustment', String(gasAdjustment))
  if (fees) base.push('--fees', fees)
  return {
    kind: 'lab-cli',
    async execute(contract, msg) {
      const r = await run(terpd, ['tx', 'wasm', 'execute', contract, JSON.stringify(msg), ...base])
      const parseJson = (s) => {
        const text = String(s || '')
        const i = text.indexOf('{')
        if (i < 0) return null
        try { return JSON.parse(text.slice(i)) } catch { return null }
      }
      let j = parseJson(r.out) || parseJson(r.err)
      if (!j) {
        const m = `${r.out}\n${r.err}`.match(/"txhash"\s*:\s*"([0-9A-Fa-f]{64})"/)
        if (m) j = { txhash: m[1] }
      }
      const txhash = j && (j.txhash || j.tx_hash)
      const errText = (j && j.raw_log) || r.err.split('\n').slice(-2).join(' ').slice(0, 300) || r.out.slice(0, 300)
      const fail = (error, extra = {}) => ({ ok: false, error, txhash, height: j && (j.height != null ? Number(j.height) : undefined), ...extra })
      if (txhash) {
        for (let i = 0; i < 40; i++) {
          const q = await run(terpd, ['q', 'tx', txhash, '--node', node, '-o', 'json'])
          if (q.code === 0) {
            const t = JSON.parse(q.out)
            return t.code
              ? fail(t.raw_log || errText, { height: Number(t.height), gasUsed: Number(t.gas_used) })
              : { ok: true, txhash, height: Number(t.height), gasUsed: Number(t.gas_used) }
          }
          await new Promise((r2) => setTimeout(r2, 500))
        }
        if (r.code !== 0 || (j && j.code)) return fail(errText)
        return fail('tx not included')
      }
      return fail(errText)
    },

  }
}

/**
 * Admin FROST signer. 2-of-3 signs the canonical guest-root message; the
 * supplied loopback broadcaster only submits the already-signed execute.
 */
export const frostSigner = ({ broadcaster, adminDir, contract: defaultContract } = {}) => ({
  kind: 'frost',
  async execute(contract, msg) {
    if (!broadcaster) return { ok: false, error: 'frost_signer: missing loopback broadcaster' }
    const body = msg?.update_guest_root
    if (!body) return { ok: false, error: 'frost_signer: expected update_guest_root' }
    const target = contract || defaultContract
    try {
      const messageHex = guestRootMessageHex({
        contract: target,
        epoch: body.epoch,
        leafCount: body.leaf_count,
        root: body.root,
      })
      const signed = await signAdminSet({ dir: adminDirOf(adminDir), messageHex })
      body.frost_signature = signed.signatureHex
    } catch (e) {
      return { ok: false, error: `frost_signer: ${e.message || e}` }
    }
    return broadcaster.execute(target, msg)
  },
})

export const createRootPublisher = ({ signer, contract, intervalMs = ROOT_PUBLISH_MS, clock = () => Date.now() }) => {
  let lastAt = 0
  let busy = false
  return {
    /** Returns { published, reason?, skipped? }. Never logs keys. */
    async maybePublish(s, reason = 'interval') {
      hydrateV2(s)
      const v = ensureV2(s)
      const last = v.published[v.published.length - 1]
      if (last && last.root === v.root) return { published: false, skipped: 'root_unchanged' }
      const now = clock()
      if (!FORCE_REASONS.has(reason) && lastAt && now - lastAt < intervalMs) return { published: false, skipped: 'interval' }
      if (busy) return { published: false, skipped: 'busy' }
      busy = true
      try {
        const epoch = (last?.epoch || 0) + 1
        const msg = updateGuestRootMsg({ root: v.root, leafCount: v.leaves.length, epoch })
        const r = await signer.execute(contract, msg)
        if (!r.ok) return { published: false, error: r.error }
        lastAt = now
        const rec = { root: v.root, epoch, leafCount: v.leaves.length, reason, txhash: r.txhash || null, height: r.height || null, gasUsed: r.gasUsed || null, at: now }
        recordPublishV2(s, rec)
        return { published: true, ...rec }
      } finally {
        busy = false
      }
    },
  }
}

/** Env-configured lab publisher, or null (publishing off). */
export const publisherFromEnv = (env = process.env) => {
  const contract = env.SEZS_V2_ROOT_CONTRACT
  if (!contract) return null
  const broadcast = cliSigner({
    terpd: env.SEZS_V2_TERPD || env.SEZS_V2_TERPD || env.TERPD || 'terpd',
    home: env.SEZS_V2_KEYRING_HOME,
    keyName: env.SEZS_V2_KEY_NAME || (env.SEZS_V2_ROOT_SIGNER === 'cli' ? 'service' : 'coord'),
    node: env.SEZS_V2_NODE || 'tcp://127.0.0.1:26657',
    chainId: env.SEZS_V2_CHAIN_ID || 'sezs-local-1',
    fees: env.SEZS_V2_FEES || '',
    gas: env.SEZS_V2_GAS || 'auto',
  })
  // Default is the admin FROST set. The lab service key is used only when
  // SEZS_V2_ROOT_SIGNER=cli is set explicitly.
  const signer = env.SEZS_V2_ROOT_SIGNER === 'cli'
    ? broadcast
    : frostSigner({ broadcaster: broadcast, adminDir: env.SEZS_ADMIN_FROST_DIR, contract })
  return createRootPublisher({ signer, contract })
}
