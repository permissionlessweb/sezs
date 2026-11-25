import type { WalletKind } from '../types.ts'
/** Plug-in id for a sign-in option. New adapters register here. */
export type BuiltinAdapterId = 'zafu' | 'zafu-passkey' | 'ephemeral' | 'email'
export type AdapterId = BuiltinAdapterId | (string & {})

export type WalletFact = { label: string; value: string }

export type WalletAdapter = {
  id: AdapterId
  title: string
  logo: string
  /** Short label under the title. Empty when facts live in the info pane. */
  blurb?: string
  docs: string
  official?: string
  facts: WalletFact[]
  walletKind: WalletKind
  available?: () => boolean
  /** Hide this option when WebAuthn PRF is known to be unavailable in this browser. */
  requiresPrf?: boolean
}

export type PrfCapability = 'yes' | 'no' | 'unknown'

export type ListWalletAdaptersOpts = {
  prf?: PrfCapability
}

const builtin = (): WalletAdapter[] => [
  {
    id: 'zafu',
    title: 'Zafu',
    logo: '/wallets/zafu.svg',
    docs: '/guides/general/wallets/',
    official: 'https://zafu.pro',
    walletKind: 'zid',
    facts: [
      { label: 'What', value: 'Log in with Zafu (ZID)' },
      { label: 'Identity', value: 'site-scoped ed25519 ZID' },
      { label: 'API', value: '@zafu/zid' },
      { label: 'Signing', value: 'Login signs a site-scoped challenge. On-chain door actions still use Zafu.' },
    ],
  },
  {
    id: 'zafu-passkey',
    title: 'Zafu passkey',
    logo: '/wallets/passkey.svg',
    docs: '/guides/general/wallets/',
    official: 'https://zafu.pro',
    walletKind: 'passkey',
    facts: [
      { label: 'What', value: 'Passkey session sign-in' },
      { label: 'Identity', value: 'P-256 WebAuthn passkey' },
      { label: 'API', value: 'navigator.credentials' },
      { label: 'Signing', value: 'Verifies a one-time challenge with user verification. No browser key stored.' },
    ],
  },
  {
    id: 'ephemeral',
    title: 'This browser',
    logo: '/wallets/passkey.svg',
    blurb: 'Passkey + browser key',
    docs: '/guides/general/wallets/',
    walletKind: 'browser',
    requiresPrf: true,
    facts: [
      { label: 'What', value: 'Page-local browser key' },
      { label: 'Identity', value: 'P-256 passkey, browser key sealed with WebAuthn PRF' },
      { label: 'API', value: 'navigator.credentials' },
      { label: 'PRF', value: 'The authenticator seals the browser key after user verification. No plaintext fallback.' },
    ],
  },
  {
    id: 'email',
    title: 'Email',
    available: () => typeof process === 'undefined' || process.env.NEXT_PUBLIC_SEZS_HIDE_EMAIL !== '1',
    logo: '/wallets/passkey.svg',
    blurb: 'Mobile-friendly',
    docs: '/guides/general/wallets/',
    walletKind: 'email',
    facts: [
      { label: 'What', value: 'Email sign-in (magic link or code)' },
      { label: 'Identity', value: 'Verified mailbox, bindable to a passkey or ZID' },
      { label: 'API', value: '/sezs/auth/email' },
      { label: 'Status', value: 'Email sign-in is not available on this build.' },
    ],
  },
]

let extra: WalletAdapter[] = []

/** Add a sign-in option. Later wallets plug in through this list. */
export const registerWalletAdapter = (adapter: WalletAdapter) => {
  extra = [...extra.filter((a) => a.id !== adapter.id), adapter]
}

export const listWalletAdapters = (opts?: ListWalletAdaptersOpts): WalletAdapter[] => {
  const seen = new Set<string>()
  const out: WalletAdapter[] = []
  for (const a of [...extra, ...builtin()]) {
    if (seen.has(a.id)) continue
    if (a.available && !a.available()) continue
    if (a.requiresPrf && opts?.prf === 'no') continue
    seen.add(a.id)
    out.push(a)
  }
  const order: string[] = ['zafu', 'zafu-passkey', 'ephemeral', 'email']
  out.sort((a, b) => {
    const ia = order.indexOf(a.id as AdapterId)
    const ib = order.indexOf(b.id as AdapterId)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  return out
}

export const adapterById = (id: string | null | undefined): WalletAdapter | undefined =>
  listWalletAdapters().find((a) => a.id === id)
