/**
 * Client helpers for WebAuthn passkey session challenge / verify endpoints.
 * Never logs signatures or key material.
 */
import { hasInboxBackend, sessionUrl } from './session'
import type { PasskeyAssertionPayload } from './passkeyKey'

export type PasskeyChallenge = {
  nonce: string
  ts: number
  challengeB64: string
  rpId?: string
}

const b64Url = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function localNonceHex(): string {
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  return Array.from(buf, (x) => x.toString(16).padStart(2, '0')).join('')
}

export async function issuePasskeyChallenge(origin: string, credId?: string): Promise<PasskeyChallenge> {
  if (!hasInboxBackend()) {
    return {
      nonce: localNonceHex(),
      ts: Date.now(),
      challengeB64: b64Url(crypto.getRandomValues(new Uint8Array(32))),
    }
  }
  const res = await fetch(sessionUrl('/sezs/session/challenge'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-sezs-frost': '1' },
    body: JSON.stringify({ origin, kind: 'passkey', ...(credId ? { credId } : {}) }),
  })
  const ch = (await res.json()) as {
    ok?: boolean
    nonce?: string
    ts?: number
    challengeB64?: string
    rpId?: string
    error?: string
  }
  if (!ch?.ok || !ch.nonce || !ch.ts || !ch.challengeB64) {
    throw new Error(ch?.error || 'The server did not issue a passkey challenge.')
  }
  return {
    nonce: ch.nonce,
    ts: ch.ts,
    challengeB64: ch.challengeB64,
    rpId: ch.rpId,
  }
}

export async function verifyPasskeySession(args: {
  origin: string
  nonce: string
  ts: number
  credId: string
  publicKey?: string
  assertion: PasskeyAssertionPayload
}): Promise<{ ok: boolean; login_id?: string; role?: string; error?: string }> {
  if (!hasInboxBackend()) {
    if (!args.credId || !args.assertion?.signature) return { ok: false, error: 'no_sig' }
    return { ok: true, login_id: args.credId, role: 'guest' }
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
        method: 'passkey',
        credId: args.credId,
        ...(args.publicKey ? { publicKey: args.publicKey } : {}),
        assertion: args.assertion,
      }),
    })
    const data = (await res.json()) as { ok?: boolean; login_id?: string; role?: string; error?: string }
    if (!data?.ok) return { ok: false, error: data?.error || 'verify' }
    return { ok: true, login_id: data.login_id, role: data.role }
  } catch {
    return { ok: false, error: 'inbox_unreachable' }
  }
}
