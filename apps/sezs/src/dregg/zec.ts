/**
 * ZIP-321 + HD dests for tickets — same rules as permissionless.money/lib/dregg-svg-checkout.js
 * Never invent a UA. Never put terp1 in memo. Only display dests DREGG issued.
 * SEZS tickets talk to loopback DREGG only (testnet/regtest). Mainnet origins are refused.
 */

import {
  baseChainIdOk,
  ethChainIdOk,
  evmDestOk,
  isLoopbackOrigin,
  mainnetOriginRefused,
  zecUriLabOk,
} from '../pay/network'

/** Lab DREGG on the development machine. Not the public mint origin. */
export const DREGG_DEFAULT = 'http://127.0.0.1:8421'

export type DreggHealth = {
  ok?: boolean
  checkout_ready?: boolean
  pay?: boolean
  error?: string
  eth_chain_id?: number
  base_chain_id?: number
  network?: string
}

export type PayTargets = {
  ok?: boolean
  zec_uri?: string
  memo_hex?: string
  memo_commit?: string
  zec_ua?: string
  eth_addr?: string
  base_addr?: string
  eth_wei?: string
  base_wei?: string
  eth_chain_id?: number
  base_chain_id?: number
  error?: string
}

export type DreggStatus = {
  ok?: boolean
  phase?: string | null
  recipient?: string
  error?: string
  checkout_ready?: boolean
}

export const dreggOrigin = () => {
  if (typeof window === 'undefined') return DREGG_DEFAULT
  const raw =
    process.env.NEXT_PUBLIC_SEZS_DREGG_URL ||
    (typeof localStorage !== 'undefined'
      ? localStorage.getItem('dreggUrl')
      : null) ||
    DREGG_DEFAULT
  const origin = String(raw).replace(/\/$/, '')
  if (mainnetOriginRefused(origin) || !isLoopbackOrigin(origin)) {
    return DREGG_DEFAULT
  }
  return origin
}

const get = (path: string) =>
  fetch(`${dreggOrigin()}${path}`, {
    method: 'GET',
    credentials: 'omit',
    mode: 'cors',
  })

const leaksTerp1 = (v: unknown) => {
  try {
    return /terp1/i.test(typeof v === 'string' ? v : JSON.stringify(v))
  } catch {
    return false
  }
}

export const zecPayUri = (t: PayTargets | null | undefined) => {
  const s = String(t?.zec_uri || '').trim()
  if (!s.startsWith('zcash:')) return null
  if (s.startsWith('zcash://')) return null
  if (!zecUriLabOk(s)) return null
  return s
}

export async function fetchDreggHealth(): Promise<DreggHealth> {
  try {
    const res = await get('/health')
    const body = (await res.json().catch(() => ({}))) as DreggHealth
    if (!res.ok) {
      return {
        ok: false,
        checkout_ready: false,
        error: body.error || `health ${res.status}`,
      }
    }
    return {
      ...body,
      checkout_ready: body.checkout_ready === true,
      pay: body.pay === true && body.checkout_ready === true,
    }
  } catch (e) {
    return {
      ok: false,
      checkout_ready: false,
      error: e instanceof Error ? e.message : 'Loopback DREGG is not up.',
    }
  }
}

export async function fetchPayTargets(recipient: string): Promise<PayTargets> {
  if (!/^terp1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38,58}$/.test(recipient)) {
    throw new Error('Need a Terp address before asking DREGG how to pay.')
  }
  const res = await get(
    `/v1/pay-targets?recipient=${encodeURIComponent(recipient)}&qty=1`
  )
  const body = (await res.json().catch(() => ({}))) as PayTargets
  if (!res.ok) throw new Error(body.error || 'pay-targets failed')
  if (body.ok !== true) throw new Error(body.error || 'pay-targets failed')
  if (Object.prototype.hasOwnProperty.call(body, 'recipient')) {
    throw new Error(
      'Server bug: pay-targets must not include recipient. Do not pay.'
    )
  }
  const memoHex = String(body.memo_hex || '')
  if (!memoHex.toLowerCase().startsWith('6431')) {
    throw new Error('Checkout missing one-time commitment (memo_hex).')
  }
  if (
    leaksTerp1(body.zec_uri) ||
    leaksTerp1(body.memo_hex) ||
    leaksTerp1(body.zec_ua) ||
    leaksTerp1(body.eth_addr) ||
    leaksTerp1(body.base_addr)
  ) {
    throw new Error(
      'Checkout tried to put a Terp address on a public chain. Stopped.'
    )
  }
  return body
}

export async function fetchDreggStatus(
  recipient: string
): Promise<DreggStatus> {
  if (!/^terp1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38,58}$/.test(recipient)) {
    return { ok: false, error: 'Need a Terp address to poll.' }
  }
  try {
    const res = await get(
      `/v1/status?recipient=${encodeURIComponent(recipient)}`
    )
    const body = (await res.json().catch(() => ({}))) as DreggStatus
    if (!res.ok) {
      return { ok: false, error: body.error || `status ${res.status}` }
    }
    return body
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Loopback DREGG is not up.',
    }
  }
}

export const ethDest = (t: PayTargets): string | null => {
  const s = String(t.eth_addr || '').trim()
  if (!evmDestOk(s)) return null
  if (t.eth_chain_id !== undefined && !ethChainIdOk(t.eth_chain_id)) return null
  return s
}

export const baseDest = (t: PayTargets): string | null => {
  const s = String(t.base_addr || '').trim()
  if (!evmDestOk(s)) return null
  if (!baseChainIdOk(t.base_chain_id)) return null
  return s
}
