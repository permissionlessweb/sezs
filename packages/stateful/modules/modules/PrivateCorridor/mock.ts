/**
 * Local/mock helpers for the PrivateCorridor v0 success film.
 * No live chain required. Simulated assets only unless backend is upgraded later.
 *
 * SPEC: DEMO-CASHAPP-ZEC-CORRIDOR.md §3–§5 (intent + happy path).
 */

import {
  CorridorAssetBackend,
  CorridorReceipt,
  CorridorWizardDraft,
  DepositIntentV0,
  OracleBoundPolicy,
} from './types'
import { DEST_BINDING_DOMAIN, destOwnerBindingHex } from './zakuraDest'

const DOMAIN_PREFIX = 'terp-cashapp-intent-v0'
const INTENT_TTL_SECONDS = 60 * 60 * 24 // 24h

/** Registry placeholder ids for sim BTC / sim ZEC (32B hex). */
export const SIM_ASSET_IN_ID =
  '0000000000000000000000000000000000000000000000000000000000000001'
export const SIM_ASSET_OUT_ID =
  '0000000000000000000000000000000000000000000000000000000000000002'

/** Lab-only path — not the product default. */
export const isLabSimulatedBackend = (
  backend: CorridorAssetBackend
): boolean => backend === 'lab_simulated'

/**
 * Production-shaped backends: same post-deposit sequence (reverify → poll
 * automation). Includes local funded fidelity profile (not mainnet money).
 */
export const isProductionBackend = (backend: CorridorAssetBackend): boolean =>
  backend === 'production' ||
  backend === 'lc_live' ||
  backend === 'ict_local_funded'

/**
 * Fail-closed BTC re-verify (D4): production, lc_live, ict_local_funded.
 * Lab may warn + continue; these modes must not advance on reverify failure.
 */
export const isFailClosedReverifyBackend = (
  backend: CorridorAssetBackend
): boolean => isProductionBackend(backend)

/** Local ict / test-net funded profile — honest non-mainnet labels. */
export const isIctLocalFundedBackend = (
  backend: CorridorAssetBackend
): boolean => backend === 'ict_local_funded'

export const randomHex = (byteLength: number): string => {
  const arr = new Uint8Array(byteLength)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr)
  } else {
    for (let i = 0; i < byteLength; i++) {
      arr[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const sha256Hex = async (input: string): Promise<string> => {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input)
    const hash = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')
  }
  // Fallback for non-browser test envs — not cryptographic.
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0')
  return (hex.repeat(8) + randomHex(0)).slice(0, 64).padEnd(64, '0')
}

/**
 * owner_binding = SHA256(DEST_BINDING_DOMAIN|trim(dest_display)).
 * SSOT domain: zakuraDest.DEST_BINDING_DOMAIN (`terp-dest-binding-v0`).
 * Real binding is opaque protocol material; UI treats this as a digest handle.
 * Must match harness `owner_binding_from_dest_display` + golden-dest-binding.json.
 */
export const bindingFromDestDisplay = async (
  destDisplay: string
): Promise<string> => {
  // Prefer SubtleCrypto path shared with zakuraDest (parity with harness).
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    return destOwnerBindingHex(destDisplay)
  }
  return sha256Hex(`${DEST_BINDING_DOMAIN}|${destDisplay.trim()}`)
}

/**
 * Canonical JSON without domain_bind for domain separation hash.
 * Field order fixed so domain_bind is stable across reloads of the same draft.
 */
export const canonicalIntentBody = (
  intent: Omit<DepositIntentV0, 'domain_bind'>
): string =>
  JSON.stringify({
    version: intent.version,
    corridor_id: intent.corridor_id,
    source_chain_tag: intent.source_chain_tag,
    dest_chain_tag: intent.dest_chain_tag,
    btc_deposit_addr: intent.btc_deposit_addr,
    btc_txid_or_intent_id: intent.btc_txid_or_intent_id,
    dest_owner_binding: intent.dest_owner_binding,
    recovery_owner_binding: intent.recovery_owner_binding ?? null,
    dest_display_hint: intent.dest_display_hint ?? null,
    asset_in_id: intent.asset_in_id,
    asset_out_id: intent.asset_out_id,
    min_out_value: intent.min_out_value,
    max_slippage_bps: intent.max_slippage_bps,
    oracle_market_id: intent.oracle_market_id,
    oracle_bound_policy: intent.oracle_bound_policy,
    created_at: intent.created_at,
    expiry: intent.expiry,
  })

/** Fail-closed: expired intent must not advance mint/swap as success. */
export const isIntentExpired = (
  intent: Pick<DepositIntentV0, 'expiry'>,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean => nowSec >= intent.expiry

/**
 * RECOVERY-3: lab residual modes must not use product celebrate copy
 * ("ZEC sent", "egress complete (chain)").
 */
export const isLabResidualFidelity = (
  label: string | undefined,
  backend?: CorridorAssetBackend
): boolean => {
  if (backend === 'lab_simulated') return true
  return (
    label === 'lab_film' ||
    label === 'pure_record_lab' ||
    label === 'lab_inventory_pay_simulated' ||
    label === 'host_automation_film'
  )
}

export const computeDomainBind = async (
  body: Omit<DepositIntentV0, 'domain_bind'>
): Promise<string> =>
  sha256Hex(`${DOMAIN_PREFIX}|${canonicalIntentBody(body)}`)

export type BuildIntentOptions = {
  corridorId: string
  draft: CorridorWizardDraft
  assetBackend: CorridorAssetBackend
}

export type BuildIntentWithWalletOptions = BuildIntentOptions & {
  /** Browser-generated deposit address (SelfRelay-style wallet). Required. */
  btcDepositAddr: string
  /** Optional fixed intent id (else random). */
  intentId?: string
}

/**
 * Seal DepositIntentV0 for the deposit step (W0 + W1).
 * `btc_deposit_addr` MUST come from a browser-generated wallet (not random string).
 */
export const buildDepositIntent = async ({
  corridorId,
  draft,
  assetBackend,
  btcDepositAddr,
  intentId: intentIdOpt,
}: BuildIntentWithWalletOptions): Promise<DepositIntentV0> => {
  if (!btcDepositAddr?.trim()) {
    throw new Error('btcDepositAddr required from browser deposit wallet')
  }
  const now = Math.floor(Date.now() / 1000)
  const intentId = intentIdOpt || randomHex(32)
  const destDisplay = draft.destDisplay.trim()
  const destOwnerBinding =
    draft.destOwnerBinding || (await bindingFromDestDisplay(destDisplay))

  const body: Omit<DepositIntentV0, 'domain_bind'> = {
    version: 0,
    corridor_id: corridorId || 'cashapp-btc-zec-v0',
    source_chain_tag:
      assetBackend === 'lab_simulated' ? 'bitcoin-sim' : 'bitcoin',
    dest_chain_tag:
      assetBackend === 'lab_simulated' ? 'zcash-sim' : 'zcash',
    btc_deposit_addr: btcDepositAddr.trim(),
    btc_txid_or_intent_id: intentId,
    dest_owner_binding: destOwnerBinding,
    dest_display_hint:
      destDisplay.length > 24
        ? `${destDisplay.slice(0, 12)}…${destDisplay.slice(-8)}`
        : destDisplay || undefined,
    asset_in_id: SIM_ASSET_IN_ID,
    asset_out_id: SIM_ASSET_OUT_ID,
    min_out_value: draft.minOutValue || '0',
    max_slippage_bps: draft.maxSlippageBps,
    oracle_market_id: draft.oracleMarketId || 'BTC-ZEC',
    oracle_bound_policy: draft.oracleBoundPolicy,
    created_at: now,
    expiry: now + INTENT_TTL_SECONDS,
  }

  const domain_bind = await computeDomainBind(body)
  return { ...body, domain_bind }
}

/** Simulated oracle mid for BTC-ZEC (ZEC per BTC, display). */
export const MOCK_ORACLE_MID = '15.42'

/**
 * Build a success receipt after mock pipeline (W2–W7).
 * amount_out respects min_out as floor for the film.
 */
export const buildMockSuccessReceipt = (
  intent: DepositIntentV0,
  assetBackend: CorridorAssetBackend
): CorridorReceipt => {
  const minOut = BigInt(intent.min_out_value || '0')
  // Demo film: credit slightly above floor so I5 (happy) is obvious.
  const amountOut =
    minOut > 0n ? (minOut + minOut / 100n).toString() : '1000000'

  return {
    intent: {
      ...intent,
      // After fund: bind mock deposit tx id into the packet field.
      btc_txid_or_intent_id: randomHex(32),
    },
    amountInDisplay: '0.001 sim-BTC',
    amountOutDisplay: `${amountOut} sim-ZEC units`,
    oracleMidUsed: MOCK_ORACLE_MID,
    boundPolicy: intent.oracle_bound_policy,
    mockRefs: {
      depositTxId: `sim-deposit-${randomHex(8)}`,
      bridgeMintRef: `sim-mint-${randomHex(8)}`,
      swapRef: `sim-swap-${randomHex(8)}`,
    },
    completedAt: Math.floor(Date.now() / 1000),
    assetBackend,
    // Lab film / host automation film — not chain egress or ZEC consensus.
    fidelityLabel:
      assetBackend === 'lab_simulated'
        ? 'lab_film'
        : assetBackend === 'ict_local_funded'
          ? 'host_automation_film'
          : 'production_shaped',
  }
}

export const defaultWizardDraft = (): CorridorWizardDraft => ({
  destDisplay: '',
  destOwnerBinding: '',
  minOutValue: '1000000',
  maxSlippageBps: 100,
  oracleMarketId: 'BTC-ZEC',
  oracleBoundPolicy: 'mid_gte_floor' as OracleBoundPolicy,
})

/** Status film phases after "I've funded" (sim). */
export const STATUS_FILM_PHASES = [
  'deposit_observed',
  'bridging',
  'swapping',
  'complete',
] as const

export const statusPhaseLabel = (phase: string): string => {
  switch (phase) {
    case 'awaiting_deposit':
      return 'Awaiting deposit'
    case 'deposit_observed':
      return 'Deposit observed'
    case 'bridging':
      return 'Bridging (mint note)'
    case 'swapping':
      return 'Private swap (oracle bound)'
    case 'complete':
      return 'Complete'
    case 'failed':
      return 'Failed'
    default:
      return phase
  }
}
