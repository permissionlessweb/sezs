import { sessionUrl } from '../auth/session'
/** Client for the splash usher-device grant API. Loopback, cookie session. */

const headers = { 'content-type': 'application/json', 'x-sezs-splash': '1' }

const json = async (res: Response) => {
  const body = await res.json().catch(() => ({ ok: false, error: 'bad_json' }))
  return body as Record<string, unknown>
}

const post = (path: string, body: unknown) =>
  fetch(path, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) }).then(json)

export type DeviceRecord = {
  hash: string
  label: string
  status: 'active' | 'revoked' | string
  usher: string
  eventId: string
  contract?: string
  capabilities: string
  expiry: number
  deviceSignPubkey: string
  deviceNoiseStatic: string
  lastSeen: number
  lastSeq: number
  revokedAt?: number
  createdAt?: number
  admin?: string
  connected?: boolean
}

export const listDevices = async (): Promise<DeviceRecord[]> => {
  const res = await fetch('/sezs/v2/door/device/grants', { credentials: 'include', headers: { 'x-sezs-splash': '1' } })
  const data = await json(res)
  return ((data.devices as DeviceRecord[]) || [])
}

export const registerGrant = (body: { grantText: string; adminSig: unknown; admin?: string; label?: string }) =>
  post('/sezs/v2/door/device/grant', body)

export const renameDevice = (hash: string, label: string) => post('/sezs/v2/door/device/rename', { hash, label })

export const revokeDevice = (hash: string) => post('/sezs/v2/door/device/revoke', { hash })

export const nextIngestedFrame = async () => {
  const res = await fetch('/sezs/v2/door/device/next', { credentials: 'include', headers: { 'x-sezs-splash': '1' } })
  return json(res) as Promise<{ ok: boolean; frame?: { frameText: string; frameSig: string; grantHash?: string } | null }>
}

export const shortPub = (hex: string) => {
  const s = String(hex || '')
  return s.length <= 16 ? s : `${s.slice(0, 8)}…${s.slice(-6)}`
}

export const formatSeen = (ts: number) => {
  if (!ts) return 'never'
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return new Date(ts * 1000).toLocaleString()
}

export type EventUsher = { terp: string; label?: string }
export type EventRoles = {
  ok?: boolean
  eventId?: string
  coordinators?: string[]
  curators?: string[]
  ushers?: EventUsher[]
  coordinatorsGroup?: string
  usherGroup?: string
  signing?: { methods?: string[] }
  error?: string
}

export const listRoles = async (): Promise<EventRoles> => {
  const res = await fetch(sessionUrl('/sezs/v2/event/roles'), { credentials: 'include', headers: { 'x-sezs-splash': '1' } })
  return json(res) as Promise<EventRoles>
}
