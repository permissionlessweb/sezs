/**
 * Drive payroll register → propose → FROST → Execute against the live splash.
 * Records txids and balances only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = process.env.SEZS_SESSION_ROOT || ''
const SPLASH = process.env.SEZS_SPLASH_URL || 'http://127.0.0.1:3052'
const PAY_AMOUNT = process.env.SEZS_PAYROLL_AMOUNT || '0.01'
const PCLI = process.env.PCLI_BIN || join(process.env.HOME || '', '.ict-rs/bins/pcli')
const RPC = process.env.SEZS_ZAKURA_RPC || 'http://127.0.0.1:18232'
if (!ROOT) {
  console.error('FAIL SEZS_SESSION_ROOT required')
  process.exit(1)
}

const json = async (path, { method = 'GET', body, as, timeoutMs = 30_000 } = {}) => {
  const headers = { 'content-type': 'application/json', 'x-sezs-splash': '1' }
  if (as) headers.cookie = `sezs_splash=${as}`
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${SPLASH}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: ac.signal,
    })
    const text = await res.text()
    let data
    try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text.slice(0, 400) } }
    return { status: res.status, data }
  } finally { clearTimeout(t) }
}

const rpc = async (method, params = []) => {
  const res = await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || 'rpc_error')
  return data.result
}

const run = (bin, args, timeoutMs = 120_000) => new Promise((resolve, reject) => {
  const child = spawn(bin, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = '', err = ''
  const to = setTimeout(() => { try { child.kill('SIGTERM') } catch {}; reject(new Error('timeout')) }, timeoutMs)
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { err += d })
  child.on('close', (code) => { clearTimeout(to); resolve({ code, out, err }) })
  child.on('error', reject)
})

const pools = async () => {
  const info = await rpc('getblockchaininfo')
  const list = info.valuePools || info.value_pools || []
  const out = { tip: info.blocks }
  for (const p of list) out[p.id || p.pool] = p.chainValue ?? p.value
  return out
}

const pcliBal = async (home) => {
  const r = await run(PCLI, ['--home', home, 'view', 'balance'])
  const out = {}
  for (const ln of r.out.split(/\n/)) {
    const m = ln.match(/([0-9]+(?:\.[0-9]+)?)\s*(penumbra|test_usd|upenumbra)\b/i)
    if (m) out[m[2].toLowerCase()] = (out[m[2].toLowerCase()] || 0) + Number(m[1])
  }
  return out
}

const dests = () => {
  const rec = JSON.parse(readFileSync(join(ROOT, 'zec-frost/payout-recipient.json'), 'utf8'))
  const zec = rec.ua_uregtest || rec.ua || rec.ua_utest
  const umFile = join(ROOT, 'pcli/dest1.addr')
  const um = existsSync(umFile) ? readFileSync(umFile, 'utf8').trim() : ''
  return { zec, um, zecPrefix: String(zec).slice(0, 12) + '…', umPrefix: String(um).slice(0, 12) + '…' }
}

const main = async () => {
  const d = dests()
  const before = { zec: await pools(), seat0: await pcliBal(join(ROOT, 'pcli/seat0')) }
  console.log('dest prefixes', d.zecPrefix, d.umPrefix)
  console.log('balances before', JSON.stringify(before))

  const inv = await json('/sezs/payroll/invites', { method: 'POST', as: 'admin-1', body: { role: 'artist', label: 'Lab payout' } })
  if (!inv.data?.ok) throw new Error('invite: ' + (inv.data?.error || inv.status))
  const key = inv.data.key || inv.data.registrationKey || inv.data.invite?.key
  if (!key) throw new Error('invite missing key')
  const reg = await json('/sezs/payroll/register', {
    method: 'POST',
    body: { registrationKey: key, displayName: 'Lab artist', zec: d.zec, um: d.um },
  })
  if (!reg.data?.ok) throw new Error('register: ' + (reg.data?.error || reg.status))
  const participantId = reg.data.participant?.id
  await json('/sezs/payroll/amounts', {
    method: 'POST', as: 'admin-1',
    body: { roleAmounts: { artist: PAY_AMOUNT }, amounts: [{ id: participantId, amount: PAY_AMOUNT }] },
  })
  const proposed = await json('/sezs/payroll/batches', { method: 'POST', as: 'admin-1', body: { note: 'real local-chain payout' } })
  if (!proposed.data?.ok) throw new Error('propose: ' + (proposed.data?.error || proposed.status))
  const batchId = proposed.data.batch?.id
  const frost = await json('/sezs/payroll/batches/frost', { method: 'POST', as: 'admin-1', body: { batchId }, timeoutMs: 180_000 })
  if (!frost.data?.ok) throw new Error('frost: ' + (frost.data?.error || frost.status))
  console.log('frost signed', frost.data.batch?.status, 'via', frost.data.via)
  const executed = await json('/sezs/payroll/batches/execute', { method: 'POST', as: 'admin-1', body: { batchId }, timeoutMs: 16 * 60 * 1000 })
  const exec = {
    ok: executed.data?.ok === true,
    error: executed.data?.error,
    kind: executed.data?.batch?.execution?.kind,
    frostGate: executed.data?.batch?.execution?.frostGate,
    zec: (executed.data?.batch?.execution?.zec || []).map((x) => ({ txid: x.txid, pending: x.pending })),
    um: (executed.data?.batch?.execution?.um || []).map((x) => ({ txid: x.txid })),
    errors: executed.data?.batch?.execution?.errors,
  }
  console.log('execute', JSON.stringify(exec))
  try { await rpc('generate', [1]) } catch {}
  const after = { zec: await pools(), seat0: await pcliBal(join(ROOT, 'pcli/seat0')) }
  console.log('balances after', JSON.stringify(after))
  const report = { ok: exec.ok, destPrefixes: { zec: d.zecPrefix, um: d.umPrefix }, participantId, batchId, execute: exec, balances: { before, after } }
  mkdirSync(join(ROOT, 'reports'), { recursive: true, mode: 0o700 })
  writeFileSync(join(ROOT, 'reports/payroll-execute.json'), JSON.stringify(report, null, 2))
  console.log('REPORT written')
  if (!exec.ok) process.exit(2)
}

main().catch((e) => { console.error('FAIL', e.message || e); process.exit(1) })
