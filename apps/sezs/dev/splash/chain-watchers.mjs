/**
 * Watch the local Zcash and Penumbra nodes for ticket payments.
 * When a memo commitment matches an open invoice, the invoice is marked paid.
 * Public endpoints and Rotko relays are refused. This replaces the internal
 * confirm-by-POST path whenever an ict-rs session is up.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { chainsReady, loadSession, sessionRoot } from './chain-payouts.mjs'
import { ingestPaidLeafV2, markSeenV2 } from './ticket-v2.mjs'

const loopback = (url) => {
  try {
    const u = new URL(url)
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost'
  } catch {
    return false
  }
}

const publicUrl = (s) => /relay\.zafu\.pro|rotko|penumbra\.zone|mainnet|morocco-1/i.test(String(s || ''))

export const watchersReady = () => {
  const ready = chainsReady(loadSession())
  return ready
}

/**
 * One poll. `scan` is injected in tests; the default talks to local RPC/gRPC.
 * Each hit is { rail, commitment, txid, amountCents }.
 */
const defaultScanScript = () => {
  const home = process.env.HOME || ''
  const cands = [
    process.env.SEZS_TICKET_SCAN,
    process.env.SEZS_ICT_SCRIPTS && join(process.env.SEZS_ICT_SCRIPTS, 'sezs_scan_ticket_payments.mjs'),
    home && process.env.SEZS_SCAN_TICKET_PAYMENTS,
    home && process.env.SEZS_SCAN_TICKET_PAYMENTS,
    home && process.env.SEZS_SCAN_TICKET_PAYMENTS,
  ].filter(Boolean)
  return cands.find((c) => existsSync(c)) || ''
}

const scanLocalTickets = (ready) =>
  new Promise((resolve, reject) => {
    const bin = defaultScanScript()
    if (!bin) {
      resolve([])
      return
    }
    const env = {
      ...process.env,
      SEZS_SESSION_ROOT: sessionRoot() || process.env.SEZS_SESSION_ROOT || '',
    }
    if (ready?.zecRpc) env.SEZS_ZAKURA_RPC = ready.zecRpc
    const child = spawn(process.execPath, [bin], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const to = setTimeout(() => {
      try { child.kill('SIGTERM') } catch {}
      reject(new Error('scan_timeout'))
    }, 180_000)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', () => {})
    child.on('close', (code) => {
      clearTimeout(to)
      if (code !== 0) {
        resolve([])
        return
      }
      try {
        const data = JSON.parse(out.trim().split('\n').filter(Boolean).at(-1) || '{}')
        resolve(Array.isArray(data.hits) ? data.hits : [])
      } catch {
        resolve([])
      }
    })
    child.on('error', () => {
      clearTimeout(to)
      resolve([])
    })
  })

export const pollPayments = async ({ scan } = {}) => {
  const ready = watchersReady()
  if (!ready.ok) return { ok: false, error: ready.error || 'chain_unavailable', hits: [] }
  if (ready.zecRpc && publicUrl(ready.zecRpc)) return { ok: false, error: 'rpc_refused', hits: [] }
  if (ready.umGrpc && publicUrl(ready.umGrpc)) return { ok: false, error: 'grpc_refused', hits: [] }
  const fn = typeof scan === 'function' ? scan : scanLocalTickets
  const hits = await fn(ready)
  return { ok: true, ready: true, hits: Array.isArray(hits) ? hits : [] }
}

/** 0-conf / mempool hits must not be treated as paid. */
export const hitIsConfirmed = (hit) => hit?.confirmed !== false && hit?.mempool !== true

export const applyHits = (state, hits, markPaid) => {
  const applied = []
  const pay = markPaid || ((s, c, extra) => ingestPaidLeafV2(s, { commitment: c, ...extra }))
  for (const hit of hits || []) {
    if (!hit?.commitment || !hit?.txid) continue
    if (!hitIsConfirmed(hit)) {
      markSeenV2(state, hit.commitment, { txid: hit.txid, rail: hit.rail })
      continue
    }
    const r = pay(state, hit.commitment, {
      amountCents: hit.amountCents,
      txid: hit.txid,
      rail: hit.rail,
      height: hit.height,
    })
    if (r?.ok) applied.push({ commitment: hit.commitment, txid: hit.txid, rail: hit.rail, rebuilt: !!r.rebuilt })
  }
  return applied
}

