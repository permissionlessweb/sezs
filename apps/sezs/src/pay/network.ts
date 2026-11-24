/**
 * Lab-only network policy for tickets checkout.
 * Never logs origins, keys, or env values. Mainnet is refused.
 * Guest checkout does not fetch loopback; these helpers stay for lab code.
 */

export const ETH_MAINNET = 1
export const BASE_MAINNET = 8453
export const ETH_SEPOLIA = 11155111
export const BASE_SEPOLIA = 84532

/** Sepolia and Base-Sepolia only — not ETH/Base mainnet, not anvil. */
export const LAB_EVM_CHAIN_IDS = [ETH_SEPOLIA, BASE_SEPOLIA]

export const isLoopbackOrigin = (raw: string): boolean => {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const h = u.hostname.toLowerCase()
    return h === '127.0.0.1' || h === 'localhost' || h === '::1'
  } catch {
    return false
  }
}

export const mainnetOriginRefused = (raw: string): boolean => {
  const l = raw.toLowerCase()
  if (l.includes('permissionless.money')) return true
  if (l.includes('mainnet')) return true
  if (!isLoopbackOrigin(raw)) return true
  return false
}

export const evmChainIdOk = (id: unknown): boolean => {
  const n = typeof id === 'number' ? id : Number(id)
  if (!Number.isFinite(n)) return false
  if (n === ETH_MAINNET || n === BASE_MAINNET) return false
  return LAB_EVM_CHAIN_IDS.includes(n)
}

export const mainnetChainIdRefused = (id: unknown): boolean => {
  const n = typeof id === 'number' ? id : Number(id)
  return n === ETH_MAINNET || n === BASE_MAINNET
}

export const ethChainIdOk = (id: unknown): boolean => {
  const n = typeof id === 'number' ? id : Number(id)
  return n === ETH_SEPOLIA
}

export const baseChainIdOk = (id: unknown): boolean => {
  const n = typeof id === 'number' ? id : Number(id)
  return n === BASE_SEPOLIA
}

/** ZIP-321 address part (no query). Mainnet unified UA starts with u1. */
export const zecUriLabOk = (uri: string): boolean => {
  const s = uri.trim()
  if (!s.startsWith('zcash:') || s.startsWith('zcash://')) return false
  if (/terp1/i.test(s)) return false
  const addr = s.slice('zcash:'.length).split('?')[0] || ''
  if (addr.startsWith('uregtest1') || addr.startsWith('utest1')) return true
  return false
}

export const evmDestOk = (dest: string): boolean => {
  const s = dest.trim()
  return (
    s.startsWith('0x') &&
    s.length === 42 &&
    /^[0-9a-fA-F]+$/.test(s.slice(2))
  )
}

/** Testnet / lab Penumbra. Mainnet penumbra1 is refused unless a local SEZS session is driving checkout (official pd uses the same HRP). */
export const penumbraDestOk = (dest: string): boolean => {
  const s = dest.trim()
  if (
    s.startsWith('penumbratest1') ||
    s.startsWith('plmt1') ||
    s.startsWith('penumbrat1')
  ) return true
  if (s.startsWith('penumbra1')) {
    const env = typeof process !== 'undefined' ? process.env : undefined
    // Only when a local dest was explicitly provided — do not key off SEZS_SPLASH / SEZS_SESSION_ROOT,
    // which test suites may inherit.
    return Boolean(env && (env.SEZS_TICKET_UM_DEST || env.SEZS_ALLOW_LOCAL_UM === '1'))
  }
  return false
}

export const dreggPaidPhases = ['Deposited', 'Entitled', 'Settled']

export const statusLooksPaid = (phase: unknown): boolean => {
  const p = String(phase || '')
  return dreggPaidPhases.some((x) => p.includes(x))
}
