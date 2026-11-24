/**
 * ADR-36 staff login against the loopback splash, using a session keyring
 * coordinator. Production path. Never logs key material.
 */
import { sessionCoordinator } from './session-coord-sign.mjs'

export const staffLogin = async (app = process.env.SEZS_APP || 'http://127.0.0.1:3051') => {
  const coord = sessionCoordinator()
  const origin = app
  const chRes = await fetch(app + '/sezs/session/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sezs-frost': '1' },
    body: JSON.stringify({ origin, artist_id: coord.address }),
  })
  const ch = await chRes.json()
  if (!ch?.ok || !ch.message || !ch.nonce) throw new Error('challenge')
  const signed = coord.sign(ch.message)
  const verRes = await fetch(app + '/sezs/session/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sezs-frost': '1' },
    body: JSON.stringify({
      origin,
      artist_id: coord.address,
      nonce: ch.nonce,
      ts: ch.ts,
      method: 'adr036',
      login_id: coord.address,
      pub_key: signed.pub_key,
      signature: signed.signature,
    }),
  })
  const body = await verRes.json()
  const raw = verRes.headers.get('set-cookie') || ''
  const m = /sezs_splash=([a-z0-9-]{1,32})/.exec(raw)
  if (!body?.ok || !m) throw new Error(body?.error || 'verify')
  return { address: coord.address, role: body.role, cookie: m[1], header: `sezs_splash=${m[1]}`, live: body.live, source: body.source }
}
