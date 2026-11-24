/**
 * Real local-chain ticket buys + payroll Execute.
 * Records txids and balances only — never keys, seeds, or full addresses.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { createRequire } from 'node:module'

const ROOT = process.env.SEZS_SESSION_ROOT || ''
const SPLASH = process.env.SEZS_SPLASH_URL || 'http://127.0.0.1:3052'
const APP = process.env.SEZS_APP || process.env.SEZS_APP
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const EVENT = process.env.SEZS_EVENT_ID || 'speakez-sessions'
const SKU = process.env.SEZS_SKU || 'ga'
const DOMAIN = process.env.SEZS_EVENT_DOMAIN || 'http://127.0.0.1:3051'
const ZEC_ZAT = String(process.env.SEZS_TICKET_ZEC_ZAT || '100000')
const UM_AMOUNT = process.env.SEZS_TICKET_UM_AMOUNT || '0.001penumbra'
const PAY_AMOUNT = process.env.SEZS_PAYROLL_AMOUNT || '0.01'
const PCLI = process.env.PCLI_BIN || join(process.env.HOME || '', '.ict-rs/bins/pcli')
const RPC = process.env.SEZS_ZAKURA_RPC || 'http://127.0.0.1:18232'

const die = (m) => {
  console.error('FAIL', m)
  process.exit(1)
}
if (!ROOT || !existsSync(join(ROOT, 'session.json'))) die('SEZS_SESSION_ROOT is required')

const json = async (path, { method = 'GET', body, as, splash = true, timeoutMs = 30_000 } = {}) => {
  const headers = { 'content-type': 'application/json' }
  if (as) headers.cookie = `sezs_splash=${as}`
  if (splash) headers['x-sezs-splash'] = '1'
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${SPLASH}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    })
    const text = await res.text()
    let data
    try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text.slice(0, 400) } }
    return { status: res.status, data }
  } finally {
    clearTimeout(t)
  }
}

const run = (bin, args, env = {}, timeoutMs = 15 * 60 * 1000) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const to = setTimeout(() => {
      try { child.kill('SIGTERM') } catch {}
      reject(new Error(`timeout ${bin}`))
    }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('close', (code) => {
      clearTimeout(to)
      resolve({ code, out, err })
    })
    child.on('error', (e) => {
      clearTimeout(to)
      reject(e)
    })
  })

const rpc = async (method, params = []) => {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || 'rpc_error')
  return data.result
}

const scanBin = () => {
  const cands = [
    process.env.SEZS_TICKET_SCAN,
    join(SCRIPT_DIR, 'sezs_scan_ticket_payments.mjs'),
    process.env.SEZS_SCAN_TICKET_PAYMENTS,
  ].filter(Boolean)
  return cands.find((c) => existsSync(c)) || ''
}

const scan = async (balances = false) => {
  const bin = scanBin()
  if (!bin) die('scan script missing')
  const r = await run(process.execPath, [bin, ...(balances ? ['--balances'] : [])], {
    SEZS_SESSION_ROOT: ROOT,
    SEZS_ZAKURA_RPC: RPC,
    SEZS_SCAN_BALANCES: balances ? '1' : '',
  }, 180_000)
  const line = r.out.trim().split('\n').filter(Boolean).at(-1) || '{}'
  try { return JSON.parse(line) } catch { return { ok: false, raw: line.slice(0, 200) } }
}

const readAddr = (file) => existsSync(file) ? readFileSync(file, 'utf8').trim() : ''

const dests = () => {
  const dealer = JSON.parse(readFileSync(join(ROOT, 'zec-frost/dealer.json'), 'utf8'))
  const zec = process.env.SEZS_TICKET_ZEC_DEST || dealer.ua || dealer.ua_uregtest || ''
  const recFile = join(ROOT, 'zec-frost/payout-recipient.json')
  let payZec = ''
  if (existsSync(recFile)) {
    const rec = JSON.parse(readFileSync(recFile, 'utf8'))
    payZec = rec.ua || rec.ua_uregtest || rec.address || ''
  }
  const um = process.env.SEZS_TICKET_UM_DEST || readAddr(join(ROOT, 'pcli/artist.addr')) || readAddr(join(ROOT, 'pcli/dest1.addr'))
  const payUm = process.env.SEZS_PAYROLL_UM_DEST || readAddr(join(ROOT, 'pcli/dest1.addr')) || um
  return {
    ticketZec: zec,
    ticketUm: um,
    payZec: payZec || zec,
    payUm,
    zecPrefix: String(zec).slice(0, 12) + '…',
    umPrefix: String(um).slice(0, 12) + '…',
  }
}

const spendZec = async (dest, zat, memo) => {
  const bin = process.env.SEZS_ZEC_FROST_SPEND || join(SCRIPT_DIR, 'sezs_zec_frost_ironwood_spend.mjs')
  if (!existsSync(bin)) die('spender missing')
  const r = await run(process.execPath, [bin], {
    SEZS_SESSION_ROOT: ROOT,
    SEZS_ZAKURA_RPC: RPC,
    SEZS_ZEC_DEST: dest,
    SEZS_ZEC_AMOUNT_ZAT: String(zat),
    SEZS_ZEC_MEMO: memo,
  })
  const m = String(r.out + '\n' + r.err).match(/PAYOUT_TXID\s+([0-9a-f]{64})/i)
  if (!m) die('zec spend missing txid')
  return m[1]
}

const spendUm = async (dest, amount, memo) => {
  const py = process.env.SEZS_PCLI_THRESHOLD_SEND || join(SCRIPT_DIR, 'pcli_threshold_send.py')
  if (!existsSync(py)) die('pcli_threshold_send missing')
  const r = await run('/usr/bin/python3', [py], {
    SEZS_SESSION_ROOT: ROOT,
    SEZS_UM_DEST: dest,
    SEZS_UM_AMOUNT: amount,
    SEZS_UM_MEMO: memo,
    PCLI_BIN: PCLI,
  })
  const m = String(r.out + '\n' + r.err).match(/UM_TXID=([0-9a-f]{64})/i) || String(r.out).match(/([0-9a-f]{64})/i)
  if (!m) die('um spend missing txid')
  return m[1] || m[0]
}

const waitPaid = async (commitments, knownTxids = [], tries = 36) => {
  if (knownTxids.length) process.env.SEZS_ZEC_SCAN_TXIDS = knownTxids.join(',')
  for (let i = 0; i < tries; i++) {
    const poll = await json('/__splash/api/v2/watch/poll', { method: 'POST', timeoutMs: 200_000 })
    const paid = []
    for (const c of commitments) {
      const st = await json(`/sezs/v2/paid?c=${c}`, { method: 'GET', splash: false })
      if (st.data?.paid) paid.push(c)
    }
    if (paid.length === commitments.length) return { poll: poll.data, paid }
    await delay(5000)
  }
  die('watchers did not confirm both tickets')
}

const loadTicket = async () => {
  const { loadTicketV2Node } = await import(pathToFileURL(join(APP, 'src/ticket/v2/node.mjs')).href)
  return loadTicketV2Node()
}

const hexOf = (bytes) => Buffer.from(bytes).toString('hex')

const main = async () => {
  const report = { ok: false, session: ROOT, at: new Date().toISOString(), tickets: {}, payroll: {}, balances: {} }
  const d = dests()
  report.destPrefixes = { ticketZec: d.zecPrefix, ticketUm: d.umPrefix }
  console.log('dest prefixes', d.zecPrefix, d.umPrefix)

  report.balances.before = (await scan(true)).balances || {}
  try {
    const tip = await rpc('getblockchaininfo')
    report.balances.before.zecTip = tip.blocks
    report.balances.before.zecValuePools = tip.valuePools || tip.value_pools || null
  } catch {}

  const t = await loadTicket()
  const zec = { secret: t.newSecret() }
  zec.C = hexOf(t.commitment(zec.secret, SKU, EVENT))
  const um = { secret: t.newSecret() }
  um.C = hexOf(t.commitment(um.secret, SKU, EVENT))

  const invZ = await json('/__splash/api/v2/invoice', { method: 'POST', body: { rail: 'zec', commitment: zec.C, sku: SKU, eventId: EVENT } })
  if (!invZ.data?.ok) die('zec invoice: ' + (invZ.data?.error || invZ.status))
  const invU = await json('/__splash/api/v2/invoice', { method: 'POST', body: { rail: 'penumbra', commitment: um.C, sku: SKU, eventId: EVENT } })
  if (!invU.data?.ok) die('um invoice: ' + (invU.data?.error || invU.status))
  const memoZ = invZ.data.invoice.memo
  const memoU = invU.data.invoice.memo
  if (!memoZ?.startsWith('sezs1:') || !memoU?.startsWith('sezs1:')) die('invoice memo prefix')
  report.tickets.invoices = { zec: invZ.data.invoice.id, um: invU.data.invoice.id, memoPrefix: 'sezs1:' }

  console.log('paying ZEC ticket…')
  const zecTxid = await spendZec(d.ticketZec, ZEC_ZAT, memoZ)
  report.tickets.zecTxid = zecTxid
  console.log('ZEC txid', zecTxid)

  // Confirm the spend in a block so the watcher can decrypt it.
  try { await rpc('generate', [1]) } catch {}

  console.log('paying UM ticket…')
  const umTxid = await spendUm(d.ticketUm, UM_AMOUNT, memoU)
  report.tickets.umTxid = umTxid
  console.log('UM txid', umTxid)

  const watched = await waitPaid([zec.C, um.C], [zecTxid])
  report.tickets.watcher = { applied: (watched.poll?.applied || []).map((h) => ({ rail: h.rail, txid: h.txid })) }
  console.log('watchers confirmed both invoices')

  let pub = await json('/__splash/api/v2/root/publish', { method: 'POST', body: { reason: 'force' }, timeoutMs: 120_000 })
  if (pub.data?.skipped === 'busy') {
    await delay(4000)
    pub = await json('/__splash/api/v2/root/publish', { method: 'POST', body: { reason: 'force' }, timeoutMs: 120_000 })
  }
  report.tickets.publish = { published: pub.data?.published, txhash: pub.data?.txhash || pub.data?.txHash, epoch: pub.data?.epoch, error: pub.data?.error, skipped: pub.data?.skipped }
  const leaves0 = await json('/sezs/v2/leaves', { splash: false })
  if (!leaves0.data?.published?.txhash && !report.tickets.publish.published) {
    die('root publish did not land: ' + (pub.data?.skipped || pub.data?.error || pub.status))
  }
  if (!report.tickets.publish.txhash && leaves0.data?.published?.txhash) {
    report.tickets.publish = { ...report.tickets.publish, published: true, txhash: leaves0.data.published.txhash, epoch: leaves0.data.published.epoch, skipped: pub.data?.skipped }
  }
  console.log('root publish', report.tickets.publish.published ? report.tickets.publish.txhash : (pub.data?.skipped || pub.data?.error || pub.status))

  const leaves = await json('/sezs/v2/leaves', { splash: false })
  const L = leaves.data
  if (!L?.leaves?.includes(zec.C) || !L?.leaves?.includes(um.C)) die('leaves missing paid commitments')

  const proveZ = t.prove({ secret: zec.secret, sku: SKU, eventId: EVENT, domain: DOMAIN, leaves: L.leaves })
  const proveU = t.prove({ secret: um.secret, sku: SKU, eventId: EVENT, domain: DOMAIN, leaves: L.leaves })
  report.tickets.prove = { nodeZec: true, nodeUm: true }
  console.log('node prove ok')

  const fields = t.consumeFields(proveZ.bundle)
  const doorCfg = await json('/sezs/v2/door/config', { splash: false })
  const usher = doorCfg.data?.usher
  if (!usher) die('door config missing usher address')
  const ch = t.liveChallenge({ eventId: EVENT, domain: DOMAIN, usher })
  const sig = t.signLive({ secret: zec.secret, eventId: EVENT, domain: DOMAIN, alphaNonce: proveZ.alphaNonce, challenge: ch })
  const eventIdFp = hexOf(t.eventIdFp(EVENT))
  const domainFp = hexOf(t.domainFp(DOMAIN))
  const consumeBody = {
    proof: fields.proof,
    root: fields.root,
    nullifier: fields.nullifier,
    event_id: eventIdFp,
    domain: domainFp,
    rk_x: fields.rk_x,
    rk_y: fields.rk_y,
    consent: { live: { challenge: Buffer.from(ch).toString('base64'), sig: Buffer.from(sig).toString('base64') } },
  }
  const admit = await json('/sezs/v2/door/consume', { method: 'POST', body: consumeBody, as: 'usher-1', splash: false, timeoutMs: 120_000 })
  report.tickets.admit = { ok: admit.data?.ok === true, txhash: admit.data?.txhash, error: admit.data?.error }
  if (!admit.data?.ok) die('door admit failed: ' + (admit.data?.error || admit.status))
  console.log('admitted', admit.data.txhash)

  const replay = await json('/sezs/v2/door/consume', { method: 'POST', body: consumeBody, as: 'usher-1', splash: false, timeoutMs: 120_000 })
  report.tickets.replay = { ok: replay.data?.ok === true, error: replay.data?.error }
  if (replay.data?.ok) die('replay was accepted')
  console.log('replay refused', replay.data?.error)

  // Optional printed admit for the UM ticket to exercise both rails through the door.
  try {
    const doorAuth = doorCfg.data?.doorAuthPubkey || doorCfg.data?.door_auth_pubkey
    if (doorAuth) {
      const ps = t.signPrinted({ secret: um.secret, eventId: EVENT, domain: DOMAIN, alphaNonce: proveU.alphaNonce, nullifier: proveU.nullifier, doorAuthPubkey: doorAuth })
      const f2 = t.consumeFields(proveU.bundle)
      const printed = await json('/sezs/v2/door/consume', {
        method: 'POST',
        as: 'usher-1',
        splash: false,
        timeoutMs: 120_000,
        body: {
          proof: f2.proof, root: f2.root, nullifier: f2.nullifier,
          event_id: eventIdFp, domain: domainFp,
          rk_x: f2.rk_x, rk_y: f2.rk_y,
          consent: { printed: { sig: Buffer.from(ps).toString('base64') } },
        },
      })
      report.tickets.umPrintedAdmit = { ok: printed.data?.ok === true, txhash: printed.data?.txhash, error: printed.data?.error }
    }
  } catch (e) {
    report.tickets.umPrintedAdmit = { error: 'printed_skipped' }
  }

  // --- payroll ---
  console.log('payroll invite / register / propose / frost / execute')
  const inv = await json('/sezs/payroll/invites', { method: 'POST', as: 'admin-1', body: { role: 'artist', label: 'Lab payout' } })
  if (!inv.data?.ok) die('invite: ' + (inv.data?.error || inv.status))
  const key = inv.data.key || inv.data.registrationKey || inv.data.invite?.key
  if (!key) die('invite missing key')
  const reg = await json('/sezs/payroll/register', {
    method: 'POST',
    body: { registrationKey: key, displayName: 'Lab artist', zec: d.payZec, um: d.payUm },
  })
  if (!reg.data?.ok) die('register: ' + (reg.data?.error || reg.status))
  const participantId = reg.data.participant?.id
  await json('/sezs/payroll/amounts', { method: 'POST', as: 'admin-1', body: { roleAmounts: { artist: PAY_AMOUNT, vendor: PAY_AMOUNT, staff: PAY_AMOUNT, usher: PAY_AMOUNT }, amounts: [{ id: participantId, amount: PAY_AMOUNT }] } })
  const proposed = await json('/sezs/payroll/batches', { method: 'POST', as: 'admin-1', body: { note: 'real local-chain payout' } })
  if (!proposed.data?.ok) die('propose: ' + (proposed.data?.error || proposed.status))
  const batchId = proposed.data.batch?.id
  const frost = await json('/sezs/payroll/batches/frost', { method: 'POST', as: 'admin-1', body: { batchId }, timeoutMs: 180_000 })
  if (!frost.data?.ok) die('frost: ' + (frost.data?.error || frost.status))
  report.payroll = { participantId, batchId, frost: frost.data.batch?.status, via: frost.data.via }
  const executed = await json('/sezs/payroll/batches/execute', { method: 'POST', as: 'admin-1', body: { batchId }, timeoutMs: 16 * 60 * 1000 })
  report.payroll.execute = {
    ok: executed.data?.ok === true,
    error: executed.data?.error,
    kind: executed.data?.batch?.execution?.kind,
    frostGate: executed.data?.batch?.execution?.frostGate,
    zec: (executed.data?.batch?.execution?.zec || []).map((x) => ({ txid: x.txid, pending: x.pending })),
    um: (executed.data?.batch?.execution?.um || []).map((x) => ({ txid: x.txid })),
    errors: executed.data?.batch?.execution?.errors || executed.data?.errors,
  }
  if (!executed.data?.ok) {
    console.error('execute failed', executed.data?.error || executed.status)
  } else {
    console.log('execute ok', report.payroll.execute)
  }

  try { await rpc('generate', [1]) } catch {}
  report.balances.after = (await scan(true)).balances || {}
  try {
    const tip = await rpc('getblockchaininfo')
    report.balances.after.zecTip = tip.blocks
    report.balances.after.zecValuePools = tip.valuePools || tip.value_pools || null
  } catch {}

  report.ok = Boolean(report.tickets.zecTxid && report.tickets.umTxid && report.tickets.admit?.ok && report.tickets.replay && !report.tickets.replay.ok)
  const outDir = join(ROOT, 'reports')
  mkdirSync(outDir, { recursive: true, mode: 0o700 })
  const out = join(outDir, 'real-ticket-payroll.json')
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log('REPORT', out)
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok || !report.payroll.execute?.ok) process.exit(2)
}

main().catch((e) => {
  console.error('FAIL', e && e.message ? e.message : e)
  process.exit(1)
})
