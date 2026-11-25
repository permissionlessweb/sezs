/**
 * Browser-key sign-in — the permissionless.money mint pattern, moved to sign-in.
 *
 *   1. Passkey (P-256 + PRF) is created on this device.
 *   2. A fresh 24-word ROOT mnemonic is generated in memory. Its terp1 address
 *      is the account being registered. It is never written to storage.
 *   3. A separate BROWSER key (secp256k1) is generated and sealed to the
 *      passkey's PRF output (AES-GCM). Only the sealed blob is stored.
 *   4. The root key pre-signs ONE tx: MsgAddAuthenticator(PartitionedAllOf[
 *        CosmwasmAuthenticatorV1(terp-passkey instance for this passkey),
 *        SignatureVerification(browser pubkey) ]) with the desk as fee granter.
 *   5. After the chain shows that authenticator on the account, the root key is
 *      dropped. Day-to-day signing is passkey + browser key together.
 *
 * Why two keys: classic signing still works for an account's own key. If the key
 * kept in the browser were the account key, a leak alone would own the account.
 *
 * Nothing here marks paid. A registered account is a sign-in, not a ticket.
 */
import { CHAIN, PASSKEY_AUTH_CONTRACT, REGISTER_DESK, isTerp1 } from './chainConfig'
import { PRF_UNSUPPORTED } from './passkeyKey'
import {
  b64,
  buildRegisterPlan,
  encodeAuthInfo,
  encodeMsgAddAuthenticator,
  encodeTxBody,
  encodeTxRaw,
  fromB64,
  MSG_ADD_AUTHENTICATOR,
  PARTITIONED_ALL_OF,
  PasskeyParams,
  RegisterPlan,
} from './smartAccountTx'

// ── CosmJS (CDN, same loader pattern as permissionless.money) ─────────────

const PROTO_SIGNING_URLS = [
  'https://esm.sh/@cosmjs/proto-signing@0.32.4?bundle',
  'https://cdn.jsdelivr.net/npm/@cosmjs/proto-signing@0.32.4/+esm',
]

type HdWallet = {
  mnemonic: string
  getAccounts: () => Promise<{ address: string; pubkey: Uint8Array }[]>
  signDirect: (
    addr: string,
    doc: { bodyBytes: Uint8Array; authInfoBytes: Uint8Array; chainId: string; accountNumber: bigint }
  ) => Promise<{ signature: { signature: string } }>
}
type CosmJs = {
  DirectSecp256k1HdWallet: { generate: (n: 24, o: { prefix: string }) => Promise<HdWallet> }
  DirectSecp256k1Wallet: { fromKey: (k: Uint8Array, prefix: string) => Promise<HdWallet> }
}

let cosmjs: Promise<CosmJs> | null = null
function loadCosmJs(): Promise<CosmJs> {
  if (cosmjs) return cosmjs
  cosmjs = (async () => {
    let last: unknown
    for (const url of PROTO_SIGNING_URLS) {
      try {
        const mod = await import(/* webpackIgnore: true */ url)
        const m = (mod?.DirectSecp256k1HdWallet ? mod : mod?.default) as Record<string, any> | undefined
        if (
          typeof m?.DirectSecp256k1HdWallet?.generate === 'function' &&
          typeof m?.DirectSecp256k1Wallet?.fromKey === 'function'
        ) {
          return m as unknown as CosmJs
        }
        last = new Error(`wallet classes missing from ${url}`)
      } catch (e) {
        last = e
      }
    }
    cosmjs = null
    throw new Error(`Couldn’t load the signing library. ${last instanceof Error ? last.message : ''}`.trim())
  })()
  return cosmjs
}

// ── sealed browser key (PRF → AES-GCM) ────────────────────────────────────

const SEAL_KEY = 'sezs-browser-key-v1'

type Sealed = { address: string; credId: string; pubkey: string; iv: string; ct: string }

async function aes(prf: Uint8Array) {
  if (prf.length < 32) throw new Error('Passkey seal key is too short.')
  return crypto.subtle.importKey('raw', prf.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
const aad = (address: string, credId: string) => new TextEncoder().encode(`${address}|${credId}`)

async function seal(priv: Uint8Array, prf: Uint8Array, address: string, credId: string, pubkey: Uint8Array): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(address, credId) }, await aes(prf), priv)
  )
  return { address, credId, pubkey: b64(pubkey), iv: b64(iv), ct: b64(ct) }
}

function readSealed(): Sealed[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEAL_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}
function writeSealed(rec: Sealed) {
  const rest = readSealed().filter((r) => r.address !== rec.address)
  localStorage.setItem(SEAL_KEY, JSON.stringify([rec, ...rest].slice(0, 6)))
}
export function forgetSealed(address: string) {
  localStorage.setItem(SEAL_KEY, JSON.stringify(readSealed().filter((r) => r.address !== address)))
}

/** Open the sealed browser key with the passkey's PRF output. Returns a signer, keeps nothing. */
export async function openBrowserKey(address: string, prf: Uint8Array): Promise<HdWallet> {
  const rec = readSealed().find((r) => r.address === address)
  if (!rec) throw new Error('No browser key for this account on this device.')
  const priv = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(rec.iv), additionalData: aad(rec.address, rec.credId) },
      await aes(prf),
      fromB64(rec.ct)
    )
  )
  const { DirectSecp256k1Wallet } = await loadCosmJs()
  // fromKey keeps a reference to priv; drop the signer (not the bytes) when done.
  return DirectSecp256k1Wallet.fromKey(priv, 'terp')
}

// ── in-memory root key (never persisted) ──────────────────────────────────

type Root = { address: string; pubkey: Uint8Array; wallet: HdWallet | null }
let root: Root | null = null

export const rootInMemory = (address?: string) => !!root?.wallet && (!address || root.address === address)

/** Drop every reference to the root key. JS can't zero a string; we hold no other copy. */
export function destroyRoot() {
  if (root) {
    root.wallet = null
    root = null
  }
}

// ── prepare (local only) ──────────────────────────────────────────────────

export type Prepared = {
  address: string
  browserPubkey: string // base64 33 bytes
  passkey: PasskeyParams
  passkeyCredId: string
  sealed: boolean
}

export async function prepareBrowserAccount(opts: {
  passkey: PasskeyParams
  passkeyCredId: string
  prfKey: Uint8Array | null
}): Promise<Prepared> {
  if (!opts.prfKey) {
    throw new Error(PRF_UNSUPPORTED)
  }
  destroyRoot()
  const { DirectSecp256k1HdWallet, DirectSecp256k1Wallet } = await loadCosmJs()
  const rootWallet = await DirectSecp256k1HdWallet.generate(24, { prefix: 'terp' })
  const [acct] = await rootWallet.getAccounts()
  if (!isTerp1(acct?.address)) throw new Error('Couldn’t make an account address.')
  root = { address: acct.address, pubkey: acct.pubkey, wallet: rootWallet }

  const priv = crypto.getRandomValues(new Uint8Array(32))
  const browser = await DirectSecp256k1Wallet.fromKey(priv, 'terp')
  const [bAcct] = await browser.getAccounts()
  writeSealed(await seal(priv, opts.prfKey, acct.address, opts.passkeyCredId, bAcct.pubkey))
  priv.fill(0)

  return {
    address: acct.address,
    browserPubkey: b64(bAcct.pubkey),
    passkey: opts.passkey,
    passkeyCredId: opts.passkeyCredId,
    sealed: true,
  }
}

// ── register (desk + chain) ───────────────────────────────────────────────

export const registerDeskOpen = () => !!REGISTER_DESK

async function json(url: string, init?: RequestInit, ms = 15_000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store', ...init, signal: ctrl.signal })
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, body }
  } finally {
    clearTimeout(t)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Existing onboard-authz route. It answers 402 without a paid `c` unless the desk allows sign-in grants. */
async function requestGrant(prep: Prepared) {
  const r = await json(`${REGISTER_DESK}/onboard/v1/register-grant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: prep.address,
      purpose: 'sezs_signin',
      msgTypeUrls: [MSG_ADD_AUTHENTICATOR],
      authenticator: { type: PARTITIONED_ALL_OF, passkey: prep.passkey, browser_pubkey: prep.browserPubkey },
    }),
  }, 25_000)
  if (r.status === 402) throw new Error('The registration desk isn’t open for sign-in yet. Nothing was sent.')
  if (!r.ok) throw new Error(r.body?.error || `Registration desk answered ${r.status}. Nothing was sent.`)
  const granter = r.body?.granter || r.body?.fee_granter || ''
  const contract = r.body?.contract || r.body?.authenticator_contract || PASSKEY_AUTH_CONTRACT || ''
  if (!isTerp1(granter)) throw new Error('The desk gave no fee granter. Nothing was sent.')
  if (!isTerp1(contract)) throw new Error('No passkey contract for this passkey yet. Nothing was sent.')
  return { granter, contract }
}

async function accountNumbers(address: string) {
  for (let i = 0; i < 12; i++) {
    const r = await json(`${CHAIN.rest}/cosmos/auth/v1beta1/accounts/${address}`)
    const a = r.body?.account
    const base = a?.base_account || a
    if (r.ok && base?.account_number != null) {
      return { accountNumber: BigInt(base.account_number), sequence: BigInt(base.sequence || 0) }
    }
    await sleep(2000)
  }
  throw new Error('The account isn’t on chain yet. Nothing was signed.')
}

export async function listAuthenticators(address: string): Promise<{ id: string; type: string }[]> {
  const r = await json(`${CHAIN.rest}/terp/smartaccount/authenticators/${address}`)
  if (!r.ok) return []
  const raw = r.body?.account_authenticators || r.body?.accountAuthenticators || []
  return raw.map((a: { id?: string | number; type?: string }) => ({ id: String(a.id ?? ''), type: String(a.type || '') }))
}

export type Registered = { txhash: string; authenticatorId: string; at: number }

/**
 * Grant → read account → pre-sign with the root key → broadcast → confirm the
 * PartitionedAllOf is on the account → destroy the root key.
 */
export async function registerBrowserAccount(
  prep: Prepared,
  onStep?: (s: 'grant' | 'sign' | 'broadcast' | 'confirm') => void
): Promise<{ registered: Registered; plan: RegisterPlan }> {
  if (!registerDeskOpen()) throw new Error('The registration desk isn’t open yet. Nothing was sent.')
  if (!root?.wallet || root.address !== prep.address) {
    throw new Error('Setup was interrupted, so this account can’t be registered. Start again.')
  }
  onStep?.('grant')
  const { granter, contract } = await requestGrant(prep)
  const plan = buildRegisterPlan({
    sender: prep.address,
    passkeyContract: contract,
    passkey: prep.passkey,
    browserPubkey: fromB64(prep.browserPubkey),
  })

  onStep?.('sign')
  const { accountNumber, sequence } = await accountNumbers(prep.address)
  const bodyBytes = encodeTxBody([{ typeUrl: MSG_ADD_AUTHENTICATOR, value: encodeMsgAddAuthenticator(plan) }], 'sezs sign-in')
  const authInfoBytes = encodeAuthInfo({
    pubkey: root.pubkey,
    sequence,
    fee: {
      denom: CHAIN.denom,
      amount: String(Math.ceil(CHAIN.registerGas * CHAIN.gasPrice)),
      gasLimit: CHAIN.registerGas,
      granter,
    },
  })
  const signed = await root.wallet.signDirect(prep.address, {
    bodyBytes,
    authInfoBytes,
    chainId: CHAIN.chainId,
    accountNumber,
  })
  const txBytes = encodeTxRaw(bodyBytes, authInfoBytes, [fromB64(signed.signature.signature)])

  onStep?.('broadcast')
  const br = await json(`${CHAIN.rest}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: b64(txBytes), mode: 'BROADCAST_MODE_SYNC' }),
  }, 30_000)
  const resp = br.body?.tx_response
  if (!br.ok || !resp?.txhash || Number(resp.code || 0) !== 0) {
    throw new Error(`Registration wasn’t accepted${resp?.raw_log ? `: ${resp.raw_log}` : ''}. The setup key is still in this tab; you can retry.`)
  }

  onStep?.('confirm')
  for (let i = 0; i < 20; i++) {
    const auths = await listAuthenticators(prep.address)
    const hit = auths.find((a) => a.type === PARTITIONED_ALL_OF)
    if (hit) {
      destroyRoot()
      return { registered: { txhash: resp.txhash, authenticatorId: hit.id, at: Date.now() }, plan }
    }
    await sleep(1500)
  }
  throw new Error(`Sent (${resp.txhash.slice(0, 10)}…) but the authenticator isn’t showing yet. The setup key stays in this tab until it does.`)
}
