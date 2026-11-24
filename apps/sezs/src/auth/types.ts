import type { PasskeyParams } from './smartAccountTx'

export type Role = 'guest' | 'usher' | 'admin' | 'coordinator'

export type Rail =
  | 'zec'
  | 'penumbra'
  | 'btc'
  | 'eth'
  | 'base'
  | 'cashapp'

export type PaidFact = {
  rail: Rail
  at: number
  recordId?: string
}

export type AuthPolicy = 'anyOf' | 'allOf'

export type DeviceAuthenticator = {
  credId: string
  label: string
  addedAt: number
}

/** Sign-in adapters. Keplr is not a login option. `zafu` is a leftover terp-address session only. */
export type WalletKind = 'zid' | 'zafu' | 'passkey' | 'browser' | 'email'

/**
 * How this guest signed in. Complete when:
 *   - ZID: a site-scoped ed25519 pubkey is present (kind `ed25519/zid`)
 *   - passkey: a WebAuthn P-256 assertion was verified (kind `p256/passkey`)
 *   - browser: the browser key is registered on chain with the passkey
 *   - email: the backend has verified the mailbox (hidden on the alpha unless enabled)
 * Public facts only — never a mnemonic, private key, or sealed blob here.
 */
export type SignInWallet = {
  kind: WalletKind
  /** terp1 address when one exists (browser registration, leftover zafu session) */
  address: string
  /** site-scoped Zafu ZID public key, hex (kind ed25519/zid) */
  zidPubkey?: string
  /** verified email, when the email runtime exists */
  email?: string
  emailVerified?: boolean
  /** passkey sign-in only: set after WebAuthn assertion verified */
  passkeyVerified?: boolean
  /** browser / passkey: base64 33-byte secp256k1 pubkey of the sealed browser key */
  browserPubkey?: string
  /** browser / passkey: credential id (base64url) */
  passkeyCredId?: string
  /** browser / passkey: public passkey facts (P-256 pubkey, origin, rp_id) */
  passkey?: PasskeyParams
  /** browser only: set after the PartitionedAllOf authenticator is on chain */
  registered?: { txhash: string; authenticatorId: string; at: number }
  /** browser only: when the setup (root) key was dropped from this tab */
  originDestroyedAt?: number
  connectedAt: number
}

export type AuthSession = {
  /** First cred — still the buyerBinding for Cash App / DREGG. */
  credId: string
  authenticators: DeviceAuthenticator[]
  policy: AuthPolicy
  role: Role
  alias: string
  paid?: PaidFact
  wallet?: SignInWallet
  createdAt: number
}

export const signInComplete = (s?: AuthSession | null): boolean => {
  const w = s?.wallet
  if (!w) return false
  if (w.kind === 'zid') return !!w.zidPubkey
  if (w.kind === 'passkey') return !!w.passkeyCredId && !!w.passkeyVerified
  if (w.kind === 'email') return !!w.email && !!w.emailVerified
  if (w.kind === 'browser') return !!w.address && !!w.registered
  return !!w.address
}

export const walletLabel = (kind?: string) =>
  kind === 'zid' || kind === 'zafu'
    ? 'Zafu'
    : kind === 'passkey'
      ? 'passkey'
      : kind === 'browser'
        ? 'this browser'
        : kind === 'email'
          ? 'email'
          : ''

export const walletDisplayId = (w?: SignInWallet | null) => {
  if (!w) return ''
  if (w.kind === 'zid' && w.zidPubkey) {
    const p = w.zidPubkey
    return p.length > 14 ? `${p.slice(0, 8)}…${p.slice(-4)}` : p
  }
  if (w.kind === 'passkey' && w.passkeyCredId) {
    const p = w.passkeyCredId
    return p.length > 14 ? `${p.slice(0, 8)}…${p.slice(-4)}` : p
  }
  if (w.kind === 'email' && w.email) return w.email
  const a = w.address
  return a && a.length > 14 ? `${a.slice(0, 9)}…${a.slice(-4)}` : a || ''
}

export const AUTH_KEY = 'sezs-auth-v1'
