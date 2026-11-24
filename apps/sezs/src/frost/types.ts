/** Event FROST pay. Cargo SoT: terp_onboard_authz::sezs_frost. No shares in the browser. */

export type FrostRound =
  | 'idle'
  | 'dkg_open'
  | 'dkg1'
  | 'dkg2'
  | 'dkg_ready'
  | 'dkg_fail'
  | 'queue'
  | 'sign_c'
  | 'sign_s'
  | 'broadcast'
  | 'blocked'

export type SeatLabel = 'desk' | 'steward' | 'spare'

export type FrostSeatPublic = {
  label: SeatLabel
  present: boolean
}

export type GoLiveBlocker =
  | 'dkg_incomplete'
  | 'frostd_unbound'
  | 'inflow_unconfirmed'
  | 'persistence_off'
  | 'no_taddr'
  | 'eighty_before_twenty'
  | 'below_threshold'
  | 'not_admin'

export type PayeeKind = 'artist' | 'vendor' | 'attendee'
export type PayoutLeg = '20' | '80' | 'refund'

export type PayRecord = {
  code: string
  kind: PayeeKind
  name: string
  taddr: string
  leg: PayoutLeg
  amountLabel: string
  attestUrl?: string
  txid?: string
}

export type TicketInflow = {
  recordId: string
  rail: string
  amountLabel: string
}

export type JobStatus = 'pending' | 'threshold' | 'broadcast'

export type FrostStatus = {
  round: FrostRound
  t: number
  n: number
  seats: FrostSeatPublic[]
  uaReady: boolean
  readyForRealMoney: boolean
  blockers: GoLiveBlocker[]
  inflows: TicketInflow[]
  records: PayRecord[]
  inboxShareCount: number
  inboxStatus: JobStatus
}
