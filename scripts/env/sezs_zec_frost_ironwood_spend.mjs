#!/usr/bin/env node
/**
 * Spend Ironwood coinbase notes already paid to the session FROST treasury UA.
 * 2-of-3 frost_spend_* + complete_ironwood_pczt + sendrawtransaction.
 * Loopback only. Secrets stay in 0600 files and are never logged.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { encodeOrchardUnifiedAddress, rawFromDebugOrHex, uaForWasm } from './ua-encode.mjs'

const ROOT = process.env.SEZS_SESSION_ROOT || '/tmp/sezs-session-real'
const RPC = process.env.SEZS_ZAKURA_RPC || 'http://127.0.0.1:18232'
const BIND_OK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/
const FORBIDDEN = /rotko|relay\.zafu\.pro|penumbra\.zone|morocco-1|hs-preview|0\.0\.0\.0|mainnet/i
const BRANCH_NU63 = 0x37a5165b
const WASM_TESTNET_IRONWOOD_HEIGHT = 4134000
const ACTION_SIZE = 148
const TREASURY_DIR = join(ROOT, 'zec-frost')
const DEST_ENV = process.env.SEZS_ZEC_DEST || ''
const AMOUNT_ZAT = BigInt(process.env.SEZS_ZEC_AMOUNT_ZAT || '100000000')
const MEMO_TEXT = process.env.SEZS_ZEC_MEMO || 'sezs1'

const REPORT = join(TREASURY_DIR, 'ironwood-payout-report.json')
const HERE = dirname(fileURLToPath(import.meta.url))

const log = (...a) => console.log('[sezs-zec-spend]', ...a)
const die = (m) => { console.error('[sezs-zec-spend]', m); process.exit(1) }
const keysOf = (v, p = '') => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.entries(v).flatMap(([k, val]) => [p + k, ...keysOf(val, p + k + '.')])
  }
  if (Array.isArray(v) && v[0] && typeof v[0] === 'object') {
    return [p + '[]', ...keysOf(v[0], p + '[].')]
  }
  return []
}

if (!BIND_OK.test(RPC) || FORBIDDEN.test(RPC)) die('refusing non-loopback or public RPC')

const rpc = async (method, ...params) => {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'sezs-zec', method, params }),
  })
  const j = await res.json()
  if (j.error) throw new Error(`${method}: ${j.error.message || JSON.stringify(j.error)}`)
  return j.result
}

const loadWasm = async () => {
  const src = process.env.SEZS_ZAFU_WASM
    || join(process.env.SEZS_ZAFU_ROOT || '', 'packages/zcash-wasm')
  if (!existsSync(join(src, 'zafu_wasm.js'))) die('zafu wasm missing')
  const dest = join(tmpdir(), `sezs-zafu-wasm-node-${process.pid}`)
  mkdirSync(join(dest, 'snippets/wasm-bindgen-rayon-stub/src'), { recursive: true })
  writeFileSync(join(dest, 'snippets/wasm-bindgen-rayon-stub/src/workerHelpers.js'),
    'export async function startWorkers() { throw new Error("no rayon") }\n')
  let js = readFileSync(join(src, 'zafu_wasm.js'), 'utf8')
  js = js.replace(
    /import \{ startWorkers \} from '\.\/snippets\/wasm-bindgen-rayon-[^']+\/src\/workerHelpers\.js';/,
    "import { startWorkers } from './snippets/wasm-bindgen-rayon-stub/src/workerHelpers.js';",
  )
  if (js.includes('wasm-bindgen-rayon-') && !js.includes('wasm-bindgen-rayon-stub')) {
    die('zafu wasm glue import rewrite failed')
  }
  writeFileSync(join(dest, 'zafu_wasm.js'), js)
  copyFileSync(join(src, 'zafu_wasm_bg.wasm'), join(dest, 'zafu_wasm_bg.wasm'))
  const mod = await import(pathToFileURL(join(dest, 'zafu_wasm.js')).href + `?v=${Date.now()}`)
  const bytes = readFileSync(join(dest, 'zafu_wasm_bg.wasm'))
  if (typeof mod.initSync === 'function') mod.initSync({ module: bytes })
  else die('zafu_wasm_init_missing')
  return mod
}

const loadTreasury = () => {
  const keyPath = join(TREASURY_DIR, 'dealer.json')
  if (!existsSync(keyPath)) die('missing FROST dealer record')
  const rec = JSON.parse(readFileSync(keyPath, 'utf8'))
  if (!rec.ufvk || !Array.isArray(rec.packages) || rec.packages.length !== 3 || !rec.public_key_package) {
    die('treasury record incomplete')
  }
  log('treasury UA prefix', String(rec.ua || rec.ua_uregtest || '').slice(0, 12) + '…')
  return rec
}


const unwrapKeyPackage = (pkgHex) => {
  // frost_dealer_keygen stores each share as hex(JSON({ pk, sig, payload })),
  // and payload is hex(JSON({ ephemeral_seed, key_package, public_key_package })).
  const env = JSON.parse(Buffer.from(String(pkgHex), 'hex').toString('utf8'))
  if (!env || typeof env !== 'object') die('key package envelope missing')
  const innerHex = env.key_package || env.payload || pkgHex
  let keyPackage = innerHex
  let storedSeed = env.ephemeral_seed || null
  if (env.payload && typeof env.payload === 'string') {
    const inner = JSON.parse(Buffer.from(env.payload, 'hex').toString('utf8'))
    keyPackage = inner.key_package || innerHex
    storedSeed = inner.ephemeral_seed || storedSeed
  }
  if (!keyPackage) die('inner key_package missing')
  return { keyPackage, storedSeed }
}

const hexToBytes = (h) => Uint8Array.from(Buffer.from(String(h).replace(/^0x/, ''), 'hex'))
const memoSezs1 = () => {
  const buf = Buffer.alloc(512, 0)
  buf[0] = 0xf6
  buf.write(String(MEMO_TEXT).slice(0, 510), 1, 'utf8')
  return buf.toString('hex')
}

const ensureRecipient = (wasm) => {
  const path = join(TREASURY_DIR, 'payout-recipient.json')
  if (!existsSync(path)) {
    const phrase = wasm.generate_seed_phrase()
    const wk = new wasm.WalletKeys(phrase, 0, false)
    const raw = rawFromDebugOrHex(wk.get_receiving_address(false)) || rawFromDebugOrHex(wk.get_receiving_address(false))
    if (!raw) {
      // address_from_ufvk fallback
      const ufvk = typeof wk.ufvk === 'function' ? wk.ufvk() : null
      const alt = ufvk ? rawFromDebugOrHex(wasm.address_from_ufvk(ufvk, 0)) : null
      if (!alt) die('could not derive payout recipient raw address')
      const rec = {
        ufvk,
        ua_utest: encodeOrchardUnifiedAddress(alt, 'utest'),
        ua_uregtest: encodeOrchardUnifiedAddress(alt, 'uregtest'),
        phrase,
      }
      writeFileSync(path, JSON.stringify(rec), { mode: 0o600 })
      chmodSync(path, 0o600)
      wk.free()
      log('created payout recipient UA (secrets not logged)')
      return rec
    }
    const rec = {
      ua_utest: encodeOrchardUnifiedAddress(raw, 'utest'),
      ua_uregtest: encodeOrchardUnifiedAddress(raw, 'uregtest'),
      phrase,
    }
    writeFileSync(path, JSON.stringify(rec), { mode: 0o600 })
    chmodSync(path, 0o600)
    wk.free()
    log('created payout recipient UA (secrets not logged)')
    return rec
  }
  const rec = JSON.parse(readFileSync(path, 'utf8'))
  if (!rec.ua_utest || !rec.ua_uregtest) die('payout recipient record incomplete')
  log('payout recipient UA prefix', rec.ua_uregtest.slice(0, 12) + '…')
  return rec
}

const packActions = (actions) => {
  const buf = new Uint8Array(4 + actions.length * ACTION_SIZE)
  const view = new DataView(buf.buffer)
  view.setUint32(0, actions.length, true)
  let off = 4
  for (const a of actions) {
    const nf = hexToBytes(a.nullifier)
    const cmx = hexToBytes(a.cmx)
    const epk = hexToBytes(a.ephemeralKey)
    const ct = hexToBytes(a.encCiphertext)
    if (nf.length !== 32 || cmx.length !== 32 || epk.length !== 32 || ct.length < 52) {
      die(`compact action field length nf=${nf.length} cmx=${cmx.length} epk=${epk.length} ct=${ct.length}`)
    }
    buf.set(nf, off); off += 32
    buf.set(cmx, off); off += 32
    buf.set(epk, off); off += 32
    buf.set(ct.subarray(0, 52), off); off += 52
  }
  return buf
}

const scanTreasuryNotes = (wasm, rec) => {
  const wallet = wasm.WatchOnlyWallet.from_ufvk(rec.ufvk)
  return wallet
}

const main = async () => {
  const wasm = await loadWasm()
  log('wasm', typeof wasm.version === 'function' ? wasm.version() : 'ok')
  if (typeof wasm.scan_actions_ironwood_parallel !== 'function' && !wasm.WatchOnlyWallet) {
    die('wasm missing WatchOnlyWallet')
  }
  const rec = loadTreasury()
  const info = await rpc('getblockchaininfo')
  const tip = Number(info.blocks)
  const pools = Object.fromEntries((info.valuePools || []).map((p) => [p.id, p.chainValue]))
  log('zakura tip', tip, 'ironwood', pools.ironwood, 'transparent', pools.transparent)

  // Collect ironwood coinbase actions (heights 4..tip, public chain data).
  const actions = []
  const cmxsByHeight = []
  for (let h = 1; h <= tip; h++) {
    const block = await rpc('getblock', String(h), 2)
    for (const tx of block.tx || []) {
      const iwActs = (tx.ironwood && tx.ironwood.actions) || []
      if (!iwActs.length) continue
      const vb = tx.ironwood.valueBalance
      log('ironwood bundle height', h, 'txid', String(tx.txid).slice(0, 16), 'n', iwActs.length, 'valueBalance', vb)
      for (const a of iwActs) {
        actions.push({ ...a, height: h, txid: tx.txid })
        cmxsByHeight.push({ height: h, cmx_hex: a.cmx })
      }
    }
  }
  log('ironwood actions collected', actions.length)
  if (!actions.length) die('no ironwood actions on chain')

  const wallet = wasm.WatchOnlyWallet.from_ufvk(rec.ufvk)
  const packed = packActions(actions)
  let found = []
  try {
    found = wallet.scan_actions_ironwood_parallel(packed)
  } catch (e) {
    log('scan_actions_ironwood_parallel failed', String(e.message || e).slice(0, 240))
  }
  if (typeof found === 'string' && found.trim().startsWith('[')) found = JSON.parse(found)
  log('scan result type', Array.isArray(found) ? 'array'+found.length : typeof found, 'keys', keysOf(found).slice(0, 30).join(','))
  if (Array.isArray(found) && found[0]) {
    const n0 = found[0]
    log('note0 fields', Object.keys(n0).join(','), 'value', n0.value, 'pool', n0.pool, 'has_rseed', !!(n0.rseed || n0.rseed_hex), 'has_rho', !!(n0.rho || n0.rho_hex), 'has_recipient', !!(n0.recipient || n0.recipient_hex))
  }

  // Also try decrypt of each ironwood coinbase raw tx (for memo / extra fields).
  for (const a of actions) {
    try {
      const raw = await rpc('getrawtransaction', a.txid)
      const memos = wallet.decrypt_transaction_memos(hexToBytes(raw))
      const arr = typeof memos === 'string' ? JSON.parse(memos) : memos
      log('decrypt tx', String(a.txid).slice(0, 16), 'type', Array.isArray(arr) ? 'array'+arr.length : typeof arr, 'keys', keysOf(arr).slice(0, 20).join(','))
      if (Array.isArray(arr) && arr[0]) log('decrypt0 fields', Object.keys(arr[0]).join(','), 'value', arr[0].value, 'is_outgoing', arr[0].is_outgoing)
    } catch (e) {
      log('decrypt failed', String(a.txid).slice(0, 16), String(e.message || e).slice(0, 180))
    }
  }

  if (!Array.isArray(found) || !found.length) {
    die('watch-only scan found no ironwood notes for the FROST UFVK (coinbase may be un-decryptable with this wasm)')
  }

  // Assign positions by appearance order in the ironwood tree (one output action per coinbase).
  const notes = found.map((n, i) => {
    const position = Number(n.position ?? n.index ?? i)
    return {
      value: Number(n.value),
      nullifier: n.nullifier,
      cmx: n.cmx,
      position,
      rseed_hex: n.rseed_hex || n.rseed || '',
      rho_hex: n.rho_hex || n.rho || '',
      recipient_hex: n.recipient_hex || n.recipient || '',
      pool: n.pool || 'ironwood',
    }
  })
  const nfHex = (v) => String(v || '').toLowerCase().replace(/^0x/, '')
  const spentNf = new Set(actions.map((a) => nfHex(a.nullifier || a.nf)).filter((s) => /^[0-9a-f]{64}$/.test(s)))
  const unspent = notes.filter((n) => !spentNf.has(nfHex(n.nullifier)))
  log('spendable notes', unspent.length, 'of', notes.length, 'values_zat', unspent.map((n) => n.value).join(','), 'positions', unspent.map((n) => n.position).join(','))
  notes.length = 0
  notes.push(...unspent)
  const total = notes.reduce((s, n) => s + n.value, 0)
  log('unspent total_zat', total)
  if (notes.some((n) => !n.rseed_hex || !n.rho_hex || !n.recipient_hex)) {
    die('scanned notes missing rseed/rho/recipient; cannot build a spend')
  }

  // Merkle paths: start from the ironwood frontier BEFORE the first
  // ironwood commitment (genesis / height 0 when NU6.3 activates at 1,
  // otherwise the block just before the first ironwood coinbase), then
  // replay every subsequent cmx so early positions are found.
  const firstIwH = Math.min(...cmxsByHeight.map((x) => x.height))
  const frontierHeight = Math.max(0, firstIwH - 1)
  const hashFrontier = (await rpc('getblock', String(frontierHeight), 1)).hash
  const tsFrontier = await rpc('z_gettreestate', hashFrontier)
  let frontier = tsFrontier?.ironwood?.commitments?.finalState
  if (!frontier) {
    // z_gettreestate leaves ironwood.commitments empty before the first
    // ironwood action. Unused shielded pools encode the empty tree as 000000.
    frontier = '000000'
    log('using empty ironwood frontier encoding at height', frontierHeight)
  }
  log('ironwood merkle frontier height', frontierHeight, 'first_iw', firstIwH)
  const compactBlocks = []
  const byH = new Map()
  for (const { height, cmx_hex } of cmxsByHeight) {
    if (!byH.has(height)) byH.set(height, [])
    byH.get(height).push({ cmx_hex })
  }
  for (const [height, acts] of [...byH.entries()].sort((a, b) => a[0] - b[0])) {
    compactBlocks.push({ height, actions: acts })
  }
  const lastIw = Math.max(...cmxsByHeight.map((x) => x.height))
  const pathRaw = wasm.build_merkle_paths_ironwood(
    frontier,
    JSON.stringify(compactBlocks),
    JSON.stringify(notes.map((n) => n.position)),
    lastIw,
  )
  const pathsObj = typeof pathRaw === 'string' ? JSON.parse(pathRaw) : pathRaw
  log('merkle keys', keysOf(pathsObj).slice(0, 20).join(','), 'anchor_len', String(pathsObj.anchor_hex || pathsObj.anchor || '').length, 'n_paths', (pathsObj.paths || []).length)
  const anchorHex = pathsObj.anchor_hex || pathsObj.anchor
  const hashTip = (await rpc('getblock', String(tip), 1)).hash
  const tsTip = await rpc('z_gettreestate', hashTip)
  const tipRoot = tsTip?.ironwood?.commitments?.finalRoot
  log('anchor vs tip finalRoot equal', String(anchorHex || '').toLowerCase() === String(tipRoot || '').toLowerCase(), 'tipRoot_len', String(tipRoot || '').length)
  const iwPaths = (pathsObj.paths || []).map((p) => ({
    path: (p.path || []).map((e) => (typeof e === 'string' ? e : e.hash)),
    position: p.position,
  }))

  let recipientForWasm
  if (DEST_ENV) {
    recipientForWasm = uaForWasm(DEST_ENV)
    if (!recipientForWasm || !(String(recipientForWasm).startsWith('utest1') || String(recipientForWasm).startsWith('u1'))) {
      die('SEZS_ZEC_DEST is not a unified address the wasm can decode')
    }
    log('using SEZS_ZEC_DEST (re-encoded for wasm, not printed)')
  } else {
    const dest = ensureRecipient(wasm)
    recipientForWasm = dest.ua_utest
  }
  const selected = notes[0]
  const fee = 10000n
  const amount = AMOUNT_ZAT
  if (amount <= 0n) die('amount must be positive')
  if (BigInt(selected.value) <= amount + fee) die('selected note too small')
  const selectedPaths = iwPaths.filter((p) => Number(p.position) === Number(selected.position))
  if (selectedPaths.length !== 1) die('expected one merkle path for the selected note, got ' + selectedPaths.length)
  // wasm only ships mainnet/testnet upgrade tables, not Zakura regtest
  // (NU6.3 at height 2). Height 4134000 is testnet NU6.3, so the builder
  // binds branch 0x37a5165b. Expiry is far in the future; the node still
  // validates the tx under the already-active NU6.3 rules.
  const targetHeight = Math.max(tip, WASM_TESTNET_IRONWOOD_HEIGHT)
  log('building ironwood send', 'amount_zat', String(amount), 'fee', String(fee), 'target_height', targetHeight, 'tip', tip, 'branch', BRANCH_NU63.toString(16), 'position', selected.position)
  const t0 = Date.now()
  let built
  try {
    built = wasm.build_ironwood_send_pczt(
      rec.ufvk,
      JSON.stringify([selected]),
      recipientForWasm,
      amount,
      fee,
      anchorHex,
      JSON.stringify(selectedPaths),
      0,
      targetHeight,
      BRANCH_NU63,
      false,
      memoSezs1(),
      null,
    )
  } catch (e) {
    die('build_ironwood_send_pczt failed: ' + String(e.message || e).slice(0, 400))
  }
  built = typeof built === 'string' && built.trim().startsWith('{') ? JSON.parse(built) : built
  log('builder keys', keysOf(built).slice(0, 40).join(','), 'elapsed_s', ((Date.now() - t0) / 1000).toFixed(1))
  const pcztHex = built.retained_pczt_hex || built.pczt_hex
  const sighash = built.sighash || built.sighash_hex
  const alphas = built.alphas || built.alpha || []
  const spendIndices = built.spend_indices || built.spendIndices || [0]
  if (!pcztHex || !sighash) die('builder missing pczt or sighash')
  log('pczt_len_hex', String(pcztHex).length, 'sighash_len', String(sighash).length, 'n_alphas', alphas.length, 'spend_indices', JSON.stringify(spendIndices), 'expiry', built.expiry_height)

  // 2-of-3 FROST over each spend alpha.
  const pkgs = rec.packages.slice(0, 2)
  const aggregated = []
  for (let i = 0; i < alphas.length; i++) {
    const alpha = alphas[i]
    const r1 = pkgs.map((pkg) => {
      const un = unwrapKeyPackage(pkg)
      // The dealer identity seed MUST be used: commitment identifiers are
      // derived from that VK, and they must match the KeyPackage identifier.
      if (!un.storedSeed) die('dealer package missing ephemeral_seed')
      const raw = wasm.frost_sign_round1(un.storedSeed, un.keyPackage)
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      return { pkg: un.keyPackage, seed: un.storedSeed, nonces: parsed.nonces, commitments: parsed.commitments }
    })
    log('round1 keys', keysOf(r1[0]).filter((k) => k !== 'pkg' && k !== 'seed' && k !== 'nonces' && k !== 'commitments').join(',') || 'nonces+commitments', 'commit_len', String(r1[0].commitments || '').length)
    const commitmentsJson = JSON.stringify(r1.map((x) => x.commitments))
    const shares = r1.map((x) => wasm.frost_spend_sign_round2(
      x.pkg, x.nonces, sighash, alpha, commitmentsJson,
    ))
    log('share lens', shares.map((s) => String(s).length).join(','))
    const sig = wasm.frost_spend_aggregate(
      rec.public_key_package, sighash, alpha, commitmentsJson, JSON.stringify(shares),
    )
    log('aggregated sig len', String(sig).length)
    aggregated.push(sig)
  }

  let completed
  try {
    completed = wasm.complete_ironwood_pczt(pcztHex, JSON.stringify(aggregated), JSON.stringify(spendIndices))
  } catch (e) {
    // some builds take arrays not JSON strings
    try {
      completed = wasm.complete_ironwood_pczt(pcztHex, aggregated, spendIndices)
    } catch (e2) {
      die('complete_ironwood_pczt failed: ' + String(e.message || e).slice(0, 240) + ' / ' + String(e2.message || e2).slice(0, 240))
    }
  }
  // complete may already return tx hex, or a pczt to extract
  let txHex = completed
  if (typeof wasm.extract_signed_tx_from_pczt === 'function') {
    try {
      const extracted = wasm.extract_signed_tx_from_pczt(completed)
      if (typeof extracted === 'string' && extracted.length > 20) txHex = extracted
    } catch (e) {
      log('extract_signed_tx_from_pczt skipped', String(e.message || e).slice(0, 160))
    }
  }
  if (typeof txHex !== 'string' || txHex.length < 20) die('no signed tx hex')
  log('signed tx hex chars', txHex.length)

  const txid = await rpc('sendrawtransaction', txHex)
  log('PAYOUT_TXID', txid)
  try {
    await rpc('generate', 1)
  } catch (e) {
    log('generate after payout failed', String(e.message || e).slice(0, 160))
  }
  const info1 = await rpc('getblockchaininfo')
  const pools1 = Object.fromEntries((info1.valuePools || []).map((p) => [p.id, p.chainValue]))
  log('after payout tip', info1.blocks, 'ironwood', pools1.ironwood, 'transparent', pools1.transparent)

  const report = {
    payout_txid: txid,
    amount_zat: String(amount),
    fee_zat: String(fee),
    memo: MEMO_TEXT,
    notes_spent: 1,
    notes_scanned: notes.length,
    note_values_zat: notes.map((n) => n.value),
    tip_before: tip,
    tip_after: info1.blocks,
    ironwood_before: pools.ironwood,
    ironwood_after: pools1.ironwood,
    expiry_height: built.expiry_height ?? null,
    spend_indices: spendIndices,
  }
  writeFileSync(REPORT, JSON.stringify(report, null, 2), { mode: 0o600 })
  chmodSync(REPORT, 0o600)
  log('wrote', REPORT)
}

main().catch((e) => die(e.stack || e.message || String(e)))
