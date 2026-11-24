/**
 * Sign and broadcast a CosmWasm execute from Zafu (Keplr-shaped).
 * The wallet holds the key; this module only assembles the amino tx.
 * Loopback LCD broadcast is used when the wallet does not expose sendTx.
 */
import { CHAIN } from '../auth/chainConfig'

type ZafuApi = {
  enable: (chainId: string) => Promise<void>
  getKey: (chainId: string) => Promise<{ bech32Address?: string; address?: string }>
  experimentalSuggestChain?: (info: unknown) => Promise<void>
  signAmino?: (chainId: string, signer: string, signDoc: unknown) => Promise<{
    signed?: Record<string, unknown>
    signature?: { signature?: string; pub_key?: { type?: string; value?: string } }
  }>
  sendTx?: (chainId: string, tx: Uint8Array, mode?: string) => Promise<Uint8Array>
}

const zafuOf = () => (window as unknown as { zafu?: ZafuApi }).zafu

const utf8 = (s: string) => new TextEncoder().encode(s)

const fromB64 = (s: string) => {
  const bin = atob(String(s || '').replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const toB64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

const varint = (n: number | bigint) => {
  let v = BigInt(n)
  const out: number[] = []
  while (v > 0x7fn) {
    out.push(Number(v & 0x7fn) | 0x80)
    v >>= 7n
  }
  out.push(Number(v))
  return out
}

const cat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const fBytes = (no: number, bytes: Uint8Array) =>
  Uint8Array.from([...varint((no << 3) | 2), ...varint(bytes.length), ...bytes])
const fStr = (no: number, s: string) => fBytes(no, utf8(s))
const fVarint = (no: number, n: number | bigint) =>
  BigInt(n) === 0n ? new Uint8Array() : Uint8Array.from([...varint(no << 3), ...varint(n)])

const anyOf = (typeUrl: string, value: Uint8Array) => cat([fStr(1, typeUrl), fBytes(2, value)])

/** /cosmos.base.v1beta1.Coin */
const encodeCoin = (denom: string, amount: string) => cat([fStr(1, denom), fStr(2, amount)])

/** /cosmwasm.wasm.v1.MsgExecuteContract */
const encodeExecute = (sender: string, contract: string, msg: unknown) =>
  cat([
    fStr(1, sender),
    fStr(2, contract),
    fBytes(3, utf8(JSON.stringify(msg))),
  ])

const encodeTxBody = (messages: Uint8Array[]) => {
  const parts: Uint8Array[] = []
  for (const m of messages) parts.push(fBytes(1, m))
  return cat(parts)
}

/** SIGN_MODE_LEGACY_AMINO_JSON = 127 (0x7f) in cosmos-sdk */
const SIGN_MODE_AMINO = 127

const encodeModeInfo = (mode: number) => fBytes(1, fVarint(1, mode)) // ModeInfo.single.mode

const encodeSignerInfo = (pubKeyB64: string, sequence: string) => {
  const pk = fromB64(pubKeyB64)
  const anyPk = anyOf('/cosmos.crypto.secp256k1.PubKey', fBytes(1, pk))
  return cat([fBytes(1, anyPk), fVarint(2, BigInt(sequence || '0')), fBytes(3, encodeModeInfo(SIGN_MODE_AMINO))])
}

const encodeFee = (amount: { denom: string; amount: string }[], gas: string) => {
  const parts: Uint8Array[] = []
  for (const c of amount) parts.push(fBytes(1, encodeCoin(c.denom, c.amount)))
  parts.push(fVarint(2, BigInt(gas)))
  return cat(parts)
}

const encodeAuthInfo = (signerInfo: Uint8Array, fee: Uint8Array) =>
  cat([fBytes(1, signerInfo), fBytes(2, fee)])

const encodeTxRaw = (body: Uint8Array, auth: Uint8Array, signature: Uint8Array) =>
  cat([fBytes(1, body), fBytes(2, auth), fBytes(3, signature)])

const suggestInfo = () => ({
  chainId: CHAIN.chainId,
  chainName: CHAIN.chainName,
  rpc: CHAIN.rpc,
  rest: CHAIN.rest,
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: 'terp',
    bech32PrefixAccPub: 'terppub',
    bech32PrefixValAddr: 'terpvaloper',
    bech32PrefixValPub: 'terpvaloperpub',
    bech32PrefixConsAddr: 'terpvalcons',
    bech32PrefixConsPub: 'terpvalconspub',
  },
  currencies: [{ coinDenom: CHAIN.denom.replace(/^u/, '').toUpperCase(), coinMinimalDenom: CHAIN.denom, coinDecimals: 6 }],
  feeCurrencies: [
    {
      coinDenom: CHAIN.denom.replace(/^u/, '').toUpperCase(),
      coinMinimalDenom: CHAIN.denom,
      coinDecimals: 6,
      gasPriceStep: { low: 0.01, average: CHAIN.gasPrice, high: 0.04 },
    },
  ],
  stakeCurrency: { coinDenom: 'TERP', coinMinimalDenom: 'uterp', coinDecimals: 6 },
})

const readAccount = async (address: string) => {
  const res = await fetch(`${CHAIN.rest}/cosmos/auth/v1beta1/accounts/${address}`)
  const body = await res.json() as { account?: Record<string, unknown> }
  const acc = body.account || {}
  const base = (acc.base_account || acc) as Record<string, unknown>
  const accountNumber = String(base.account_number || acc.account_number || '0')
  const sequence = String(base.sequence || acc.sequence || '0')
  return { accountNumber, sequence }
}

const broadcastLcd = async (txBytes: Uint8Array) => {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(CHAIN.rest)) {
    throw new Error('Refusing to broadcast through a non-loopback LCD.')
  }
  const res = await fetch(`${CHAIN.rest}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tx_bytes: toB64(txBytes), mode: 'BROADCAST_MODE_SYNC' }),
  })
  const data = await res.json() as { tx_response?: { txhash?: string; code?: number; raw_log?: string }; message?: string }
  const resp = data.tx_response || (data as { txhash?: string; code?: number; raw_log?: string })
  const txhash = String(resp.txhash || '')
  const code = Number(resp.code || 0)
  if (!txhash || code) throw new Error(String(resp.raw_log || data.message || 'broadcast_failed'))
  return { txhash, signedTx: toB64(txBytes) }
}

export const zafuExecute = async (contract: string, msg: unknown, opts?: { gas?: string; fee?: string }) => {
  const zafu = zafuOf()
  if (!zafu?.enable || !zafu.signAmino) throw new Error('Zafu is not available.')
  try {
    await zafu.enable(CHAIN.chainId)
  } catch {
    if (!zafu.experimentalSuggestChain) throw new Error('Zafu needs this chain added first.')
    await zafu.experimentalSuggestChain(suggestInfo())
    await zafu.enable(CHAIN.chainId)
  }
  const key = await zafu.getKey(CHAIN.chainId)
  const signer = key?.bech32Address || key?.address || ''
  if (!signer.startsWith('terp1')) throw new Error('Zafu did not share a terp1 address.')
  const { accountNumber, sequence } = await readAccount(signer)
  const gas = opts?.gas || '300000'
  const feeAmount = opts?.fee || '5000'
  const fee = [{ denom: CHAIN.denom, amount: feeAmount }]
  const aminoMsg = {
    type: 'wasm/MsgExecuteContract',
    value: { sender: signer, contract, msg, funds: [] as { denom: string; amount: string }[] },
  }
  const signDoc = {
    chain_id: CHAIN.chainId,
    account_number: accountNumber,
    sequence,
    fee: { amount: fee, gas },
    msgs: [aminoMsg],
    memo: '',
  }
  if (!CHAIN.chainId.startsWith('sezs-local') && typeof zafu.sendTx !== 'function') {
    throw new Error('Zafu sendTx is required on this network.')
  }
  const signed = await zafu.signAmino(CHAIN.chainId, signer, signDoc)
  const sig = signed?.signature?.signature
  const pub = signed?.signature?.pub_key?.value
  if (!sig || !pub) throw new Error('Zafu did not return a signature.')
  const used = (signed.signed as typeof signDoc) || signDoc
  const body = encodeTxBody([anyOf('/cosmwasm.wasm.v1.MsgExecuteContract', encodeExecute(signer, contract, msg))])
  const auth = encodeAuthInfo(encodeSignerInfo(pub, used.sequence || sequence), encodeFee(fee, used.fee?.gas || gas))
  const txRaw = encodeTxRaw(body, auth, fromB64(sig))
  if (typeof zafu.sendTx === 'function') {
    const hashBytes = await zafu.sendTx(CHAIN.chainId, txRaw, 'sync')
    const txhash = Array.from(hashBytes || []).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    if (txhash) return { ok: true as const, txhash, signer, signedTx: toB64(txRaw) }
  }
  const broadcast = await broadcastLcd(txRaw)
  return { ok: true as const, ...broadcast, signer }
}

export const updateMembersMsg = (add: string[] = [], remove: string[] = []) => ({
  update_members: {
    add: add.map((addr) => ({ addr, weight: 1 })),
    remove,
  },
})
