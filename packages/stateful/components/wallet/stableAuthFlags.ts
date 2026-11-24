/**
 * Wallet stable-auth flags + local passkey storage.
 * Env flag *names* SoT: AUTH_FEATURE_FLAGS in @dao-dao/utils authMethods.
 */
import { AUTH_FEATURE_FLAGS } from '@dao-dao/utils'

export { AUTH_FEATURE_FLAGS, allowPasskeyDevFallback } from '@dao-dao/utils'

const envTrue = (name: string): boolean =>
  typeof process !== 'undefined' && process.env[name] === 'true'

export const ENABLE_WALLETCONNECT = envTrue(AUTH_FEATURE_FLAGS.walletConnect)
export const ENABLE_ZCASH_LOGIN = envTrue(AUTH_FEATURE_FLAGS.zcashLogin)
export const ENABLE_ZCASH_ZECAUTH = envTrue(AUTH_FEATURE_FLAGS.zcashZecAuth)
export const ENABLE_ZCASH_ZNS_LOGIN = envTrue(AUTH_FEATURE_FLAGS.zcashZnsLogin)
export const ENABLE_ZCASH_ZECPASS = envTrue(AUTH_FEATURE_FLAGS.zcashZecPass)


/**
 * Lab wallet modal allowlist (120u-1 / non-mainnet SDA).
 * - Default non-mainnet: only `keplr-extension` (primary lab signing path)
 * - NEXT_PUBLIC_LAB_WALLET_ALLOWLIST=comma,list — override (walletInfo.name)
 * - NEXT_PUBLIC_LAB_WALLET_ALLOWLIST=*|all — register all extension wallets
 * - Mainnet + unset allowlist env: no name filter (existing catalog)
 *
 * Documented known names for walkthrough / Sentry wallet dimension.
 */
export const LAB_WALLET_DEFAULT_ALLOWLIST = ['keplr-extension'] as const

/** Known optional extension names operators may add via env. */
export const LAB_WALLET_KNOWN_NAMES = [
  'keplr-extension',
  'keplr-mobile', // only if ENABLE_WALLETCONNECT
  'cosmos-extension-metamask',
  'exodus-extension',
  'vultisig-extension',
  'leap-metamask-cosmos-snap',
] as const

const envIsMainnet = (): boolean =>
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_MAINNET === 'true'

/**
 * Resolved allowlist of cosmos-kit wallet names, or `null` when unrestricted.
 */
export const getLabWalletAllowlist = (): string[] | null => {
  if (typeof process === 'undefined') {
    return envIsMainnet() ? null : [...LAB_WALLET_DEFAULT_ALLOWLIST]
  }
  const raw = process.env.NEXT_PUBLIC_LAB_WALLET_ALLOWLIST?.trim()
  if (raw) {
    if (raw === '*' || raw.toLowerCase() === 'all') {
      return null
    }
    const names = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return names.length ? names : [...LAB_WALLET_DEFAULT_ALLOWLIST]
  }
  // Lab / testnet SDA: keep connect modal quiet (Keplr only).
  if (!envIsMainnet()) {
    return [...LAB_WALLET_DEFAULT_ALLOWLIST]
  }
  return null
}

/** True when connect modal is restricted to an explicit name list. */
export const isLabWalletAllowlistActive = (): boolean =>
  getLabWalletAllowlist() !== null

export const isWalletNameAllowlisted = (
  walletName: string,
  allowlist: string[] | null = getLabWalletAllowlist()
): boolean => {
  if (!allowlist) {
    return true
  }
  return allowlist.includes(walletName)
}


/** LocalStorage key prefix for wallet-card passkey credential ids (WebAuthn). */
export const STABLE_AUTH_PASSKEY_PREFIX = 'dao-dao:stable-auth:passkey:'

/** Registry of local passkey accounts (existing vs create chooser). */
export const LOCAL_PASSKEY_ACCOUNTS_KEY =
  'dao-dao:stable-auth:local-passkeys:v1'

export type LocalPasskeyAccount = {
  id: string
  /** WebAuthn credential id (or lab dev fallback id). */
  credentialId: string
  label: string
  createdAt: number
  /** Optional paired cosmos address after wallet connect. */
  pairedAddress?: string
  lastUsedAt?: number
}

export const passkeyStorageKey = (addressOrPubkey: string): string =>
  `${STABLE_AUTH_PASSKEY_PREFIX}${addressOrPubkey}`

export const loadPasskeyCredentialId = (
  addressOrPubkey: string
): string | null => {
  if (typeof localStorage === 'undefined') {
    return null
  }
  return localStorage.getItem(passkeyStorageKey(addressOrPubkey))
}

export const savePasskeyCredentialId = (
  addressOrPubkey: string,
  credentialId: string
): void => {
  if (typeof localStorage === 'undefined') {
    return
  }
  localStorage.setItem(passkeyStorageKey(addressOrPubkey), credentialId)
}

export const isWebAuthnAvailable = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }
  return !!(window.PublicKeyCredential && navigator.credentials?.create)
}

export const makeLocalAccountId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `local-pk-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

const readAccountsRaw = (): LocalPasskeyAccount[] => {
  if (typeof localStorage === 'undefined') {
    return []
  }
  try {
    const raw = localStorage.getItem(LOCAL_PASSKEY_ACCOUNTS_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(
      (a): a is LocalPasskeyAccount =>
        !!a &&
        typeof a === 'object' &&
        typeof (a as LocalPasskeyAccount).id === 'string' &&
        typeof (a as LocalPasskeyAccount).credentialId === 'string'
    )
  } catch {
    return []
  }
}

const writeAccounts = (accounts: LocalPasskeyAccount[]): void => {
  if (typeof localStorage === 'undefined') {
    return
  }
  localStorage.setItem(LOCAL_PASSKEY_ACCOUNTS_KEY, JSON.stringify(accounts))
}

export const listLocalPasskeyAccounts = (): LocalPasskeyAccount[] =>
  readAccountsRaw().sort(
    (a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt)
  )

export const getActiveLocalPasskeyAccount = (): LocalPasskeyAccount | null => {
  const all = listLocalPasskeyAccounts()
  if (!all.length) {
    return null
  }
  if (typeof localStorage === 'undefined') {
    return all[0]
  }
  const activeId = localStorage.getItem(`${LOCAL_PASSKEY_ACCOUNTS_KEY}:active`)
  return all.find((a) => a.id === activeId) || all[0]
}

export const setActiveLocalPasskeyAccount = (id: string): void => {
  if (typeof localStorage === 'undefined') {
    return
  }
  localStorage.setItem(`${LOCAL_PASSKEY_ACCOUNTS_KEY}:active`, id)
  const all = readAccountsRaw().map((a) =>
    a.id === id ? { ...a, lastUsedAt: Date.now() } : a
  )
  writeAccounts(all)
}

export const upsertLocalPasskeyAccount = (
  account: LocalPasskeyAccount
): LocalPasskeyAccount => {
  const all = readAccountsRaw()
  const idx = all.findIndex((a) => a.id === account.id)
  const next = { ...account, lastUsedAt: Date.now() }
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...next }
  } else {
    all.push(next)
  }
  writeAccounts(all)
  setActiveLocalPasskeyAccount(next.id)
  return next
}

/** Pair active/local passkey account to a connected cosmos address. */
export const pairLocalPasskeyToAddress = (
  address: string,
  credentialId?: string
): LocalPasskeyAccount | null => {
  if (!address) {
    return null
  }
  const active = getActiveLocalPasskeyAccount()
  const cred =
    credentialId ||
    active?.credentialId ||
    loadPasskeyCredentialId(address) ||
    ''
  if (!cred) {
    return null
  }
  savePasskeyCredentialId(address, cred)
  if (active) {
    return upsertLocalPasskeyAccount({
      ...active,
      pairedAddress: address,
      credentialId: cred,
    })
  }
  return upsertLocalPasskeyAccount({
    id: makeLocalAccountId(),
    credentialId: cred,
    label: `Account ${address.slice(0, 10)}…`,
    createdAt: Date.now(),
    pairedAddress: address,
  })
}
