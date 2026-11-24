/**
 * Load Zafu's wasm-bindgen FrostRelayCipher (Noise_K) for Node and seats.
 * The official glue imports a rayon worker helper that is browser-only; this
 * loader rewrites that import to a stub and instantiates the same wasm.
 * Never logs private keys.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CANDIDATES = () => {
  const fromEnv = process.env.SEZS_ZAFU_WASM
  const home = homedir()
  return [
    fromEnv,
    join(process.env.SEZS_ZAFU_ROOT || '', 'packages/zcash-wasm'),
    join(process.env.SEZS_ZAFU_ROOT || '', 'packages/zcash-wasm'),
  ].filter(Boolean)
}

export const resolveZafuWasmDir = () => {
  for (const dir of CANDIDATES()) {
    if (existsSync(join(dir, 'zafu_wasm.js')) && existsSync(join(dir, 'zafu_wasm_bg.wasm'))) return dir
  }
  return null
}

const stubHelpers = `export async function startWorkers() {
  throw new Error('rayon workers are not used in the Node FrostRelayCipher loader')
}
`

const cacheDir = () => join(tmpdir(), `sezs-zafu-wasm-node-${process.pid}`)

let loaded = null

const materialize = (src) => {
  const dest = cacheDir()
  mkdirSync(join(dest, 'snippets/wasm-bindgen-rayon-stub/src'), { recursive: true })
  writeFileSync(join(dest, 'snippets/wasm-bindgen-rayon-stub/src/workerHelpers.js'), stubHelpers)
  let js = readFileSync(join(src, 'zafu_wasm.js'), 'utf8')
  js = js.replace(
    /import \{ startWorkers \} from '\.\/snippets\/wasm-bindgen-rayon-[^']+\/src\/workerHelpers\.js';/,
    "import { startWorkers } from './snippets/wasm-bindgen-rayon-stub/src/workerHelpers.js';",
  )
  if (js.includes('wasm-bindgen-rayon-') && !js.includes('wasm-bindgen-rayon-stub')) {
    throw new Error('zafu wasm glue import rewrite failed')
  }
  writeFileSync(join(dest, 'zafu_wasm.js'), js)
  copyFileSync(join(src, 'zafu_wasm_bg.wasm'), join(dest, 'zafu_wasm_bg.wasm'))
  return dest
}

export const loadZafuCipher = async () => {
  if (loaded) return loaded
  const src = resolveZafuWasmDir()
  if (!src) {
    throw new Error('zafu_wasm_missing: set SEZS_ZAFU_WASM to packages/zcash-wasm (FrostRelayCipher)')
  }
  const dest = materialize(src)
  const mod = await import(pathToFileURL(join(dest, 'zafu_wasm.js')).href + `?v=${Date.now()}`)
  const bytes = readFileSync(join(dest, 'zafu_wasm_bg.wasm'))
  if (typeof mod.default === 'function') {
    await mod.default({ module_or_path: bytes })
  } else if (typeof mod.initSync === 'function') {
    mod.initSync({ module: bytes })
  } else {
    throw new Error('zafu_wasm_init_missing')
  }
  loaded = { mod, src }
  return loaded
}

export const generateCipherIdentity = async () => {
  const { mod } = await loadZafuCipher()
  const raw = JSON.parse(mod.frost_relay_generate_keypair())
  if (!raw?.public || !raw?.private) throw new Error('zafu_keypair_failed')
  return { publicKey: String(raw.public), privateKey: String(raw.private) }
}

export const signRelayChallenge = async (identity, challenge) => {
  const { mod } = await loadZafuCipher()
  return String(mod.frost_relay_sign_challenge(identity.privateKey, String(challenge)))
}

export const createFrostRelayCipher = async (identity, peerPublicKeys) => {
  const { mod } = await loadZafuCipher()
  const peers = JSON.stringify((peerPublicKeys || []).map((p) => String(p)))
  const cipher = new mod.FrostRelayCipher(identity.privateKey, peers)
  return {
    publicKey: identity.publicKey,
    encrypt(recipientHex, plaintext) {
      const bytes = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext
      return cipher.encrypt(recipientHex, bytes)
    },
    decrypt(senderHex, msgHex) {
      return new TextDecoder().decode(cipher.decrypt(senderHex, msgHex))
    },
    free() {
      try { cipher.free() } catch {}
    },
  }
}

void dirname
