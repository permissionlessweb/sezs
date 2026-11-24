/**
 * Passkey create/get for:
 *   1. Passkey session sign-in (`createPasskeyForSignIn`, `assertPasskeyChallenge`),
 *      which verifies a P-256 WebAuthn assertion without requiring PRF.
 *   2. The browser-key path (`createPasskeyWithKey`, `assertWithPrf`), where a
 *      browser secp256k1 key is sealed with AES-GCM under a 32-byte key derived
 *      from WebAuthn PRF (failing closed if PRF is absent so nothing is stored).
 *
 * P-256 (ES256) only: both the session backend and terp-passkey verify secp256r1.
 */
import { credIdOf } from './webauthn.ts'
import type { PasskeyParams } from './smartAccountTx.ts'
import { b64, fromB64 } from './smartAccountTx.ts'
import { prepareWebAuthn } from './rpId.ts'

export type PasskeyAssertionPayload = {
  clientDataJSON: string
  authenticatorData: string
  signature: string
}

export type PasskeyRegistration = {
  credId: string
  params: PasskeyParams
}

export type PasskeyWithKey = PasskeyRegistration & {
  prfKey: Uint8Array
  assertion?: PasskeyAssertionPayload
}

/** App-specific PRF salt. Stable across devices for this origin and app. */
export const PRF_SALT_LABEL = 'sezs-speakeasy/browser-key-seal/v1'

export const prfSalt = async (): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PRF_SALT_LABEL)))

export const prfExtension = async (): Promise<AuthenticationExtensionsClientInputs> => {
  const salt = await prfSalt()
  const buf = new ArrayBuffer(salt.byteLength)
  new Uint8Array(buf).set(salt)
  return { prf: { eval: { first: buf } } } as AuthenticationExtensionsClientInputs
}

/** 32-byte PRF output, or null if the authenticator omitted it. */
export function prfOf(cred: PublicKeyCredential): Uint8Array | null {
  const ext = cred.getClientExtensionResults?.() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | ArrayBufferView } }
  }
  const first = ext?.prf?.results?.first
  if (!first) return null
  const out = ArrayBuffer.isView(first)
    ? new Uint8Array(first.buffer, first.byteOffset, first.byteLength)
    : new Uint8Array(first)
  return out.length === 32 ? out : out.length > 32 ? out.slice(0, 32) : null
}

export const PRF_UNSUPPORTED =
  'This authenticator cannot lock a browser key (WebAuthn PRF is missing). Nothing was stored. Use Zafu, or a passkey manager that supports the PRF extension.'

/**
 * Feature-detect the PRF extension. Unknown (older browsers without
 * getClientCapabilities) is "maybe" — the ceremony still has to prove it.
 */
export async function detectPrfSupport(): Promise<'yes' | 'no' | 'unknown'> {
  const PK = (globalThis as unknown as { PublicKeyCredential?: typeof PublicKeyCredential }).PublicKeyCredential
  if (!PK) return 'no'
  const cap = (PK as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities
  if (typeof cap !== 'function') return 'unknown'
  try {
    const caps = await cap.call(PK)
    if (caps && caps['extension:prf'] === false) return 'no'
    if (caps && caps['extension:prf'] === true) return 'yes'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

function p256Uncompressed(resp: AuthenticatorAttestationResponse): Uint8Array | null {
  const r = resp as AuthenticatorAttestationResponse & {
    getPublicKey?: () => ArrayBuffer | null
    getPublicKeyAlgorithm?: () => number
  }
  if (typeof r.getPublicKeyAlgorithm === 'function' && r.getPublicKeyAlgorithm() !== -7) return null
  const spki = typeof r.getPublicKey === 'function' ? r.getPublicKey() : null
  if (!spki) return null
  const u8 = new Uint8Array(spki)
  const k = u8.slice(u8.length - 65)
  return k.length === 65 && k[0] === 0x04 ? k : null
}

const uvRequired = {
  residentKey: 'preferred' as const,
  userVerification: 'required' as const,
}

const b64Url = (bytes: Uint8Array): string =>
  b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * Create a P-256 passkey for session sign-in without requiring PRF.
 * Used when no browser key needs to be sealed or stored.
 */
export async function createPasskeyForSignIn(alias: string): Promise<PasskeyRegistration> {
  if (!globalThis.PublicKeyCredential) throw new Error('This browser can’t make a passkey.')
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
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: uvRequired,
      timeout: 120_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Passkey not created.')
  const pub = p256Uncompressed(cred.response as AuthenticatorAttestationResponse)
  if (!pub) {
    throw new Error('This passkey isn’t a P-256 key, so the server can’t verify it. Try another passkey manager, or use Zafu.')
  }
  return {
    credId: credIdOf(cred),
    params: {
      origin: location.origin,
      rp_id: rpId,
      credential_id: b64(new Uint8Array(cred.rawId)),
      public_key: b64(pub),
    },
  }
}

export async function createPasskeyWithKey(
  alias: string,
  opts?: { challengeB64?: string },
): Promise<PasskeyWithKey> {
  if (!globalThis.PublicKeyCredential) throw new Error('This browser can’t make a passkey.')
  if ((await detectPrfSupport()) === 'no') throw new Error(PRF_UNSUPPORTED)
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
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: uvRequired,
      timeout: 120_000,
      attestation: 'none',
      extensions: await prfExtension(),
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Passkey not created.')
  const pub = p256Uncompressed(cred.response as AuthenticatorAttestationResponse)
  if (!pub) {
    throw new Error('This passkey isn’t a P-256 key, so the chain can’t check it. Try another passkey manager, or use Zafu.')
  }
  const credId = credIdOf(cred)
  let prf = prfOf(cred)
  let assertion: PasskeyAssertionPayload | undefined

  // Chrome/Safari often return `{ prf: { enabled: true } }` on create() and only emit
  // `prf.results.first` on get(). Combine that follow-up get() with any session challenge.
  if (opts?.challengeB64) {
    const got = await assertPasskeyChallenge(credId, opts.challengeB64, { withPrf: true })
    if (!prf) prf = got.prf
    assertion = got.assertion
  } else if (!prf) {
    prf = await assertWithPrf(credId)
  }

  if (!prf) throw new Error(PRF_UNSUPPORTED)
  return {
    credId,
    params: {
      origin: location.origin,
      rp_id: rpId,
      credential_id: b64(new Uint8Array(cred.rawId)),
      public_key: b64(pub),
    },
    prfKey: prf,
    ...(assertion ? { assertion } : {}),
  }
}

/** Unlock an existing passkey and read its 32-byte PRF output. */
export async function assertWithPrf(credIdB64url: string): Promise<Uint8Array | null> {
  const { rpId } = prepareWebAuthn()
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId,
      allowCredentials: [{ type: 'public-key', id: fromB64(credIdB64url) }],
      userVerification: 'required',
      timeout: 120_000,
      extensions: await prfExtension(),
    },
  })) as PublicKeyCredential | null
  if (!assertion) throw new Error('No assertion.')
  if (credIdOf(assertion) !== credIdB64url) throw new Error('Wrong passkey.')
  return prfOf(assertion)
}

/**
 * Assert a passkey against a server challenge (base64url) with UV required.
 * Omit `credIdB64url` for discoverable sign-in with an existing passkey.
 */
export async function assertPasskeyChallenge(
  credIdB64url: string | null | undefined,
  challengeB64: string,
  opts?: { withPrf?: boolean },
): Promise<{ credId: string; prf: Uint8Array | null; assertion: PasskeyAssertionPayload }> {
  const { rpId } = prepareWebAuthn()
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: fromB64(challengeB64),
      rpId,
      ...(credIdB64url ? { allowCredentials: [{ type: 'public-key' as const, id: fromB64(credIdB64url) }] } : {}),
      userVerification: 'required',
      timeout: 120_000,
      ...(opts?.withPrf ? { extensions: await prfExtension() } : {}),
    },
  })) as PublicKeyCredential | null
  if (!assertion) throw new Error('No assertion.')
  const gotCredId = credIdOf(assertion)
  if (credIdB64url && gotCredId !== credIdB64url) throw new Error('Wrong passkey.')
  const resp = assertion.response as AuthenticatorAssertionResponse
  return {
    credId: gotCredId,
    prf: opts?.withPrf ? prfOf(assertion) : null,
    assertion: {
      clientDataJSON: b64Url(new Uint8Array(resp.clientDataJSON)),
      authenticatorData: b64Url(new Uint8Array(resp.authenticatorData)),
      signature: b64Url(new Uint8Array(resp.signature)),
    },
  }
}
