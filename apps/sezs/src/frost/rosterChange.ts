/**
 * Holder add/remove. Same rules as FrostCommittee::invoke_rotate_roster.
 * A new seat is not a holder until t current holders agree, and the group
 * verifying key must change in the same step. This module does not sign,
 * store shares, or broadcast.
 */

export type RosterState = {
  epoch: number
  t: number
  n: number
  groupVk: string
  seats: string[]
  oldVk: string | null
  rekeyTxid: string | null
  pending: null | {
    newVk: string
    nextSeats: string[]
    nextT: number
    nextN: number
    shares: Record<string, string>
  }
  spentBlobs: string[]
}

export type RosterResult =
  | { ok: true; state: RosterState }
  | { ok: false; error: string; state: RosterState }

const SEAT = /^[a-z][a-z0-9-]{0,31}$/

export function initialRoster(vk = 'vk-lab'): RosterState {
  const seats = ['desk', 'steward', 'spare']
  return {
    epoch: 0,
    t: 2,
    n: seats.length,
    groupVk: vk,
    seats,
    oldVk: null,
    rekeyTxid: null,
    pending: null,
    spentBlobs: [],
  }
}

export function isHolder(state: RosterState, id: string): boolean {
  return state.seats.includes(id)
}

function fail(state: RosterState, error: string): RosterResult {
  return { ok: false, error, state }
}

function checkNext(seats: string[], t: number, n: number): string | null {
  if (seats.length === 0) return 'empty_roster'
  if (seats.some((s) => !SEAT.test(s))) return 'bad_seat'
  if (new Set(seats).size !== seats.length) return 'duplicate_seat'
  if (n !== seats.length) return 'n_mismatch'
  if (t < 1 || t > n) return 'bad_threshold'
  return null
}

/** Add or remove one seat. Callers must supply a new group verifying key. */
export function proposeRosterChange(
  state: RosterState,
  actor: string,
  newVk: string,
  seat: string,
  action: 'add' | 'remove'
): RosterResult {
  if (!isHolder(state, actor)) return fail(state, 'not_admin')
  const vk = newVk.trim()
  if (!vk) return fail(state, 'empty_vk')
  if (vk === state.groupVk) return fail(state, 'same_vk')
  if (state.pending) return fail(state, 'already_pending')
  const id = seat.trim().toLowerCase()
  if (!SEAT.test(id)) return fail(state, 'bad_seat')
  let next = [...state.seats]
  if (action === 'add') {
    if (next.includes(id)) return fail(state, 'duplicate_seat')
    next.push(id)
  } else {
    if (!next.includes(id)) return fail(state, 'not_holder')
    if (next.length <= state.t) return fail(state, 'bad_threshold')
    next = next.filter((s) => s !== id)
  }
  const nextT = Math.min(state.t, next.length)
  const err = checkNext(next, nextT, next.length)
  if (err) return fail(state, err)
  return {
    ok: true,
    state: {
      ...state,
      pending: {
        newVk: vk,
        nextSeats: next,
        nextT,
        nextN: next.length,
        shares: {},
      },
    },
  }
}

/** Current holder agrees. The person being added cannot agree. */
export function ackRosterChange(
  state: RosterState,
  actor: string,
  blob: string
): RosterResult {
  const p = state.pending
  if (!p) return fail(state, 'not_pending')
  if (!isHolder(state, actor)) return fail(state, 'not_admin')
  const b = blob.trim()
  if (!b) return fail(state, 'empty_share')
  if (b.toLowerCase().includes('keypackage')) return fail(state, 'keypackage_rejected')
  if (p.shares[actor]) return fail(state, 'duplicate_admin')
  if (state.spentBlobs.includes(b)) return fail(state, 'share_replay_epoch')
  const shares = { ...p.shares, [actor]: b }
  if (Object.keys(shares).length < state.t) {
    return { ok: true, state: { ...state, pending: { ...p, shares } } }
  }
  return {
    ok: true,
    state: {
      ...state,
      oldVk: state.groupVk,
      groupVk: p.newVk,
      seats: p.nextSeats,
      t: p.nextT,
      n: p.nextN,
      epoch: state.epoch + 1,
      rekeyTxid: null,
      pending: null,
      spentBlobs: [...state.spentBlobs, ...Object.values(shares)],
    },
  }
}

export function needsRekey(state: RosterState): boolean {
  return state.oldVk !== null && !state.rekeyTxid
}

/** Record a rekey txid. Does not check the chain. */
export function recordRekey(state: RosterState, txid: string): RosterResult {
  if (!state.oldVk) return fail(state, 'not_pending')
  if (state.rekeyTxid) return fail(state, 'already_broadcast')
  const t = txid.trim().toLowerCase()
  if (t.length !== 64 || ![...t].every((c) => '0123456789abcdef'.includes(c))) {
    return fail(state, 'fixture_txid')
  }
  if (t === 'a'.repeat(64) || t === '0'.repeat(64)) return fail(state, 'fixture_txid')
  return { ok: true, state: { ...state, rekeyTxid: t } }
}

export function canSpend(state: RosterState): string | null {
  if (needsRekey(state)) return 'rekey_incomplete'
  if (state.pending) return 'already_pending'
  return null
}
