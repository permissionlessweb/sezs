import { prepareWebAuthn } from './rpId.ts'

const b64 = {
  to: (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, ''),
  from: (s: string) => {
    const pad = s.replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(pad)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
    return out.buffer
  },
}

export const credIdOf = (c: PublicKeyCredential) => b64.to(c.rawId)

export async function createPasskey(alias: string): Promise<string> {
  const { rpId } = prepareWebAuthn()
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'SEZS event', id: rpId },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: alias || 'guest',
        displayName: alias || 'guest',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Passkey not created.')
  return credIdOf(cred)
}

export async function assertPasskey(credId: string): Promise<string> {
  return assertAnyOf([credId])
}

/** WebAuthn allowCredentials list = anyOf. Browser picks one device. */
export async function assertAnyOf(credIds: string[]): Promise<string> {
  const ids = credIds.filter(Boolean)
  if (!ids.length) throw new Error('No authenticators.')
  const { rpId } = prepareWebAuthn()
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId,
      allowCredentials: ids.map((id) => ({
        type: 'public-key' as const,
        id: b64.from(id),
      })),
      userVerification: 'preferred',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!assertion) throw new Error('No assertion.')
  const got = credIdOf(assertion)
  if (!ids.includes(got)) throw new Error('Wrong passkey.')
  return got
}

/** Sequential get — every listed device must assert. Two (or more) prompts. */
export async function assertAllOf(credIds: string[]): Promise<void> {
  const ids = credIds.filter(Boolean)
  if (!ids.length) throw new Error('No authenticators.')
  for (const id of ids) {
    await assertAnyOf([id])
  }
}
