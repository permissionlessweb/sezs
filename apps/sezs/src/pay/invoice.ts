import { RailId } from '../event/api'
import { penumbraDestOk, zecUriLabOk } from './network'

export const splashOn = (): boolean =>
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SEZS_SPLASH === '1'

export type LabInvoice = {
  id: string
  rail: RailId
  sku: string
  eventId: string
  amountCents: number
  commitment: string
  dest: string
  memo: string
  uri: string | null
  status: 'pending' | 'paid' | 'void'
  paidAt: number | null
  leafIndex?: number | null
  root?: string
  leafCount?: number
  phase?: string | null
  txid?: string | null
}

const headers = { 'content-type': 'application/json', 'x-sezs-splash': '1' }

/** v2 invoice: commitment C only. Refuses ticket pubkey / nullifier. */
export const requestInvoice = async (body: {
  rail: RailId
  commitment: string
  sku: string
  eventId: string
}): Promise<{ ok: boolean; invoice?: LabInvoice; error?: string }> => {
  const res = await fetch('/__splash/api/v2/invoice', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  })
  return (await res.json()) as { ok: boolean; invoice?: LabInvoice; error?: string }
}


export const pollPaid = async (commitment: string) => {
  const res = await fetch('/sezs/v2/paid?c=' + encodeURIComponent(commitment), {
    credentials: 'include',
  })
  return (await res.json()) as { ok: boolean; paid?: boolean; status?: string; phase?: string; invoice?: LabInvoice; error?: string }
}

export const fetchLeaves = async () => {
  const res = await fetch('/sezs/v2/leaves', { credentials: 'include' })
  return (await res.json()) as {
    ok: boolean
    eventId?: string
    leaves?: string[]
    root?: string
    leafCount?: number
    published?: { root: string; epoch: number; leafCount: number; txhash?: string | null } | null
    error?: string
  }
}

export const publishRoot = async (reason: 'doors-open' | 'sales-close' | 'force' | 'interval' = 'force') => {
  const res = await fetch('/__splash/api/v2/root/publish', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ reason }),
  })
  return (await res.json()) as { published?: boolean; skipped?: string; error?: string; epoch?: number; txhash?: string }
}

export const invoiceDestOk = (rail: RailId, inv: LabInvoice): boolean => {
  if (inv.commitment?.length !== 64) return false
  if (rail === 'zec') return !!inv.uri && zecUriLabOk(inv.uri)
  if (rail === 'penumbra') return penumbraDestOk(inv.dest)
  return false
}

export const connectPenumbra = async (): Promise<{ ok: boolean; note: string }> => {
  const provider = (globalThis as { [k: symbol]: { connect?: () => Promise<unknown> } | undefined })[
    Symbol.for('penumbra')
  ]
  if (!provider || typeof provider.connect !== 'function') {
    return {
      ok: false,
      note: 'No Penumbra provider in this browser. Open Zafu, or copy the destination and memo into a UM wallet.',
    }
  }
  try {
    await provider.connect()
    return { ok: true, note: 'Penumbra provider connected. Send the amount with this memo. This page has not marked paid.' }
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : 'The Penumbra provider refused the connect.' }
  }
}
