/**
 * Payment-status machine for ticket checkout.
 *
 * Ported from the permissionless web SVG mint runtime:
 *   ~/src/terp-core/websites/permissionless.money/pages/mint.html
 *     statusMark        (~1388)
 *     ownPhase          (~1395)
 *     PHASE_RANK        (~1413)
 *     CO_OF_PHASE / setCheckoutStep  (~1657)
 *     bumpPhase         (~2843)
 *     startWatch        (2s poll + EventSource /v1/watch)  (~2877)
 *
 * Tickets have no mint step, so UI maps:
 *   waiting → Waiting
 *   Mempool → In the mempool
 *   Deposited → Confirmed
 *   Entitled / Settled → Accepted
 *
 * Security: a mempool (0-conf) sighting is never paid. Paid only on
 * Deposited / Entitled / Settled (or invoice.status === 'paid').
 *
 * `navigator.vibrate` is not in mint.html; it is added here, guarded, on a
 * phase increase, so checkout can give haptic feedback when a payment is
 * seen and when it is accepted.
 */

export type MintPhase = 'waiting' | 'Mempool' | 'Deposited' | 'Entitled' | 'Settled'

export type StatusMark = { n: string | null; mempool: string | null }

export type CheckoutStatus = {
  phase?: string | null
  n_deposit?: unknown
  mempool?: { txid?: string | null } | null
  paid?: boolean
  status?: string | null
}

export const PHASE_RANK: Record<string, number> = {
  waiting: 0,
  Mempool: 1,
  Deposited: 2,
  Entitled: 3,
  Settled: 4,
}

/** Tickets: no minting/minted. Confirmed = on-chain deposit; accepted = settled. */
export const TICKET_OF_PHASE: Record<string, string> = {
  waiting: 'waiting',
  Mempool: 'mempool',
  Deposited: 'confirmed',
  Entitled: 'accepted',
  Settled: 'accepted',
}

export const TICKET_STEPS = ['waiting', 'mempool', 'confirmed', 'accepted'] as const

export const TICKET_LABEL: Record<(typeof TICKET_STEPS)[number], string> = {
  waiting: 'Waiting for payment',
  mempool: 'Seen in the mempool',
  confirmed: 'Confirmed on chain',
  accepted: 'Accepted — on the guest list',
}

export const statusMark = (st: CheckoutStatus | null | undefined): StatusMark => ({
  n: st?.n_deposit ? JSON.stringify(st.n_deposit) : null,
  mempool: st?.mempool?.txid || null,
})

/** Phase of this checkout: anything still pointing at the baseline deposit is not ours. */
export const ownPhase = (st: CheckoutStatus | null | undefined, baseline: StatusMark | null): MintPhase => {
  const phase = (st?.phase || 'waiting') as MintPhase
  if (!baseline) return phase
  const now = statusMark(st)
  if (baseline.n && now.n === baseline.n) return 'waiting'
  if (phase === 'Mempool' && baseline.mempool && now.mempool === baseline.mempool) return 'waiting'
  return phase
}

export const bumpPhase = (last: string, phase: string | null | undefined): MintPhase => {
  const next = (phase || 'waiting') as MintPhase
  if ((PHASE_RANK[next] || 0) >= (PHASE_RANK[last] || 0)) return next
  return (last as MintPhase) || 'waiting'
}

export const ticketStepOf = (phase: string | null | undefined): (typeof TICKET_STEPS)[number] => {
  const mapped = TICKET_OF_PHASE[phase || 'waiting']
  return (TICKET_STEPS as readonly string[]).includes(mapped)
    ? (mapped as (typeof TICKET_STEPS)[number])
    : 'waiting'
}

/** Paid only after an on-chain deposit — never at mempool. */
export const phaseIsPaid = (phase: string | null | undefined, paidFlag?: boolean): boolean => {
  if (phase === 'Mempool') return false
  if (phase && phase in PHASE_RANK) return (PHASE_RANK[phase] || 0) >= PHASE_RANK.Deposited
  return paidFlag === true
}

export const haptic = (pattern: number | number[] = 40): void => {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern)
    }
  } catch {
    /* ignore — not every context allows vibration */
  }
}

export const hapticForBump = (from: string, to: string): void => {
  const a = PHASE_RANK[from] || 0
  const b = PHASE_RANK[to] || 0
  if (b <= a) return
  if (to === 'Mempool') haptic(40)
  else if (b >= PHASE_RANK.Deposited) haptic([30, 40, 80])
}

/** Map a same-origin /sezs/v2/paid body onto the mint status shape. */
export const statusFromPaid = (body: {
  phase?: string | null
  paid?: boolean
  status?: string | null
  invoice?: { txid?: string | null; phase?: string | null } | null
}): CheckoutStatus => {
  const paid = body.paid === true || body.status === 'paid'
  const raw = body.phase || body.invoice?.phase || (paid ? 'Settled' : 'waiting')
  const txid = body.invoice?.txid || null
  return {
    phase: raw,
    paid,
    status: body.status,
    mempool: raw === 'Mempool' && txid ? { txid } : null,
  }
}
