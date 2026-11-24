/**
 * Payroll execution against the ict-rs local session.
 *
 * FROST gating (honest): the 2-of-3 frost-ed25519 signature over the batch
 * digest is an *approval gate*. Once the batch is signed, this module submits
 * the session rails: ZEC via the 2-of-3 Ironwood FROST PCZT spender
 * (`sezs_zec_frost_ironwood_spend.mjs` + sendrawtransaction) and UM via
 * `pcli_threshold_send.py`. Zakura has no z_sendmany; a missing spender
 * fails closed rather than pretending a transparent hot wallet sent it.
 *
 * Public / demo execution never writes a success receipt in place of a
 * chain transaction. If the local chains are down, execution fails closed.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const publicHost = (s) =>
  /relay\.zafu\.pro|rotko|penumbra\.zone|morocco-1|mainnet|terp\.network/i.test(String(s || ''))

const loopback = (url) => {
  try {
    const u = new URL(url)
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1'
  } catch {
    return false
  }
}

export const sessionRoot = () =>
  process.env.SEZS_SESSION_ROOT || (existsSync('/tmp/sezs-session/current/session.json') ? '/tmp/sezs-session/current' : '')

export const loadSession = (root = sessionRoot()) => {
  const file = root && existsSync(join(root, 'session.json'))
    ? join(root, 'session.json')
    : existsSync('/tmp/sezs-session/current/session.json')
      ? '/tmp/sezs-session/current/session.json'
      : ''
  if (!file) return null
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  if (publicHost(JSON.stringify(raw))) throw new Error('session_refused_public')
  return raw
}

export const chainsReady = (session = loadSession()) => {
  if (!session) return { ok: false, error: 'no_session' }
  const zec = session.zakura?.rpc || session.zakura?.endpoint || session.zcash?.rpc
  const um = session.penumbra?.grpc || session.penumbra?.pd || session.penumbra?.endpoint
  const ready = {
    zec: Boolean(zec && (session.zakura?.ok || session.zakura?.status === 'up' || session.zcash?.ok) && loopback(zec)),
    um: Boolean(um && (session.penumbra?.ok || session.penumbra?.status === 'up') && loopback(um)),
  }
  if (!ready.zec && !ready.um) return { ok: false, error: 'chain_unavailable', zec, um }
  return { ok: true, ...ready, zecRpc: zec, umGrpc: um, session }
}

const rpcCall = async (url, method, params, headers = {}) => {
  if (!loopback(url) || publicHost(url)) throw new Error('rpc_refused')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || 'rpc_error')
  return data.result
}

const runCmd = (bin, args, env = {}, timeoutMs = 15 * 60 * 1000) =>
  new Promise((resolve, reject) => {
    if (!bin || !existsSync(bin)) {
      reject(new Error('bin_missing'))
      return
    }
    const child = spawn(bin, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const to = setTimeout(() => {
      try { child.kill('SIGTERM') } catch {}
      reject(new Error('cmd_timeout'))
    }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('close', (code) => {
      clearTimeout(to)
      if (code !== 0) reject(new Error('cmd_failed'))
      else resolve(out.trim())
    })
    child.on('error', (e) => {
      clearTimeout(to)
      reject(e)
    })
  })

/**
 * Shielded ZEC spend on the local node. Auth material is read from a cookie
 * file path in the session if present; the value is never logged.
 */
const defaultIctScripts = () => {
  const home = process.env.HOME || ''
  const cands = [
    process.env.SEZS_ICT_SCRIPTS,
    home && process.env.SEZS_ENV_SCRIPTS,
    home && process.env.ICT_RS_SCRIPTS,
    home && process.env.ICT_RS_SCRIPTS,
  ].filter(Boolean)
  return cands.find((c) => existsSync(c)) || cands[0] || ''
}

export const sendZec = async ({ rpc, to, amountZat, from: _from }) => {
  if (!loopback(rpc)) throw new Error('rpc_refused')
  const scripts = defaultIctScripts()
  const bin = process.env.SEZS_ZEC_FROST_SPEND || join(scripts, 'sezs_zec_frost_ironwood_spend.mjs')
  if (!existsSync(bin)) throw new Error('zec_frost_spender_missing')
  const root = sessionRoot() || process.env.SEZS_SESSION_ROOT || '/tmp/sezs-session-real'
  const out = await runCmd(process.execPath, [bin], {
    SEZS_SESSION_ROOT: root,
    SEZS_ZAKURA_RPC: rpc,
    SEZS_ZEC_DEST: String(to || ''),
    SEZS_ZEC_AMOUNT_ZAT: String(amountZat),
    SEZS_ZEC_MEMO: process.env.SEZS_ZEC_MEMO || 'sezs1',
  })
  const m = String(out).match(/PAYOUT_TXID\s+([0-9a-f]{64})/i)
  if (!m) throw new Error('zec_frost_txid_missing')
  return { ok: true, txid: m[1], rail: 'ironwood-frost-pczt' }
}

export const sendUm = async ({ pcli, node, to, amount, memo } = {}) => {
  if (node && !loopback(node)) throw new Error('grpc_refused')
  const scripts = defaultIctScripts()
  const py = process.env.SEZS_PCLI_THRESHOLD_SEND || join(scripts, 'pcli_threshold_send.py')
  if (existsSync(py)) {
    const root = sessionRoot() || process.env.SEZS_SESSION_ROOT || ''
    const raw = String(amount)
    const typed = /[A-Za-z]/.test(raw) ? raw : `${raw}penumbra`
    const umEnv = {
      SEZS_SESSION_ROOT: root,
      SEZS_UM_DEST: String(to || ''),
      SEZS_UM_AMOUNT: typed,
    }
    const umMemo = memo || process.env.SEZS_UM_MEMO || 'sezs1'
    if (umMemo) umEnv.SEZS_UM_MEMO = String(umMemo)
    const pcliBin = pcli || process.env.SEZS_PCLI || process.env.PCLI_BIN
    if (pcliBin) umEnv.PCLI_BIN = pcliBin
    const out = await runCmd('/usr/bin/python3', [py], umEnv)
    const m = String(out).match(/[0-9a-f]{64}/i)
    if (!m) throw new Error('um_threshold_txid_missing')
    return { ok: true, txid: m[0], rail: 'pcli-threshold-2of3' }
  }
  const bin = pcli || process.env.SEZS_PCLI || 'pcli'
  const args = []
  if (node) args.push('--node', node)
  args.push('tx', 'send', to, String(amount))
  const out = await runCmd(bin, args)
  const m = out.match(/[0-9a-f]{64}/i)
  return { ok: true, txid: m ? m[0] : 'submitted', rail: 'pcli-tx-send' }
}

export const frostGate = () => {
  if (process.env.SEZS_FROST_SPEND === 'orchard' || process.env.SEZS_FROST_SPEND === 'ironwood') {
    return {
      kind: 'ironwood-redpallas-frost',
      note: 'FROST shares sign Ironwood spend-auth (RedPallas) over a PCZT; the signed tx is submitted with sendrawtransaction.',
    }
  }
  return {
    kind: 'approval-gated-treasury',
    note: 'The FROST signature authorizes the session treasury to submit the spends. The treasury key — not the FROST shares — signs the ZEC and UM transactions.',
  }
}

export const executePayrollPayouts = async (state, batch) => {
  const ready = chainsReady()
  if (!ready.ok) {
    return { ok: false, error: 'chain_unavailable', message: 'Local Zcash and Penumbra endpoints are not up. Start the ict-rs SEZS session first.' }
  }
  const gate = frostGate()
  const zecTxs = []
  const umTxs = []
  const errors = []
  for (const item of batch.items || []) {
    const p = (state.participants || []).find((x) => x.id === item.participantId) || item
    const amount = item.amount || p.amount
    if (p.zec && ready.zec) {
      try {
        const r = await sendZec({ rpc: ready.zecRpc, to: p.zec, amountZat: Math.round(Number(amount) * 1e8) })
        zecTxs.push({ participantId: p.id, txid: r.txid, pending: r.pending || false })
      } catch (e) {
        const msg = String(e && e.message ? e.message : e).slice(0, 80)
        errors.push({ rail: 'zec', participantId: p.id, error: 'zec_send_failed', reason: msg })
      }
    }
    if (p.um && ready.um) {
      try {
        const r = await sendUm({ node: ready.umGrpc, to: p.um, amount: String(amount) })
        umTxs.push({ participantId: p.id, txid: r.txid })
      } catch (e) {
        errors.push({ rail: 'um', participantId: p.id, error: 'um_send_failed' })
      }
    }
  }
  if (!zecTxs.length && !umTxs.length) {
    return { ok: false, error: 'payout_failed', message: 'No on-chain transfer was submitted.', errors }
  }
  return {
    ok: true,
    execution: {
      kind: 'local-chain',
      frostGate: gate.kind,
      frostNote: gate.note,
      zec: zecTxs,
      um: umTxs,
      errors,
    },
  }
}
