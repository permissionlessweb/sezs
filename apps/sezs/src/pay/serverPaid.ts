import { Rail } from '../auth/types'
import { Instruct, PollResult } from './types'

export type ServerPaid = {
  paid: boolean
  rail?: Rail
  recordId?: string
  label?: string
}

const RAILS: Rail[] = ['zec', 'eth', 'base', 'penumbra', 'btc', 'cashapp']

const railOf = (s: unknown): Rail | undefined => {
  const v = String(s || '')
  return RAILS.find((r) => r === v)
}

/**
 * Unlock only from a server watcher body. A bare `{paid:true}` does not unlock.
 */
export const parseTicketBody = (body: unknown): ServerPaid => {
  if (!body || typeof body !== 'object') {
    return { paid: false, label: 'No server watcher fact. Ticket unpaid.' }
  }
  const v = body as Record<string, unknown>
  const recordId = String(v.record_id || v.recordId || '').trim()
  const rail = railOf(v.rail)
  const paidFlag = v.paid === true
  const ok = v.ok === true || v.status === 'paid'
  if (paidFlag && ok && recordId && rail && rail !== 'cashapp') {
    return {
      paid: true,
      rail,
      recordId,
      label: String(v.label || 'Watcher fact on the server. Ticket paid.'),
    }
  }
  return {
    paid: false,
    label: String(
      v.label ||
        v.error ||
        'No server watcher fact. A paid flag without a record is ignored.'
    ),
  }
}

/**
 * Guest browsers cannot reach lab loopback. Paid stays a server fact.
 * This page does not fetch :19091 / :8421.
 */
export async function readServerPaid(binding: string): Promise<ServerPaid> {
  const b = binding.trim()
  if (!b) return { paid: false, label: 'Need a binding to read paid.' }
  return { paid: false, label: 'Checkout opens soon. Ticket unpaid.' }
}

export const recipientOf = (issued: Instruct): string => {
  if (issued.kind === 'uri' || issued.kind === 'dest') {
    return (issued.recipient || '').trim()
  }
  return ''
}

export const destOf = (issued: Instruct): string => {
  if (issued.kind === 'dest') return issued.dest
  if (issued.kind === 'uri') return issued.text
  return ''
}

export const recordOf = (issued: Instruct): string => {
  if (issued.kind === 'uri') return issued.memoCommit || issued.text
  if (issued.kind === 'dest') return issued.memoCommit || issued.dest
  return ''
}

/** Guest poll is honest, not a loopback fetch. Never marks paid. */
export async function pollServerWatch(
  _rail: Rail,
  issued: Instruct
): Promise<PollResult> {
  if (issued.kind !== 'uri' && issued.kind !== 'dest') {
    return { status: 'not_live', message: 'Checkout opens soon. Not paid.' }
  }
  return { status: 'not_live', message: 'Checkout opens soon. Not paid.' }
}
