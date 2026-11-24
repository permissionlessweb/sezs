#!/usr/bin/env node
/**
 * Local Zakura regtest ZEC path for SEZS payroll.
 *
 * Faucet: documented secp256k1 test key 1 (miner t-addr only). Never the treasury.
 * Treasury: 2-of-3 FROST (dealer) over the Ironwood/Orchard key tree, signed
 * via frost_spend_* / PCZT and submitted with sendrawtransaction.
 * Loopback RPC only. Secrets stay in 0600 files and are never logged.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { encodeOrchardUnifiedAddress, rawFromDebugOrHex } from './ua-encode.mjs'
import { pathToFileURL, fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const noble = () => import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'node_modules/@noble/secp256k1/index.js')).href)

const ROOT = process.env.SEZS_SESSION_ROOT || '/tmp/sezs-session-real'
const RPC = process.env.SEZS_ZAKURA_RPC || 'http://127.0.0.1:18232'
const BIND_OK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/
const FORBIDDEN = /rotko|relay\.zafu\.pro|penumbra\.zone|morocco-1|hs-preview|0\.0\.0\.0|mainnet/i
const MINER = 'tmLPctKo9j49rtCSKpwEBpLBeykiTGomGQs'
const BRANCH_NU63 = 0x37a5165b
// zafu wasm only knows mainnet/testnet upgrade tables, not Zakura regtest.
const WASM_TESTNET_IRONWOOD_HEIGHT = 4134000
const MATURITY = 100
const TREASURY_DIR = join(ROOT, 'zec-frost')
const REPORT = join(TREASURY_DIR, 'payout-report.json')

const log = (...a) => console.log('[sezs-zec]', ...a)
const die = (m) => { console.error('[sezs-zec]', m); process.exit(1) }

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

/** Documented regtest faucet key: secp256k1 secret 1. Never logged or written. */
const faucetPriv = () => {
  const b = new Uint8Array(32)
  b[31] = 1
  return b
}

const ensureTreasury = (wasm) => {
  mkdirSync(TREASURY_DIR, { recursive: true, mode: 0o700 })
  chmodSync(TREASURY_DIR, 0o700)
  const keyPath = join(TREASURY_DIR, 'dealer.json')
  if (!existsSync(keyPath)) {
    const deal = JSON.parse(wasm.frost_dealer_keygen(2, 3))
    const sk = wasm.frost_sample_fvk_sk()
    const ufvk = wasm.frost_derive_ufvk(deal.public_key_package, sk, false)
    const raw = wasm.frost_derive_address_from_sk(deal.public_key_package, sk, 0)
    const rawBytes = rawFromDebugOrHex(raw) || rawFromDebugOrHex(wasm.address_from_ufvk(ufvk, 0))
    if (!rawBytes) throw new Error('could not derive raw orchard receiver')
    const ua = encodeOrchardUnifiedAddress(rawBytes, 'uregtest')
    const rec = {
      min: 2,
      max: 3,
      public_key_package: deal.public_key_package,
      packages: deal.packages,
      fvk_sk: sk,
      ufvk,
      ua,
      raw_address_hex: raw,
    }
    writeFileSync(keyPath, JSON.stringify(rec), { mode: 0o600 })
    chmodSync(keyPath, 0o600)
    log('created 2-of-3 FROST treasury (secrets not logged)')
  }
  const rec = JSON.parse(readFileSync(keyPath, 'utf8'))
  const rawBytes = rawFromDebugOrHex(rec.raw_address_hex) || rawFromDebugOrHex(rec.ua)
  if (rawBytes) {
    const utest = encodeOrchardUnifiedAddress(rawBytes, 'utest')
    const ureg = encodeOrchardUnifiedAddress(rawBytes, 'uregtest')
    rec.ua_utest = utest
    rec.ua_uregtest = ureg
    if (!rec.ua || rec.ua.includes('orchard:') || rec.ua.startsWith('utest1')) rec.ua = ureg
    writeFileSync(keyPath, JSON.stringify({ ...rec, ua: rec.ua, ua_utest: utest, ua_uregtest: ureg }), { mode: 0o600 })
    chmodSync(keyPath, 0o600)
  }
  if (!rec.ua || rec.ua.includes('orchard:') || !rec.ufvk || !Array.isArray(rec.packages) || rec.packages.length !== 3) {
    die('treasury record incomplete')
  }
  log('treasury UA prefix', rec.ua.slice(0, 12) + '…', 'len', rec.ua.length)
  return rec
}


const compactToDer = (compact) => {
  const b = compact instanceof Uint8Array ? compact : Uint8Array.from(Buffer.from(compact, 'hex'))
  if (b.length !== 64) throw new Error('compact sig must be 64 bytes, got ' + b.length)
  const encInt = (part) => {
    let i = 0
    while (i < part.length - 1 && part[i] === 0) i++
    let v = part.slice(i)
    if (v[0] & 0x80) {
      const n = new Uint8Array(v.length + 1)
      n.set(v, 1)
      v = n
    }
    const out = new Uint8Array(2 + v.length)
    out[0] = 0x02
    out[1] = v.length
    out.set(v, 2)
    return out
  }
  const r = encInt(b.subarray(0, 32))
  const s = encInt(b.subarray(32, 64))
  const body = new Uint8Array(r.length + s.length)
  body.set(r, 0)
  body.set(s, r.length)
  const der = new Uint8Array(2 + body.length)
  der[0] = 0x30
  der[1] = body.length
  der.set(body, 2)
  return Buffer.from(der).toString('hex')
}

const signSighashes = async (sighashes, pubHex) => {
  const secp = await noble()
  const { sha256 } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'node_modules/@noble/hashes/sha2.js')).href)
  const { hmac } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'node_modules/@noble/hashes/hmac.js')).href)
  if (secp.hashes) {
    if (!secp.hashes.sha256) secp.hashes.sha256 = sha256
    if (!secp.hashes.hmacSha256) secp.hashes.hmacSha256 = (k, ...ms) => hmac(sha256, k, secp.etc && secp.etc.concatBytes ? secp.etc.concatBytes(...ms) : ms[0])
  }
  const priv = faucetPriv()
  const pub = Buffer.from(secp.getPublicKey(priv, true)).toString('hex')
  if (pub !== pubHex.toLowerCase()) die('faucet pubkey mismatch')
  const sigs = []
  for (const h of sighashes) {
    const msg = Uint8Array.from(Buffer.from(h, 'hex'))
    if (msg.length !== 32) die('sighash not 32 bytes')
    let sig
    try {
      sig = secp.sign(msg, priv, { prehash: true })
    } catch (e) {
      sig = secp.sign(msg, priv)
    }
    let compact
    if (sig && typeof sig.toCompactRawBytes === 'function') compact = sig.toCompactRawBytes()
    else if (sig && typeof sig.toBytes === 'function') compact = sig.toBytes()
    else if (sig instanceof Uint8Array) compact = sig
    else if (typeof sig === 'string') compact = Uint8Array.from(Buffer.from(sig, 'hex'))
    else if (sig && sig.r && sig.s) {
      // Signature object with bigint r,s
      const to32 = (n) => {
        const h = BigInt(n).toString(16).padStart(64, '0')
        return Buffer.from(h, 'hex')
      }
      compact = Uint8Array.from(Buffer.concat([to32(sig.r), to32(sig.s)]))
    } else die('unexpected signature type ' + typeof sig)
    if (compact.length !== 64) die('signature compact length ' + compact.length)
    let der = compactToDer(compact) + '01'
    if (der[0] !== '3' || der[1] !== '0') die('der does not start with 30')
    const pubb = Uint8Array.from(Buffer.from(pub, 'hex'))
    let okPre = false, okHash = false
    try { okPre = !!secp.verify(compact, msg, pubb, { prehash: true }) } catch (e) { log('verify_prehash_err', String(e.message||e).slice(0,80)) }
    try { okHash = !!secp.verify(compact, msg, pubb) } catch (e) { log('verify_hash_err', String(e.message||e).slice(0,80)) }
    log('sig format', 'der_len_bytes', der.length/2, 'verify_prehash', okPre, 'verify_hashed', okHash)
    sigs.push({ sig_hex: der, pubkey_hex: pub })
  }
  return sigs
}

const matureUtxos = async (n = 1) => {
  const info = await rpc('getblockchaininfo')
  const height = Number(info.blocks)
  const uts = await rpc('getaddressutxos', { addresses: [MINER] })
  const mature = (uts || []).filter((u) => Number(u.height) + MATURITY <= height)
  if (!mature.length) die(`no mature miner utxos (height=${height})`)
  return { height, branch: parseInt(String(info.consensus?.chaintip || ''), 16) || BRANCH_NU63, utxos: mature.slice(0, n) }
}

const shieldToTreasury = async (wasm, rec) => {
  const { height, branch, utxos } = await matureUtxos(1)
  const u = utxos[0]
  const value = BigInt(u.satoshis)
  const fee = wasm.zip317_shielding_fee_zat(1)
  const amount = value - fee
  if (amount <= 0n) die('utxo smaller than fee')
  const secp = await noble()
  const pub = Buffer.from(secp.getPublicKey(faucetPriv(), true)).toString('hex')
  const utxosJson = JSON.stringify([{ txid: u.txid, vout: u.outputIndex, value: String(value), script: u.script }])
  log('shielding mature coinbase', 'height', u.height, 'sats', String(value), 'fee', String(fee), 'to treasury, tip', height, 'branch', branch.toString(16))
  // wasm decodes ZIP-316 HRP u/utest only; Zakura validates uregtest. Same 43-byte receiver.
  const recipientForWasm = rec.ua_utest || rec.ua
  // Bind NU6.3 using the wasm testnet table; Zakura regtest already has NU6.3 at height 2.
  // Expiry far in the future is valid on the local node. Branch id is 0x37a5165b either way.
  const targetHeight = Math.max(height + 1, WASM_TESTNET_IRONWOOD_HEIGHT)
  const raw = wasm.build_unsigned_shielding_transaction_ironwood(
    utxosJson, pub, recipientForWasm, amount, fee, targetHeight, BRANCH_NU63, false, null, rec.ufvk,
  )
  const built = typeof raw === 'string' && raw.trim().startsWith('{') ? JSON.parse(raw) : raw
  const keys = built && typeof built === 'object' ? Object.keys(built) : []
  log('unsigned shield keys', keys.join(','))
  const unsigned = built.unsigned_tx_hex || built.pczt_hex || built
  const sighashes = built.sighashes || built.sighash || []
  if (typeof unsigned !== 'string') die('no unsigned_tx_hex')
  if (!Array.isArray(sighashes) || !sighashes.length) die('no sighashes')
  const sh0 = sighashes[0]
  log('sighash0 type', typeof sh0, 'keys', sh0 && typeof sh0 === 'object' ? Object.keys(sh0).join(',') : '', 'len', typeof sh0 === 'string' ? sh0.length : '')
  const sh = sighashes.map((x) => typeof x === 'string' ? x : (x.sighash || x.sighash_hex || x.hash || ''))
  writeFileSync(join(TREASURY_DIR, 'unsigned-shield.json'), JSON.stringify({ unsigned, sighashes: sh, pub, summary: built.summary || null }), { mode: 0o600 })
  chmodSync(join(TREASURY_DIR, 'unsigned-shield.json'), 0o600)
  const sigs = await signSighashes(sh, pub)
  const variants = [
    ['der01', sigs],
    ['der', sigs.map((s) => ({ ...s, sig_hex: s.sig_hex.replace(/01$/, '') }))],
  ]
  let txHex, lastErr
  for (const [label, payload] of variants) {
    for (const fn of ['complete_shielding_transaction', 'complete_shielding_pczt']) {
      try {
        txHex = wasm[fn](unsigned, JSON.stringify(payload))
        log('complete ok', fn, label, 'txlen', String(txHex).length)
        lastErr = null
        break
      } catch (e) {
        lastErr = e
        log('complete fail', fn, label, String(e.message || e).slice(0, 120))
      }
    }
    if (txHex) break
  }
  if (!txHex) throw lastErr || new Error('all complete variants failed')

  if (typeof txHex !== 'string' || txHex.length < 20) die('complete_shielding_transaction failed')
  const before = await rpc('getblockchaininfo')
  const txid = await rpc('sendrawtransaction', txHex)
  log('shield txid', txid)
  const gen = await rpc('generate', 1)
  log('generated', Array.isArray(gen) ? gen.length : 0, 'block(s)')
  const after = await rpc('getblockchaininfo')
  const report = {
    kind: 'shield-faucet-to-frost-ua',
    txid,
    amount_zat: String(amount),
    fee_zat: String(fee),
    tip_before: before.blocks,
    tip_after: after.blocks,
    pools_before: (before.valuePools || []).map((p) => ({ id: p.id, chainValue: p.chainValue })),
    pools_after: (after.valuePools || []).map((p) => ({ id: p.id, chainValue: p.chainValue })),
  }
  writeFileSync(join(TREASURY_DIR, 'shield.json'), JSON.stringify(report, null, 2))
  writeFileSync(join(TREASURY_DIR, 'shield.txhex'), txHex, { mode: 0o600 })
  chmodSync(join(TREASURY_DIR, 'shield.txhex'), 0o600)
  return { txid, txHex, amount, fee, report }
}

const keysOf = (v, p = '') => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.entries(v).flatMap(([k, val]) => [p + k, ...keysOf(val, p + k + '.')])
  }
  if (Array.isArray(v) && v[0] && typeof v[0] === 'object') {
    return [p + '[]', ...keysOf(v[0], p + '[].')]
  }
  return []
}

const scanShield = (wasm, rec, txHex) => {
  const bytes = new Uint8Array(Buffer.from(txHex, 'hex'))
  const wallet = wasm.WatchOnlyWallet.from_ufvk(rec.ufvk)
  let notes = null
  try { notes = wallet.decrypt_transaction_memos(bytes) } catch (e) {
    log('decrypt_transaction_memos failed', String(e.message || e).slice(0, 180))
  }
  log('decrypt type', Array.isArray(notes) ? 'array'+notes.length : typeof notes, 'keys', keysOf(notes).slice(0, 40).join(','))
  return notes
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

const main = async () => {
  const cmd = process.argv[2] || 'all'
  const wasm = await loadWasm()
  log('wasm', typeof wasm.version === 'function' ? wasm.version() : 'ok', 'pool@tip-fn(250,false)', wasm.shielding_pool_for_height(250, false), '(regtest NU6.3 uses ironwood builder anyway)')
  const rec = ensureTreasury(wasm)
  if (cmd === 'setup') { ensureRecipient(wasm); return }
  const info0 = await rpc('getblockchaininfo')
  log('zakura tip', info0.blocks, 'ironwood', (info0.valuePools || []).find((p) => p.id === 'ironwood')?.chainValue)
  const shield = await shieldToTreasury(wasm, rec)
  const notes = scanShield(wasm, rec, shield.txHex)
  writeFileSync(join(TREASURY_DIR, 'shield-notes.keys.txt'), keysOf(notes).join('\n'))
  const info1 = await rpc('getblockchaininfo')
  log('after shield ironwood', (info1.valuePools || []).find((p) => p.id === 'ironwood')?.chainValue)
  writeFileSync(REPORT, JSON.stringify({ shield: shield.report, ua_prefix: rec.ua.slice(0, 12) }, null, 2))
  log('SHIELD_TXID', shield.txid)
}

main().catch((e) => die(e.stack || e.message || String(e)))
