/**
 * Post-deposit automation client for Private Bridge (D3 + D7).
 *
 * After SSE/poll `deposit_observed`:
 *   deposit_observed → depositReverify (fail-closed for non-lab) →
 *   bridging (BridgeMintNote @ cw-headstash, mock_verify OK)
 *   → put_note_after_mint (notesBase / HeadstashStore)
 *   → oracle-bound private swap (oracleBase mid; oracle never mints)
 *   → complete
 *
 * Browser cannot run Halo2 / cw-orch Mock. Production UI:
 *  - polls host automation status on hash-market: GET /corridor/automation/:intent_id
 *  - host runs docs/plans/spectrum/e2e/corridor-lab-mint-after-observe.sh
 *
 * Trust: automation status is coordination only — not mint authority.
 * Oracle is bound_only — never mints (D7).
 */

import { CorridorAssetBackend, CorridorStatusPhase } from './types'
import {
  isFailClosedReverifyBackend,
  isLabSimulatedBackend,
  isProductionBackend,
} from './mock'
import {
  reverifyDepositObservation,
  type ReverifyResult,
} from './btcReverify'

const trimBase = (base: string) => base.replace(/\/$/, '')

export type AutomationPhase =
  | 'deposit_observed'
  | 'bridging'
  | 'swapping'
  | 'complete'
  | 'failed'

export type CorridorAutomationStatus = {
  intent_id: string
  phase: AutomationPhase | string
  updated_at: number
  detail?: string
  receipt?: unknown
  mock_verify?: boolean
  oracle_bound_only?: boolean
  headstash_contract?: string
}

export type OracleMidDisplay = {
  marketId: string
  /** Raw JSON or mid string for display */
  raw: string
  available: boolean
}

/** Map automation phase → wizard status phase. */
export const automationToStatusPhase = (
  phase: string
): CorridorStatusPhase => {
  switch (phase) {
    case 'deposit_observed':
      return 'deposit_observed'
    case 'bridging':
      return 'bridging'
    case 'swapping':
      return 'swapping'
    case 'complete':
      return 'complete'
    case 'failed':
      return 'failed'
    default:
      return 'bridging'
  }
}

/**
 * Poll host automation status (hash-market coordination API).
 * 404 → null (not started yet).
 */
export const pollAutomationStatus = async (
  notifyBase: string,
  intentId: string
): Promise<CorridorAutomationStatus | null> => {
  const res = await fetch(
    `${trimBase(notifyBase)}/corridor/automation/${encodeURIComponent(intentId)}`
  )
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    throw new Error(`automation status ${res.status}`)
  }
  return res.json()
}

/** PUT phase from browser only when acting as lab driver (rare). Prefer host script. */
export const putAutomationStatus = async (
  notifyBase: string,
  intentId: string,
  body: {
    phase: AutomationPhase
    detail?: string
    mock_verify?: boolean
    oracle_bound_only?: boolean
    headstash_contract?: string
    receipt?: unknown
  }
): Promise<CorridorAutomationStatus> => {
  const res = await fetch(
    `${trimBase(notifyBase)}/corridor/automation/${encodeURIComponent(intentId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) {
    throw new Error(`automation put ${res.status}`)
  }
  return res.json()
}

/**
 * Fetch Connect-style oracle mid for UI swap step (bound_only).
 * When bounds are disabled, returns available=false (host pure swap still valid).
 */
export const fetchOracleMid = async (
  oracleBase: string,
  marketId: string
): Promise<OracleMidDisplay> => {
  const base = trimBase(oracleBase)
  if (!base) {
    return { marketId, raw: '', available: false }
  }
  try {
    const res = await fetch(
      `${base}/oracle/bounds?market_id=${encodeURIComponent(marketId)}`
    )
    const text = await res.text()
    return {
      marketId,
      raw: text.slice(0, 500),
      available: res.ok,
    }
  } catch {
    return { marketId, raw: '', available: false }
  }
}

export type DepositReverifyArgs = {
  address: string
  txid: string
  minAmountSats?: number
  minConfirmations?: number
  network?: 'mainnet' | 'testnet' | 'signet'
  /** Local/funded Esplora base(s); when set, replaces public multi-fallback. */
  esploraUrls?: string[]
}

export type PostDepositHooks = {
  headstashContract: string
  notesBase: string
  oracleBase: string
  notifyBase: string
  assetBackend: CorridorAssetBackend
  intentId: string
  oracleMarketId: string
  /** Intent min_out / slip for oracle display (oracle never mints). */
  minOutValue?: string
  maxSlippageBps?: number
  onPhase: (phase: CorridorStatusPhase, detail?: string) => void
  onOracleMid?: (mid: OracleMidDisplay) => void
  /**
   * Re-verify observation before treating deposit as real (D4).
   * Required path when SSE provides a chain txid — Wizard call-site passes this.
   */
  depositReverify?: DepositReverifyArgs
  /**
   * When true, skip Esplora re-verify (dangerous operator override only).
   * Default false — fail-closed modes must re-verify when depositReverify set.
   */
  skipReverify?: boolean
  onReverify?: (r: ReverifyResult) => void
  /** Abort polling */
  signal?: { aborted: boolean }
}

/**
 * Drive post-deposit sequence for production / lc_live / ict_local_funded:
 * Esplora re-verify (depositReverify from SSE observation) [FAIL-CLOSED] →
 * oracle mid probe → poll host automation phases
 * (deposit_observed → bridging → swapping → complete).
 *
 * Does **not** invent a successful chain mint without host reporting complete.
 * Lab_simulated should use the local STATUS_FILM_PHASES path instead.
 * Call sites must pass depositReverify when observation has a real txid (D4).
 */
export const runProductionPostDepositSequence = async (
  hooks: PostDepositHooks
): Promise<'complete' | 'failed' | 'awaiting_host' | 'lab_skip'> => {
  const {
    assetBackend,
    notifyBase,
    intentId,
    oracleBase,
    oracleMarketId,
    headstashContract,
    notesBase,
    minOutValue,
    maxSlippageBps,
    onPhase,
    onOracleMid,
    signal,
  } = hooks

  if (isLabSimulatedBackend(assetBackend)) {
    return 'lab_skip'
  }

  if (!isProductionBackend(assetBackend)) {
    return 'awaiting_host'
  }

  const failClosed = isFailClosedReverifyBackend(assetBackend)

  onPhase(
    'deposit_observed',
    failClosed
      ? 'Deposit observed — fail-closed Esplora re-verify when txid present (D4)'
      : 'Deposit observed — re-verifying on Esplora when configured (D4)'
  )

  // D4: observation is a hint — re-check chain before production automation film.
  if (hooks.depositReverify && !hooks.skipReverify) {
    const rv = await reverifyDepositObservation({
      address: hooks.depositReverify.address,
      txid: hooks.depositReverify.txid,
      minAmountSats: hooks.depositReverify.minAmountSats,
      minConfirmations: hooks.depositReverify.minConfirmations ?? 1,
      network: hooks.depositReverify.network ?? 'mainnet',
      esploraUrls: hooks.depositReverify.esploraUrls,
    })
    hooks.onReverify?.(rv)
    if (!rv.ok) {
      // Fail-closed for production / lc_live / ict_local_funded: do not advance.
      onPhase(
        'failed',
        `BTC re-verify failed (fail-closed): ${rv.error} — reporter observation not trusted alone; automation not advanced`
      )
      return 'failed'
    }
    onPhase(
      'deposit_observed',
      `Re-verified ${rv.funding.amount_sats} sats confs=${rv.funding.confirmations} via ${rv.esploraBase}`
    )
  } else if (hooks.skipReverify && hooks.depositReverify) {
    onPhase(
      'deposit_observed',
      'DANGEROUS operator override: skipped BTC re-verify — observation not chain-checked'
    )
  }

  // Oracle probe for swap step display (never mints — bound_only / D7).
  if (oracleBase) {
    const mid = await fetchOracleMid(oracleBase, oracleMarketId || 'BTC-ZEC')
    onOracleMid?.(mid)
    if (mid.available) {
      onPhase(
        'deposit_observed',
        [
          'Oracle mid available (bound_only — oracle never mints)',
          minOutValue != null ? `intent min_out=${minOutValue}` : null,
          maxSlippageBps != null ? `max_slip_bps=${maxSlippageBps}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      )
    }
  }

  if (!notifyBase) {
    onPhase(
      'bridging',
      headstashContract
        ? `Await host automation for ${headstashContract} (no notifyBase for status poll)`
        : 'Set notesBase/oracleBase (hash-market) for automation poll'
    )
    return 'awaiting_host'
  }

  onPhase(
    'bridging',
    [
      'Bridging: BridgeMintNote @ cw-headstash (mint = headstash, not oracle)',
      notesBase ? `notesBase=${notesBase}` : 'notesBase unset',
      'Host: corridor-lab-mint-after-observe.sh / ict funded profile',
    ].join(' · ')
  )

  // Poll automation phases: deposit_observed → bridging → swapping → complete
  for (let i = 0; i < 40; i++) {
    if (signal?.aborted) {
      return 'awaiting_host'
    }
    try {
      const st = await pollAutomationStatus(notifyBase, intentId)
      if (st) {
        const phase = automationToStatusPhase(st.phase)
        const detailBits = [
          st.detail,
          st.oracle_bound_only === true
            ? 'oracle_bound_only=true (never mints)'
            : null,
          st.mock_verify != null ? `mock_verify=${st.mock_verify}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
        onPhase(phase, detailBits || st.detail)
        if (st.phase === 'complete') {
          return 'complete'
        }
        if (st.phase === 'failed') {
          return 'failed'
        }
      }
    } catch (e) {
      console.warn('automation poll', e)
    }
    await new Promise((r) => setTimeout(r, 3000))
  }

  return 'awaiting_host'
}

/** Human help for operators when UI is waiting on host film. */
export const hostAutomationHint = (intentId: string): string =>
  `INTENT_ID=${intentId} bash docs/plans/spectrum/e2e/corridor-lab-mint-after-observe.sh`
