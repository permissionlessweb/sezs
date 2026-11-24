/**
 * Log in with Zafu via the official @zafu/zid API (site-scoped ed25519 ZID).
 *
 * Login uses requireWallet() + sign(challengeHex), not ADR-36 / signAmino.
 * Those remain only for on-chain execute (usher consume) in zafuExecute.ts.
 *
 * The wallet signs only the challenge bytes and does not bind the origin into
 * the signature, so the server must issue a fresh nonce that already commits
 * to this origin (see session-login.mjs and apps/sezs/docs/ZAFU-CONNECT.md).
 */
import { detect, requireWallet, sign, ZafuError, type ZafuErrorCode } from '@zafu/zid'

import { idleAdapter, reduceAdapter, type AdapterState } from './adapters/machine.ts'
import type { SignInWallet } from './types.ts'

export const ZID_APP_NAME = 'SEZS'
export const ZID_KIND = 'ed25519/zid' as const

export const zafuErrorMessage = (code: ZafuErrorCode | string): string => {
  switch (code) {
    case 'unavailable':
      return 'Zafu isn’t in this browser. Install it, then reload this tab.'
    case 'incompatible':
      return 'This Zafu version doesn’t speak a protocol this page understands. Update Zafu, then reload.'
    case 'denied':
      return 'Zafu declined the request.'
    case 'locked':
      return 'Zafu is locked. Unlock it, then try again.'
    case 'rate_limited':
      return 'Zafu asked this page to wait. Try again in a moment.'
    case 'not_available':
      return 'Zafu’s identity layer is turned off in the wallet settings.'
    case 'transport_error':
      return 'Zafu didn’t answer. Reload this tab after the extension finishes loading.'
    default:
      return 'Zafu could not finish sign-in.'
  }
}

export type ZidChallenge = {
  nonce: string
  ts: number
  challengeHex: string
  statement?: string
}

export type ZidSdk = {
  detect: typeof detect
  requireWallet: typeof requireWallet
  sign: typeof sign
}

const defaultSdk = (): ZidSdk => ({ detect, requireWallet, sign })

const zafuCode = (e: unknown): string | null => {
  if (e instanceof ZafuError) return e.code
  if (e && typeof e === 'object' && 'code' in e && (e as { name?: string }).name === 'ZafuError') {
    return String((e as { code: string }).code)
  }
  return null
}

const asError = (e: unknown): Error => {
  const code = zafuCode(e)
  if (code) return new Error(zafuErrorMessage(code))
  return e instanceof Error ? e : new Error('Zafu could not finish sign-in.')
}

export type ZidLoginDeps = {
  sdk?: ZidSdk
  origin: string
  issueChallenge: (origin: string) => Promise<ZidChallenge>
  verifySignature: (args: {
    origin: string
    nonce: string
    ts: number
    publicKey: string
    signature: string
  }) => Promise<{ ok: boolean; login_id?: string; role?: string; error?: string }>
  onState?: (state: AdapterState) => void
}

/**
 * Official login: detect, require the wallet, sign a server challenge, verify
 * on the splash backend. Maps the resulting pubkey to registry kind ed25519/zid.
 */
export async function loginWithZid(deps: ZidLoginDeps): Promise<SignInWallet> {
  const sdk = deps.sdk || defaultSdk()
  let state = reduceAdapter(idleAdapter(), { type: 'start' })
  deps.onState?.(state)
  try {
    const found = await sdk.detect()
    if (!found.installed) throw new ZafuError('unavailable')
    if (found.compatible === false) throw new ZafuError('incompatible')

    const challenge = await deps.issueChallenge(deps.origin)
    if (!challenge?.challengeHex || !challenge.nonce) {
      throw new Error('The server did not issue a sign-in challenge.')
    }

    state = reduceAdapter(state, { type: 'waiting' })
    deps.onState?.(state)

    const wallet = await sdk.requireWallet()
    const { signature, publicKey } = await sdk.sign(
      wallet,
      challenge.challengeHex,
      challenge.statement || `Sign in to ${deps.origin}`,
    )
    if (!signature || !publicKey) throw new Error('Zafu returned no signature.')

    const verified = await deps.verifySignature({
      origin: deps.origin,
      nonce: challenge.nonce,
      ts: challenge.ts,
      publicKey,
      signature,
    })
    if (!verified?.ok) {
      throw new Error(verified?.error || 'The server could not verify the Zafu signature.')
    }

    const identity = { kind: 'zid', id: publicKey }
    state = reduceAdapter(state, { type: 'success', identity })
    deps.onState?.(state)
    return {
      kind: 'zid',
      zidPubkey: publicKey,
      address: '',
      connectedAt: Date.now(),
    }
  } catch (e) {
    const err = asError(e)
    state = reduceAdapter(state, { type: 'fail', error: err.message })
    deps.onState?.(state)
    throw err
  }
}
