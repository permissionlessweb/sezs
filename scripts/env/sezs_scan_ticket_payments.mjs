/**
 * Scan the local Zakura and Penumbra nodes for ticket memos (`sezs1:` + 32-byte
 * commitment). Prints a JSON object `{ hits, balances? }` with txids only —
 * never viewing keys, seeds, or full addresses.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = process.env.SEZS_SESSION_ROOT || ''
const RPC = process.env.SEZS_ZAKURA_RPC || 'http://127.0.0.1:18232'
const PCLI = process.env.PCLI_BIN || join(process.env.HOME || '', '.ict-rs/bins/pcli')
const HOME = process.env.HOME || ''

const die = (m) => {
  console.error(JSON.stringify({ ok: false, error: m }))
  process.exit(1)
}

const loopback = (url) => {
  try {
    const u = new URL(url)
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1'
  } catch {
    return false
  }
}

if (!ROOT || !existsSync(join(ROOT, 'session.json'))) die('no_session')
if (!loopback(RPC)) die('rpc_refused')

const loadWasm = async () => {
  const src = process.env.SEZS_ZAFU_WASM
    || join(process.env.SEZS_ZAFU_ROOT || '', 'packages/zcash-wasm')
  if (!existsSync(join(src, 'zafu_wasm.js'))) die('wasm_missing')
  const dest = join(tmpdir(), `sezs-zafu-wasm-scan-${process.pid}`)
  mkdirSync(join(dest, 'snippets/wasm-bindgen-rayon-stub/src'), { recursive: true })
  writeFileSync(join(dest, 'snippets/wasm-bindgen-rayon-stub/src/workerHelpers.js'),
    'export async function startWorkers() { throw new Error("no rayon") }\n')
  let js = readFileSync(join(src, 'zafu_wasm.js'), 'utf8')
  js = js.replace(
    /import \{ startWorkers \} from '\.\/snippets\/wasm-bindgen-rayon-[^']+\/src\/workerHelpers\.js';/,
    "import { startWorkers } from './snippets/wasm-bindgen-rayon-stub/src/workerHelpers.js';",
  )
  if (js.includes('wasm-bindgen-rayon-') && !js.includes('wasm-bindgen-rayon-stub')) {
    die('wasm_glue_rewrite_failed')
  }
  writeFileSync(join(dest, 'zafu_wasm.js'), js)
  copyFileSync(join(src, 'zafu_wasm_bg.wasm'), join(dest, 'zafu_wasm_bg.wasm'))
  const mod = await import(pathToFileURL(join(dest, 'zafu_wasm.js')).href + `?v=${Date.now()}`)
  const bytes = readFileSync(join(dest, 'zafu_wasm_bg.wasm'))
  if (typeof mod.initSync === 'function') mod.initSync({ module: bytes })
  else die('wasm_init_missing')
  return mod
}

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

const hexToBytes = (hex) => Buffer.from(String(hex).replace(/^0x/, ''), 'hex')

const parseItl1Commitment = (text) => {
  const s = String(text || '').trim()
  const m = s.match(/^sezs1:([0-9a-fA-F]{64})$/)
  return m ? m[1].toLowerCase() : null
}

const memoFromDecrypt = (note) => {
  if (!note || typeof note !== 'object') return null
  if (note.memo) {
    const c = parseItl1Commitment(note.memo) || parseItl1Commitment(String(note.memo).replace(/\0+$/g, ''))
    if (c) return c
  }
  const raw = note.memo_bytes || note.memoBytes || note.memo_hex || note.memoHex
  if (!raw) return null
  let bytes
  if (typeof raw === 'string') {
    const clean = raw.replace(/^0x/, '')
    bytes = /^[0-9a-fA-F]+$/.test(clean) ? hexToBytes(clean) : Buffer.from(raw)
  } else if (Array.isArray(raw) || raw instanceof Uint8Array) {
    bytes = Buffer.from(raw)
  } else return null
  if (bytes.length >= 2 && bytes[0] === 0xf6) {
    const end = bytes.indexOf(0, 1)
    const text = bytes.subarray(1, end === -1 ? bytes.length : end).toString('utf8')
    return parseItl1Commitment(text)
  }
  const asText = bytes.toString('utf8').replace(/\0+$/g, '')
  return parseItl1Commitment(asText)
}

const valueZat = (note) => {
  const v = note?.value ?? note?.value_zat ?? note?.amount
  const n = typeof v === 'bigint' ? Number(v) : Number(v)
  return Number.isFinite(n) ? n : 0
}

const cursorPath = () => join(ROOT, 'watchers/ticket-cursor.json')

const loadCursor = () => {
  try {
    return JSON.parse(readFileSync(cursorPath(), 'utf8'))
  } catch {
    return { zecHeight: 0, umTxids: [] }
  }
}

const saveCursor = (c) => {
  mkdirSync(dirname(cursorPath()), { recursive: true, mode: 0o700 })
  writeFileSync(cursorPath(), JSON.stringify(c), { mode: 0o600 })
}

const scanZec = async () => {
  const dealerFile = join(ROOT, 'zec-frost/dealer.json')
  if (!existsSync(dealerFile)) return { hits: [], ironwoodZat: null, tip: null }
  const rec = JSON.parse(readFileSync(dealerFile, 'utf8'))
  if (!rec.ufvk) return { hits: [], ironwoodZat: null, tip: null }
  const wasm = await loadWasm()
  if (!wasm.WatchOnlyWallet) die('wasm_missing_watch_only')
  const wallet = wasm.WatchOnlyWallet.from_ufvk(rec.ufvk)
  const info = await rpc('getblockchaininfo')
  const tip = Number(info.blocks || info.headers || 0)
  const cur = loadCursor()
  const lookback = Number(process.env.SEZS_ZEC_SCAN_LOOKBACK || 160)
  let start = Math.max(1, tip - lookback)
  if (cur.zecHeight) start = Math.max(1, Math.min(cur.zecHeight + 1, start))
  // Always re-scan a short tail in case a tx was still unconfirmed.
  start = Math.max(1, Math.min(start, Math.max(1, tip - 16)))
  const extra = String(process.env.SEZS_ZEC_SCAN_TXIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f]{64}$/i.test(s))
  const hits = []
  let ironwoodZat = 0
  const seen = new Set()

  const consider = (txid, arr, extra = {}) => {
    const notes = Array.isArray(arr) ? arr : arr?.notes || arr?.memos || []
    if (!Array.isArray(notes)) return
    for (const note of notes) {
      const zat = valueZat(note)
      if (!note.is_outgoing && zat) ironwoodZat += zat
      const c = memoFromDecrypt(note)
      if (c && txid && !seen.has(txid + c)) {
        seen.add(txid + c)
        hits.push({ rail: 'zec', commitment: c, txid, confirmed: extra.confirmed !== false, height: extra.height ?? null })
      }
    }
  }

  for (const txid of extra) {
    try {
      const raw = await rpc('getrawtransaction', [txid, 0])
      const hex = typeof raw === 'string' ? raw : raw?.hex
      if (!hex) continue
      const memos = wallet.decrypt_transaction_memos(hexToBytes(hex))
      const arr = typeof memos === 'string' ? JSON.parse(memos) : memos
      consider(txid, arr)
    } catch {}
  }

  for (let h = start; h <= tip; h++) {
    let hash
    try { hash = await rpc('getblockhash', [h]) } catch { continue }
    let block
    try { block = await rpc('getblock', [hash, 1]) } catch { continue }
    const txs = block.tx || []
    for (const tx of txs) {
      const txid = typeof tx === 'string' ? tx : tx.txid
      if (!txid || txid === block.merkleroot) continue
      try {
        const raw = typeof tx === 'object' && tx.hex ? tx.hex : await rpc('getrawtransaction', [txid, 0])
        const hex = typeof raw === 'string' ? raw : raw?.hex
        if (!hex) continue
        const memos = wallet.decrypt_transaction_memos(hexToBytes(hex))
        const arr = typeof memos === 'string' ? JSON.parse(memos) : memos
        consider(txid, arr, { confirmed: true, height: h })
      } catch {}
    }
  }

  // Unconfirmed mempool (0-conf). Callers must not treat these as paid.
  try {
    const ids = await rpc('getrawmempool')
    const list = Array.isArray(ids) ? ids : []
    for (const txid of list) {
      if (!txid) continue
      try {
        const raw = await rpc('getrawtransaction', [txid, 0])
        const hex = typeof raw === 'string' ? raw : raw?.hex
        if (!hex) continue
        const memos = wallet.decrypt_transaction_memos(hexToBytes(hex))
        const arr = typeof memos === 'string' ? JSON.parse(memos) : memos
        consider(txid, arr, { confirmed: false, height: 0 })
      } catch {}
    }
  } catch {}

  cur.zecHeight = tip
  saveCursor(cur)
  return { hits, ironwoodZat, tip }
}

const runPcli = (args, home) =>
  new Promise((resolve, reject) => {
    const child = spawn(PCLI, ['--home', home, ...args], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    const to = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('pcli_timeout'))
    }, 120_000)
    child.on('close', (code) => {
      clearTimeout(to)
      if (code !== 0) reject(new Error('pcli_failed'))
      else resolve(out)
    })
    child.on('error', reject)
  })

const parseUmTx = (text, txid) => {
  const hits = []
  const blob = String(text || '')
  // Prefer explicit memo lines; never treat hex keys as memos.
  const lines = blob.split(/\r?\n/)
  for (const ln of lines) {
    const m = ln.match(/(?:memo|Memo)\s*[:=]\s*["']?(sezs1:[0-9a-fA-F]{64})/i)
    if (m) hits.push({ rail: 'penumbra', commitment: m[1].slice(5).toLowerCase(), txid })
  }
  if (!hits.length) {
    const all = blob.match(/sezs1:([0-9a-fA-F]{64})/g) || []
    for (const m of all) hits.push({ rail: 'penumbra', commitment: m.slice(5).toLowerCase(), txid })
  }
  return hits
}

const parseBalance = (text) => {
  const out = {}
  for (const ln of String(text || '').split(/\r?\n/)) {
    const m = ln.match(/([0-9]+(?:\.[0-9]+)?)\s*(penumbra|upenumbra|gm|gn)/i)
    if (m) {
      const denom = m[2].toLowerCase()
      out[denom] = (out[denom] || 0) + Number(m[1])
    }
  }
  return out
}

const umHomes = () => {
  const named = process.env.SEZS_UM_VIEW_HOME
  const cands = [
    named,
    join(ROOT, 'pcli/artist'),
    join(ROOT, 'pcli/dest1'),
    join(ROOT, 'pcli/seat0'),
  ].filter(Boolean)
  return [...new Set(cands.filter((c) => existsSync(join(c, 'pcli-config.toml')) || existsSync(join(c, 'config.toml')) || existsSync(c)))]
}

const scanUm = async () => {
  const hits = []
  const balances = {}
  const homes = umHomes()
  for (const home of homes) {
    const label = home.endsWith('/artist') ? 'artist' : home.endsWith('/dest1') ? 'dest1' : home.endsWith('/seat0') ? 'seat0' : 'view'
    try { await runPcli(['view', 'sync'], home) } catch {}
    try {
      const bal = await runPcli(['view', 'balance'], home)
      balances[label] = parseBalance(bal)
    } catch {
      balances[label] = null
    }
    let hashes = ''
    try {
      hashes = await runPcli(['view', 'list-transaction-hashes'], home)
    } catch {
      continue
    }
    const txids = [...new Set((hashes.match(/[0-9a-f]{64}/gi) || []).map((s) => s.toLowerCase()))]
    for (const txid of txids) {
      try {
        const body = await runPcli(['view', 'tx', txid], home)
        hits.push(...parseUmTx(body, txid))
      } catch {}
    }
  }
  return { hits, balances }
}

const uniqueHits = (hits) => {
  const out = []
  const seen = new Set()
  for (const h of hits) {
    const k = `${h.rail}:${h.txid}:${h.commitment}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(h)
  }
  return out
}

const main = async () => {
  const wantBal = process.argv.includes('--balances')
  let zec = { hits: [], ironwoodZat: null, tip: null }
  let um = { hits: [], balances: {} }
  try { zec = await scanZec() } catch (e) {
    zec.error = 'zec_scan_failed'
  }
  try { um = await scanUm() } catch (e) {
    um.error = 'um_scan_failed'
  }
  const report = {
    ok: true,
    hits: uniqueHits([...(zec.hits || []), ...(um.hits || [])]),
  }
  if (wantBal || process.env.SEZS_SCAN_BALANCES === '1') {
    report.balances = {
      zec: { ironwoodZat: zec.ironwoodZat, tip: zec.tip },
      um: um.balances || {},
    }
  }
  if (zec.error) report.zecError = zec.error
  if (um.error) report.umError = um.error
  console.log(JSON.stringify(report))
}

main().catch((e) => die(e && e.message ? 'scan_failed' : 'scan_failed'))
