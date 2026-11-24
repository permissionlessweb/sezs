/**
 * Chain + desk config for sign-in. NEXT_PUBLIC_* is inlined by Next at build/dev time.
 *
 * REGISTER_DESK unset ⇒ browser-key registration stays closed (honest disabled UI).
 * PASSKEY_AUTH_CONTRACT is only a fallback; the desk should return a per-passkey
 * terp-passkey instance (registration = origin, rp_id, credential_id, public_key).
 */
const chainId = process.env.NEXT_PUBLIC_SEZS_CHAIN_ID || 'morocco-1'
const local = chainId === 'sezs-local-1' || chainId.startsWith('sezs-local')

export const CHAIN = {
  chainId,
  chainName: local ? 'Speak-Ez Local' : 'Terp Network',
  rpc: (process.env.NEXT_PUBLIC_SEZS_RPC || (local ? 'http://127.0.0.1:26657' : 'https://rpc.terp.network')).replace(/\/$/, ''),
  rest: (process.env.NEXT_PUBLIC_SEZS_REST || process.env.NEXT_PUBLIC_SEZS_LCD || (local ? 'http://127.0.0.1:1317' : 'https://api.terp.network')).replace(/\/$/, ''),
  denom: process.env.NEXT_PUBLIC_SEZS_DENOM || (local ? 'uterp' : 'uthiol'),
  gasPrice: local ? 0.025 : 0.05,
  /** Register tx gas. PartitionedAllOf + CosmwasmAuthenticator OnAuthAdded sudo. */
  registerGas: 450_000,
}

export const REGISTER_DESK = (process.env.NEXT_PUBLIC_SEZS_REGISTER_DESK || '').replace(/\/$/, '')

export const PASSKEY_AUTH_CONTRACT = process.env.NEXT_PUBLIC_SEZS_PASSKEY_AUTH_CONTRACT || ''

export const isTerp1 = (a?: string | null): a is string =>
  typeof a === 'string' && /^terp1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38,58}$/.test(a)

export const shortAddr = (a?: string | null) =>
  a && a.length > 14 ? `${a.slice(0, 9)}…${a.slice(-4)}` : a || ''
