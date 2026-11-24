/**
 * Pure helpers for SVG mint payment plans powered by shitstraps.
 * Ported from terp.network svg.html (1e18 rate scale).
 */

/** Fixed-point scale for shit_rate (uthiol out = slop * rate / SCALE). */
export const SHIT_RATE_SCALE = 10n ** 18n

export type ShitstrapPlanStep = {
  /** Shitstrap contract address. */
  contract: string
  /** Native slop denom user spends. */
  slopDenom: string
  /** Amount of slop to send (base units). */
  slopAmount: string
  /** Expected uthiol (or mint denom) out from this step. */
  uthiolOut: string
  shitRate: string
}

export type SvgMintPaymentPath =
  | 'wallet'
  | 'atomic'
  | 'legacy'
  | 'whitelist'

export type SvgMintPaymentPlan = {
  totalMintDenom: string
  mintDenomFromWallet: string
  steps: ShitstrapPlanStep[]
  canAfford: boolean
  canAtomicMint: boolean
  feeWaived: boolean
  proofHashes: string[]
  preferredPath: SvgMintPaymentPath
}

export type CompatibleStrap = {
  contract: string
  slopDenom: string
  shitRate: string
  userBal: bigint
  maxUthiol: bigint
  capacity: bigint
}

/** uthiol received when sending slopAmount at shitRate (floor). */
export const shitstrapUthiolOut = (
  slopAmount: bigint | string,
  shitRate: bigint | string
): bigint =>
  (BigInt(slopAmount) * BigInt(shitRate)) / SHIT_RATE_SCALE

/** slop tokens needed to obtain uthiolNeeded (ceiling). */
export const shitstrapSlopNeeded = (
  uthiolNeeded: bigint | string,
  shitRate: bigint | string
): bigint => {
  const rate = BigInt(shitRate)
  if (rate === 0n) {
    return 0n
  }
  return (BigInt(uthiolNeeded) * SHIT_RATE_SCALE + rate - 1n) / rate
}

/**
 * Build a mint payment plan: wallet mint-denom first, then shitstrap steps.
 */
export const computeSvgMintPaymentPlan = ({
  quantity,
  pricePerToken,
  walletMintDenomBalance,
  mintDenom,
  straps,
  feeWaived = false,
  proofHashes = [],
  atomicSupported = true,
}: {
  quantity: number
  /** Base units of mint denom per NFT. */
  pricePerToken: string | bigint
  /** User balance of mint denom (e.g. uthiol). */
  walletMintDenomBalance: string | bigint
  mintDenom: string
  straps: CompatibleStrap[]
  feeWaived?: boolean
  proofHashes?: string[]
  atomicSupported?: boolean
}): SvgMintPaymentPlan => {
  void mintDenom
  if (feeWaived) {
    return {
      totalMintDenom: '0',
      mintDenomFromWallet: '0',
      steps: [],
      canAfford: true,
      canAtomicMint: false,
      feeWaived: true,
      proofHashes,
      preferredPath: 'whitelist',
    }
  }

  const total = BigInt(pricePerToken) * BigInt(quantity)
  const bal = BigInt(walletMintDenomBalance)
  const fromWallet = bal < total ? bal : total
  let remaining = total - fromWallet

  const plan: SvgMintPaymentPlan = {
    totalMintDenom: total.toString(),
    mintDenomFromWallet: fromWallet.toString(),
    steps: [],
    canAfford: remaining === 0n,
    canAtomicMint: false,
    feeWaived: false,
    proofHashes,
    preferredPath: remaining === 0n ? 'wallet' : 'legacy',
  }

  if (remaining === 0n || straps.length === 0) {
    return plan
  }

  const sorted = [...straps].sort((a, b) =>
    b.maxUthiol > a.maxUthiol ? 1 : b.maxUthiol < a.maxUthiol ? -1 : 0
  )

  for (const c of sorted) {
    if (remaining === 0n) {
      break
    }
    const uthiolFromThis = remaining < c.maxUthiol ? remaining : c.maxUthiol
    if (uthiolFromThis === 0n) {
      continue
    }
    const slopNeeded = shitstrapSlopNeeded(uthiolFromThis, c.shitRate)
    const slopSend = slopNeeded < c.userBal ? slopNeeded : c.userBal
    if (slopSend === 0n) {
      continue
    }
    const uthiolActual = shitstrapUthiolOut(slopSend, c.shitRate)
    plan.steps.push({
      contract: c.contract,
      slopDenom: c.slopDenom,
      slopAmount: slopSend.toString(),
      uthiolOut: uthiolActual.toString(),
      shitRate: c.shitRate,
    })
    remaining -= uthiolActual
  }

  plan.canAfford = remaining <= 0n
  // Atomic: single strap covers all, no wallet mint-denom contribution.
  plan.canAtomicMint =
    atomicSupported &&
    plan.steps.length === 1 &&
    fromWallet === 0n &&
    plan.canAfford

  if (plan.canAtomicMint) {
    plan.preferredPath = 'atomic'
  } else if (fromWallet > 0n && plan.steps.length === 0) {
    plan.preferredPath = 'wallet'
  } else if (plan.steps.length > 0) {
    plan.preferredPath = 'legacy'
  }

  return plan
}

/**
 * Build CompatibleStrap rows from factory-style shitstrap rows + balances.
 */
export const buildCompatibleStraps = ({
  straps,
  balances,
  mintDenom,
}: {
  straps: {
    contract: string
    accepted?: {
      shit_rate: string
      token: { native?: string } | string
    }[]
    toShit?: string
    capacity?: string
  }[]
  /** Map denom → balance base units. */
  balances: Record<string, string>
  mintDenom: string
}): CompatibleStrap[] => {
  void mintDenom
  const out: CompatibleStrap[] = []
  for (const ss of straps) {
    const capacity = BigInt(ss.toShit || ss.capacity || '0')
    for (const row of ss.accepted || []) {
      const slopDenom =
        typeof row.token === 'string'
          ? row.token
          : row.token?.native || ''
      if (!slopDenom) {
        continue
      }
      const userBal = BigInt(balances[slopDenom] || '0')
      if (userBal === 0n) {
        continue
      }
      const maxFromBal = shitstrapUthiolOut(userBal, row.shit_rate)
      const maxUthiol = capacity > 0n
        ? maxFromBal < capacity
          ? maxFromBal
          : capacity
        : maxFromBal
      if (maxUthiol === 0n) {
        continue
      }
      out.push({
        contract: ss.contract,
        slopDenom,
        shitRate: row.shit_rate,
        userBal,
        maxUthiol,
        capacity,
      })
    }
  }
  return out
}
