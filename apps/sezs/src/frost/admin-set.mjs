/**
 * Persistent 2-of-3 admin FROST set for the session (guest-root publish).
 *
 * DKG runs once per session into SEZS_ADMIN_FROST_DIR (default
 * $SEZS_SESSION_ROOT/admin-frost). Key packages stay in set.json (0600) and
 * are never printed. meta.json holds only { t, n, verifyingKey }.
 *
 * Signing uses two stored shares and sezs-frost-payroll. The verifying key is
 * registered on the event contract; the signature authorizes UpdateGuestRoot.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { frostCall } from './payroll-ceremony.mjs'

export const DEFAULT_T = 2
export const DEFAULT_N = 3

export const adminDirOf = (dir) =>
  dir || process.env.SEZS_ADMIN_FROST_DIR || (process.env.SEZS_SESSION_ROOT ? join(process.env.SEZS_SESSION_ROOT, 'admin-frost') : '')

const writeAtomic = (path, data, mode = 0o600) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data, { mode })
  renameSync(tmp, path)
  try { chmodSync(path, mode) } catch {}
}

const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

export const guestRootMessageHex = ({ contract, epoch, leafCount, root }) => {
  const u32 = (n) => {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(Number(n) >>> 0)
    return b
  }
  const rootHex = String(root || '').trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/.test(rootHex)) throw new Error('guest-root message: root must be 32-byte hex')
  if (!contract) throw new Error('guest-root message: contract is required')
  return Buffer.concat([
    Buffer.from('sezs-guest-root-v1'),
    Buffer.from(String(contract)),
    u32(epoch),
    u32(leafCount),
    Buffer.from(rootHex, 'hex'),
  ]).toString('hex')
}

const hexOf = (value, fallback) => {
  if (typeof fallback === 'string' && /^[0-9a-f]+$/i.test(fallback) && fallback.length >= 64) {
    return fallback.toLowerCase()
  }
  if (typeof value === 'string' && /^[0-9a-f]+$/i.test(value) && value.length >= 64) {
    return value.toLowerCase()
  }
  if (value && typeof value === 'object' && typeof value.bytes === 'string') {
    return String(value.bytes).toLowerCase()
  }
  return ''
}

/** Run a fresh 2-of-3 DKG and persist the set. Returns public metadata only. */
export const dkgAdminSet = async ({ dir, t = DEFAULT_T, n = DEFAULT_N } = {}) => {
  const root = adminDirOf(dir)
  if (!root) throw new Error('admin FROST dir is not set (SEZS_ADMIN_FROST_DIR or SEZS_SESSION_ROOT)')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  const round1 = {}
  const secrets1 = {}
  for (let id = 1; id <= n; id++) {
    const r = await frostCall({ op: 'part1', id, t, n })
    secrets1[id] = r.secret
    round1[id] = r.package
  }
  const secrets2 = {}
  const packages2 = {}
  for (let id = 1; id <= n; id++) {
    const packages = {}
    for (let j = 1; j <= n; j++) {
      if (j !== id) packages[String(j)] = round1[j]
    }
    const r = await frostCall({ op: 'part2', id, n, secret: secrets1[id], packages })
    secrets2[id] = r.secret
    packages2[id] = r.packages
  }
  const keyPackages = {}
  let pubkeyPackage = null
  let verifyingKey = ''
  for (let id = 1; id <= n; id++) {
    const round2 = {}
    for (let j = 1; j <= n; j++) {
      if (j === id) continue
      const pkg = packages2[j]?.[String(id)]
      if (!pkg) throw new Error(`admin DKG missing round-2 package for ${id} from ${j}`)
      round2[String(j)] = pkg
    }
    const r1 = {}
    for (let j = 1; j <= n; j++) {
      if (j !== id) r1[String(j)] = round1[j]
    }
    const r = await frostCall({
      op: 'part3',
      id,
      secret: secrets2[id],
      round1: r1,
      round2,
    })
    keyPackages[String(id)] = r.key_package
    pubkeyPackage = r.pubkey_package
    verifyingKey = hexOf(r.verifying_key, r.verifying_key_hex) || verifyingKey
  }
  if (!verifyingKey && pubkeyPackage) {
    const exp = await frostCall({ op: 'export_vk', pubkey_package: pubkeyPackage }).catch(() => null)
    verifyingKey = hexOf(null, exp?.verifying_key_hex) || verifyingKey
  }
  if (!/^[0-9a-f]{64}$/i.test(verifyingKey)) {
    throw new Error('admin DKG did not export a 32-byte verifying key')
  }
  writeAtomic(join(root, 'set.json'), JSON.stringify({
    t, n, verifyingKey: verifyingKey.toLowerCase(), pubkeyPackage, packages: keyPackages,
  }) + '\n', 0o600)
  const meta = { t, n, verifyingKey: verifyingKey.toLowerCase(), createdAt: Date.now() }
  writeAtomic(join(root, 'meta.json'), JSON.stringify(meta) + '\n', 0o600)
  return meta
}

export const loadAdminMeta = (dir) => {
  const root = adminDirOf(dir)
  if (!root) return null
  return readJson(join(root, 'meta.json'))
}

export const adminSetReady = (dir) => {
  const root = adminDirOf(dir)
  if (!root) return false
  const meta = readJson(join(root, 'meta.json'))
  const set = existsSync(join(root, 'set.json'))
  return !!(set && meta?.verifyingKey && /^[0-9a-f]{64}$/i.test(meta.verifyingKey))
}

/** Sign a hex-encoded message with any `t` stored shares (ids 1..t). Public fields only. */
export const signAdminSet = async ({ dir, messageHex, signers } = {}) => {
  const root = adminDirOf(dir)
  if (!root) throw new Error('admin FROST dir is not set')
  const set = readJson(join(root, 'set.json'))
  if (!set?.packages || !set?.pubkeyPackage) throw new Error('admin FROST set is missing')
  const t = Number(set.t || DEFAULT_T)
  const ids = signers && signers.length ? signers : Array.from({ length: t }, (_, i) => i + 1)
  if (ids.length < t) throw new Error('not enough admin signers')
  if (!/^[0-9a-f]+$/i.test(String(messageHex || ''))) throw new Error('message must be hex')
  const commitments = {}
  const nonces = {}
  for (const id of ids) {
    const key_package = set.packages[String(id)]
    if (!key_package) throw new Error(`missing admin share ${id}`)
    const r = await frostCall({ op: 'sign1', key_package })
    commitments[String(id)] = r.commitments
    nonces[id] = r.nonces
  }
  const shares = {}
  for (const id of ids) {
    const r = await frostCall({
      op: 'sign2',
      key_package: set.packages[String(id)],
      nonces: nonces[id],
      commitments,
      message: String(messageHex),
    })
    shares[String(id)] = r.share
  }
  const agg = await frostCall({
    op: 'aggregate',
    pubkey_package: set.pubkeyPackage,
    commitments,
    shares,
    message: String(messageHex),
  })
  const signatureHex = hexOf(agg.signature, agg.signature_hex)
  const verifyingKey = hexOf(agg.verifying_key, agg.verifying_key_hex) || set.verifyingKey
  if (!signatureHex || signatureHex.length < 128) throw new Error('admin FROST aggregate did not return a signature')
  return {
    ok: true,
    signatureHex: signatureHex.slice(0, 128),
    verifyingKey,
    t: set.t,
    n: set.n,
  }
}

const isCli = () => {
  try {
    const self = fileURLToPath(import.meta.url)
    const argv1 = process.argv[1] && Pathish(process.argv[1])
    return argv1 && self === argv1
  } catch {
    return false
  }
}

const Pathish = (p) => {
  try { return PathFrom(p) } catch { return p }
}

const PathFrom = (p) => {
  const { realpathSync } = waitFs()
  try { return realpathSync(p) } catch { return p }
}

const waitFs = () => ({ realpathSync: (awaitImportFs()).realpathSync })

const awaitImportFs = () => {
  // sync import already at top; this is only for realpath in CLI compare
  return { realpathSync: (p) => p }
}

const runCli = async () => {
  const args = process.argv.slice(2)
  const opt = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === 'dkg' || a === 'sign' || a === 'meta') opt.cmd = a
    else if (a === '--dir') opt.dir = args[++i]
    else if (a === '--message') opt.message = args[++i]
    else if (a === '--t') opt.t = Number(args[++i])
    else if (a === '--n') opt.n = Number(args[++i])
  }
  if (opt.cmd === 'dkg') {
    const meta = await dkgAdminSet({ dir: opt.dir, t: opt.t, n: opt.n })
    process.stdout.write(JSON.stringify({ ok: true, t: meta.t, n: meta.n, verifyingKey: meta.verifyingKey }) + '\n')
    return
  }
  if (opt.cmd === 'sign') {
    const r = await signAdminSet({ dir: opt.dir, messageHex: opt.message })
    process.stdout.write(JSON.stringify({
      ok: true, signatureHex: r.signatureHex, verifyingKey: r.verifyingKey, t: r.t, n: r.n,
    }) + '\n')
    return
  }
  if (opt.cmd === 'meta') {
    const meta = loadAdminMeta(opt.dir)
    if (!meta) {
      process.stdout.write(JSON.stringify({ ok: false, error: 'no_admin_set' }) + '\n')
      process.exitCode = 1
      return
    }
    process.stdout.write(JSON.stringify({ ok: true, t: meta.t, n: meta.n, verifyingKey: meta.verifyingKey }) + '\n')
    return
  }
  process.stderr.write('Usage: node admin-set.mjs dkg|sign|meta --dir DIR [--message HEX]\n')
  process.exit(2)
}

const invoked = () => {
  try {
    const self = fileURLToPath(import.meta.url)
    const given = process.argv[1]
    if (!given) return false
    return join(given) === self || given.endsWith('admin-set.mjs')
  } catch {
    return false
  }
}

if (invoked()) {
  runCli().catch((err) => {
    process.stderr.write(`${err.message || String(err)}\n`)
    process.exit(1)
  })
}
