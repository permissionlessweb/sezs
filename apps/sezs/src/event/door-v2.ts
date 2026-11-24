/**
 * v2 door client: usher challenge + ConsumeTicket broadcast via the lab splash
 * backend (terpd --from the usher keyring name; never prints key material).
 */
export type DoorV2Config = {
  ok: boolean
  error?: string
  contract?: string
  zkid?: number
  eventId?: string
  domain?: string
  eventIdFp?: string
  domainFp?: string
  doorAuthPubkey?: string
  usher?: string
  chainId?: string
  lcd?: string
}

export type ConsumeBody = {
  proof: string
  root: string
  nullifier: string
  event_id: string
  domain: string
  rk_x: string
  rk_y: string
  consent: { live: { challenge: string; sig: string } } | { printed: { sig: string } }
}

const splashHeaders = { 'content-type': 'application/json', 'x-sezs-splash': '1' }

export const fetchDoorV2Config = async (): Promise<DoorV2Config> => {
  const res = await fetch('/sezs/v2/door/config', { credentials: 'include' })
  return (await res.json()) as DoorV2Config
}

export const submitConsumeV2 = async (body: ConsumeBody) => {
  const res = await fetch('/sezs/v2/door/consume', {
    method: 'POST',
    credentials: 'include',
    headers: { ...splashHeaders, 'x-sezs-frost': '1' },
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

const b64 = (u: Uint8Array) => {
  let s = ''
  u.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s)
}

export const liveConsumeMsg = (fields: {
  proof: string
  root: string
  nullifier: string
  event_id: string
  domain: string
  rk_x: string
  rk_y: string
  challenge: Uint8Array
  sig: Uint8Array
}): ConsumeBody => ({
  proof: fields.proof,
  root: fields.root,
  nullifier: fields.nullifier,
  event_id: fields.event_id,
  domain: fields.domain,
  rk_x: fields.rk_x,
  rk_y: fields.rk_y,
  consent: { live: { challenge: b64(fields.challenge), sig: b64(fields.sig) } },
})

export const printedConsumeMsg = (fields: {
  proof: string
  root: string
  nullifier: string
  event_id: string
  domain: string
  rk_x: string
  rk_y: string
  sig: Uint8Array
}): ConsumeBody => ({
  proof: fields.proof,
  root: fields.root,
  nullifier: fields.nullifier,
  event_id: fields.event_id,
  domain: fields.domain,
  rk_x: fields.rk_x,
  rk_y: fields.rk_y,
  consent: { printed: { sig: b64(fields.sig) } },
})
