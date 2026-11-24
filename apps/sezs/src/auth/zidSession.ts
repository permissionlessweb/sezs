/**
 * Client helpers for the ZID login challenge / verify endpoints.
 * Never logs the signature or the public key material.
 */
import { hasInboxBackend, sessionUrl } from './session.ts'
import type { ZidChallenge } from './zidLogin.ts'

const bytesToHex = (u8: Uint8Array) =>
  Array.from(u8, (x) => x.toString(16).padStart(2, '0')).join('')

export const zidLoginMessage = ({
  origin,
  nonce,
  ts,
}: {
  origin: string
  nonce: string
  ts: number
}) =>
  [
    'SEZS-LOGIN-ZID-V1',
    `origin: ${origin}`,
    `audience: sezs`,
    `nonce: ${nonce}`,
    `ts: ${ts}`,
  ].join('\n')

function localNonceHex(): string {
  const buf = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf)
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  return bytesToHex(buf)
}

export async function issueZidChallenge(origin: string): Promise<ZidChallenge> {
  if (!hasInboxBackend()) {
    const nonce = localNonceHex()
    const ts = Date.now()
    const message = zidLoginMessage({ origin, nonce, ts })
    const challengeHex = bytesToHex(new TextEncoder().encode(message))
    return {
      nonce,
      ts,
      challengeHex,
      statement: `Sign in to ${origin}`,
    }
  }
  const res = await fetch(sessionUrl('/sezs/session/challenge'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-sezs-frost': '1' },
    body: JSON.stringify({ origin, kind: 'zid' }),
  })
  const ch = (await res.json()) as {
    ok?: boolean
    nonce?: string
    ts?: number
    challengeHex?: string
    message?: string
    statement?: string
    error?: string
  }
  if (!ch?.ok || !ch.nonce || !ch.ts) {
    throw new Error(ch?.error || 'The server did not issue a sign-in challenge.')
  }
  const message = ch.message || zidLoginMessage({ origin, nonce: ch.nonce, ts: ch.ts })
  const challengeHex = ch.challengeHex || bytesToHex(new TextEncoder().encode(message))
  return {
    nonce: ch.nonce,
    ts: ch.ts,
    challengeHex,
    statement: ch.statement || `Sign in to ${origin}`,
  }
}

export async function verifyZidSession(args: {
  origin: string
  nonce: string
  ts: number
  publicKey: string
  signature: string
}): Promise<{ ok: boolean; login_id?: string; role?: string; error?: string }> {
  if (!hasInboxBackend()) {
    if (!args.publicKey || !args.signature) return { ok: false, error: 'no_sig' }
    return { ok: true, login_id: args.publicKey, role: 'guest' }
  }
  try {
    const res = await fetch(sessionUrl('/sezs/session/verify'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-sezs-frost': '1' },
      body: JSON.stringify({
        origin: args.origin,
        nonce: args.nonce,
        ts: args.ts,
        method: 'zid',
        publicKey: args.publicKey,
        signature: args.signature,
      }),
    })
    const data = (await res.json()) as { ok?: boolean; login_id?: string; role?: string; error?: string }
    if (!data?.ok) return { ok: false, error: data?.error || 'verify' }
    return { ok: true, login_id: data.login_id, role: data.role }
  } catch {
    return { ok: false, error: 'inbox_unreachable' }
  }
}
