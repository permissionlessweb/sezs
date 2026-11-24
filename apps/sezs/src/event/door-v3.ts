/**
 * v3 door client: usher device proves, Zafu (or a lab stand-in) authorizes,
 * the splash backend relays ConsumeTicket.
 */
import type { ConsumeBody } from './door-v2'
import { fetchDoorV2Config, submitConsumeV2, type DoorV2Config } from './door-v2'

export type PrepareBody = ConsumeBody & {
  usher: string
  eventId?: string
  proofHash?: string
  frameText?: string
  frameSig?: string
  grantHash?: string
}

export type AuthEnvelope = {
  typ: string
  signature: string
  pubKey: string
  signer: string
  message?: string
  bytes?: Uint8Array
  expiresAt?: number
  usher?: string
  eventId?: string
  nullifier?: string
  root?: string
  proofHash?: string
  expiry?: number
}

export const prepareConsumeV3 = async (body: PrepareBody) => {
  const res = await fetch('/sezs/v2/door/prepare', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-sezs-splash': '1' },
    body: JSON.stringify(body),
  })
  return (await res.json()) as {
    ok: boolean
    error?: string
    expiresAt?: number
    usher?: string
    signDoc?: unknown
    unsignedTx?: unknown
    authText?: string
  }
}

export const submitConsumeV3 = async (body: {
  consume: ConsumeBody & { eventId?: string; proofHash?: string }
  auth: AuthEnvelope
  signedTx?: string
  frameText?: string
  frameSig?: string
  grantHash?: string
}) => {
  const res = await fetch('/sezs/v2/door/consume', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-sezs-splash': '1', 'x-sezs-frost': '1' },
    body: JSON.stringify(body),
  })
  return (await res.json()) as {
    ok: boolean
    error?: string
    message?: string
    txhash?: string
    height?: number
    gasUsed?: number
  }
}

export { fetchDoorV2Config, submitConsumeV2 }
export type { DoorV2Config, ConsumeBody }
