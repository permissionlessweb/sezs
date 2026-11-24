import { hasInboxBackend } from '../auth/session'
/**
 * HashMerchant FROST inbox client. Loopback only.
 * Do not webpack frost-spend. Do not send KeyPackages.
 */

export type InboxJob = {
  ok: boolean
  id?: string
  pay_code?: string
  status?: string
  shares?: number
  txid?: string | null
  roster_commit?: string
  error?: string
}

const base = () =>
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SEZS_FROST_INBOX) ||
  ''

const url = (path: string) => {
  const b = base().replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return b ? `${b}${p}` : p
}

async function rpc(method: string, path: string, body?: unknown): Promise<InboxJob> {
  if (!hasInboxBackend()) return { ok: false, error: 'inbox_unreachable' }
  let res: Response
  try {
    res = await fetch(url(path), {
      method,
      headers: {
        'x-sezs-frost': '1',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    return { ok: false, error: 'inbox_unreachable' }
  }
  let data: InboxJob
  try {
    data = (await res.json()) as InboxJob
  } catch {
    return { ok: false, error: 'inbox_unreachable' }
  }
  if (!data.ok && !data.error) data.error = `http_${res.status}`
  return data
}

export const createJob = (args: {
  pay_code: string
  roster_commit: string
  scheme?: string
  target?: string
}) =>
  rpc('POST', '/sezs/frost/jobs', {
    pay_code: args.pay_code,
    scheme: args.scheme || 'RedPallas',
    target: args.target || 'Zcash',
    roster_commit: args.roster_commit,
  })

export const getJob = (id: string) => rpc('GET', `/sezs/frost/jobs/${id}`)

export const submitShare = (id: string, args: {
  admin_id: string
  blob: string
  roster_commit: string
}) => rpc('POST', `/sezs/frost/jobs/${id}/share`, args)

export const broadcastJob = (id: string, txid: string) =>
  rpc('POST', `/sezs/frost/jobs/${id}/broadcast`, { txid })

/** True when a FROST inbox answers with a domain result, not a missing rail. */
export const probeInbox = async (): Promise<boolean> => {
  const res = await rpc('POST', '/sezs/frost/jobs', {})
  if (!res.error) return true
  if (res.error === 'inbox_unreachable' || res.error === 'splash_not_modeled') return false
  if (/^http_/.test(res.error)) return false
  return true
}
