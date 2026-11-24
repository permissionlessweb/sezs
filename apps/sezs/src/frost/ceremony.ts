import {
  FrostStatus,
  GoLiveBlocker,
  PayRecord,
  TicketInflow,
} from './types'

export const FROST_T = 2
export const FROST_N = 3
export const DKG_TIMEOUT_S = 600

export const emptyStatus = (): FrostStatus => ({
  round: 'idle',
  t: FROST_T,
  n: FROST_N,
  seats: [
    { label: 'desk', present: false },
    { label: 'steward', present: false },
    { label: 'spare', present: false },
  ],
  uaReady: false,
  readyForRealMoney: false,
  blockers: ['dkg_incomplete', 'frostd_unbound', 'inflow_unconfirmed'],
  inflows: [],
  records: [],
  inboxShareCount: 0,
  inboxStatus: 'pending',
})

export const blockerCopy: Record<GoLiveBlocker, string> = {
  dkg_incomplete: 'DKG not finished — no event UA yet.',
  frostd_unbound: 'Inbox/frostd not on 127.0.0.1. Hold shares; do not publish.',
  inflow_unconfirmed: 'No confirmed ticket payment. 20% job refused (unpaid cannot pay artists).',
  persistence_off: 'Shares not sealed at rest.',
  no_taddr: 'Artist/vendor dest must be a transparent t-addr (grant accountability).',
  eighty_before_twenty: '80% after event requires a 20% txid on that payee.',
  below_threshold: 'Inbox holds shares until t-of-n. No broadcast yet.',
  not_admin: 'Passkey is not admin. Passkey is not a FROST share.',
}

export function canOpenDkg(s: FrostStatus): boolean {
  return s.round === 'idle' || s.round === 'dkg_fail'
}

export function canQueue(s: FrostStatus): boolean {
  return (
    s.round === 'dkg_ready' &&
    s.uaReady &&
    s.inflows.length > 0 &&
    !s.blockers.includes('inflow_unconfirmed')
  )
}

export function canSign(s: FrostStatus): boolean {
  return s.readyForRealMoney && s.inboxStatus === 'threshold'
}

export function grantRollup(records: PayRecord[]) {
  const m = new Map<
    string,
    { kind: string; name: string; taddr: string; up: string[]; after: string[] }
  >()
  for (const r of records) {
    const k = r.taddr + '|' + r.kind + '|' + r.name
    const row = m.get(k) || {
      kind: r.kind,
      name: r.name,
      taddr: r.taddr,
      up: [],
      after: [],
    }
    if (r.leg === '20') row.up.push(r.txid || 'queued')
    if (r.leg === '80') row.after.push(r.txid || 'queued')
    m.set(k, row)
  }
  return [...m.values()]
}

export function withInflow(s: FrostStatus, inf: TicketInflow): FrostStatus {
  if (!inf.recordId.trim()) return s
  if (s.inflows.some((i) => i.recordId === inf.recordId)) return s
  return {
    ...s,
    inflows: [...s.inflows, inf],
    blockers: s.blockers.filter((b) => b !== 'inflow_unconfirmed'),
  }
}

export type RotateStatus = 'idle' | 'pending' | 'applied' | 'failed'

export function vkCommitHint(vk: string): string {
  return 'c:' + vk.trim()
}
