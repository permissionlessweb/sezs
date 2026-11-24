import { AUTH_KEY, type AuthSession, type Role, type SignInWallet } from './types.ts'
import { CHAIN } from './chainConfig.ts'
import { queryCache } from '../query/core.ts'
import { STALE, sezsKeys } from '../query/keys.ts'

const DEVICE_KEY = 'sezs-auth-v1-device'

const split = (raw?: string) =>
  (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/** Server-side only. The bundle must not ship an admin allowlist. */
export const adminCreds = (): string[] => {
  void split
  return []
}
export const usherCreds = (): string[] => []

/** Client cannot assign admin. Role comes from GET /sezs/session/me. */
export function roleFor(_credId: string): Role {
  return 'guest'
}

export function migrateSession(s: AuthSession): AuthSession {
  const credId = s.credId
  let authenticators = Array.isArray(s.authenticators)
    ? s.authenticators.filter((a) => a?.credId)
    : []
  if (!authenticators.length && credId) {
    authenticators = [
      { credId, label: 'device-1', addedAt: s.createdAt || Date.now() },
    ]
  }
  const policy = s.policy === 'allOf' ? 'allOf' : 'anyOf'
  return {
    ...s,
    credId: authenticators[0]?.credId || credId,
    authenticators,
    policy,
    role: 'guest',
  }
}

function deviceStore(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage
  } catch {
    return null
  }
}

function takeLegacy(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    localStorage.removeItem(AUTH_KEY)
    return raw
  } catch {
    return null
  }
}

/** Browser storage must not carry a paid flag. Paid is a server watcher fact. */
export function dropBrowserPaid<T extends { paid?: unknown }>(s: T): Omit<T, 'paid'> {
  const { paid: _forged, ...rest } = s
  return rest
}

export function loadSession(): AuthSession | null {
  if (typeof window === 'undefined') return null
  try {
    const store = deviceStore()
    let raw = store?.getItem(DEVICE_KEY) || store?.getItem(AUTH_KEY)
    if (!raw) raw = takeLegacy()
    if (!raw) return null
    const s = JSON.parse(raw) as AuthSession
    if (
      !s?.credId &&
      !s?.authenticators?.length &&
      !s?.wallet?.address &&
      !s?.wallet?.zidPubkey &&
      !s?.wallet?.passkeyCredId &&
      !s?.wallet?.email
    ) {
      return null
    }
    return dropBrowserPaid(migrateSession(s)) as AuthSession
  } catch {
    return null
  }
}

export function saveSession(s: AuthSession): void {
  const next = dropBrowserPaid({ ...s, role: 'guest' as Role })
  const store = deviceStore()
  if (!store) return
  store.setItem(DEVICE_KEY, JSON.stringify(next))
  try {
    localStorage.removeItem(AUTH_KEY)
  } catch {
    /* ignore */
  }
}

export function clearSession(): void {
  const store = deviceStore()
  store?.removeItem(DEVICE_KEY)
  store?.removeItem(AUTH_KEY)
  try {
    localStorage.removeItem(AUTH_KEY)
  } catch {
    /* ignore */
  }
}

export const hasInboxBackend = (): boolean => {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SEZS_FROST_INBOX) return true
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SEZS_SPLASH === '1' && process.env.NODE_ENV !== 'production') {
    return true
  }
  if (typeof window === 'undefined') return false
  if (window.location.port === '3050') return true
  const h = window.location.hostname
  const chainId = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SEZS_CHAIN_ID) || ''
  if ((h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]') && (!chainId || chainId.startsWith('sezs-local'))) {
    return true
  }
  return false
}

const inboxBase = () => {
  // DEV ONLY splash board: same-origin /sezs/* is rewritten to the loopback mock.
  if (process.env.NEXT_PUBLIC_SEZS_SPLASH === '1' && process.env.NODE_ENV !== 'production') return ''
  if (typeof window === 'undefined') return (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SEZS_FROST_INBOX) || ''
  if (window.location.port === '3050') return ''
  return (
    (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SEZS_FROST_INBOX) ||
    (hasInboxBackend() ? 'http://127.0.0.1:19091' : '')
  )
}

export const sessionUrl = (path: string) => {
  const b = inboxBase().replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

type Me = { ok: boolean; role?: Role; login_id?: string; error?: string; live?: boolean; source?: string }

/**
 * Cookie role for this browser. Concurrent callers (AuthContext on mount plus
 * the check-in or admin page) share one request; nothing is cached once it
 * settles, so a sign-in or sign-out is seen on the next call.
 */
export async function fetchSessionRole(contract?: string): Promise<Me> {
  if (!hasInboxBackend()) return { ok: false, error: 'inbox_offline' }
  return queryCache.fetch({
    key: sezsKeys.session.me(contract || ''),
    staleTime: STALE.session,
    gcTime: 0,
    fn: () => readSessionRole(contract),
  })
}

async function readSessionRole(contract?: string): Promise<Me> {
  try {
    const q = contract ? `?contract=${encodeURIComponent(contract)}` : ''
    const res = await fetch(sessionUrl(`/sezs/session/me${q}`), {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'x-sezs-frost': '1' },
    })
    const data = (await res.json()) as Me
    if (!data?.ok) return { ok: false, error: data?.error || 'no_session' }
    return data
  } catch {
    return { ok: false, error: 'inbox_unreachable' }
  }
}

export async function logoutRemote(): Promise<void> {
  if (!hasInboxBackend()) return
  try {
    await fetch(sessionUrl('/sezs/session/logout'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-sezs-frost': '1' },
    })
  } catch {
    /* inbox down — local device facts still clear */
  }
  try {
    await fetch(sessionUrl('/sezs/auth/email/logout'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-sezs-csrf': '1' },
    })
  } catch {
    /* email backend down — local device facts still clear */
  }
}

type CosmosSign = {
  signArbitrary: (
    chainId: string,
    signer: string,
    data: string | Uint8Array
  ) => Promise<{ pub_key?: { value?: string }; signature?: string }>
}

/**
 * Ask the session backend for a challenge for a leftover terp-address Zafu session,
 * set the HttpOnly cookie. ZID, passkey, browser-key, and email sessions verify
 * through their dedicated endpoints at sign-in time.
 */
export async function sealHttpSession(wallet?: SignInWallet | null): Promise<Me> {
  if (
    wallet?.kind === 'zid' ||
    wallet?.kind === 'passkey' ||
    wallet?.kind === 'browser' ||
    wallet?.kind === 'email'
  ) {
    return {
      ok: true,
      login_id: wallet.zidPubkey || wallet.passkeyCredId || wallet.email || wallet.address || '',
      role: 'guest',
    }
  }
  if (!wallet?.address || wallet.kind !== 'zafu') {
    return { ok: false, error: 'no_wallet_sig' }
  }
  if (typeof window === 'undefined') return { ok: false, error: 'no_window' }
  if (!hasInboxBackend()) return { ok: true, login_id: wallet.address, role: 'guest' }
  const origin = window.location.origin
  let ch: {
    ok?: boolean
    nonce?: string
    ts?: number
    message?: string
    error?: string
  }
  try {
    const res = await fetch(sessionUrl('/sezs/session/challenge'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-sezs-frost': '1' },
      body: JSON.stringify({ origin, artist_id: wallet.address }),
    })
    ch = (await res.json()) as typeof ch
  } catch {
    return { ok: false, error: 'inbox_unreachable' }
  }
  if (!ch?.ok || !ch.nonce || !ch.message || !ch.ts) {
    return { ok: false, error: ch?.error || 'challenge' }
  }
  const api = (window as unknown as Record<string, CosmosSign | undefined>)[
    'zafu'
  ]
  if (!api || typeof api.signArbitrary !== 'function') {
    return { ok: false, error: 'no_signer' }
  }
  let signed: { pub_key?: { value?: string }; signature?: string }
  try {
    signed = await api.signArbitrary(CHAIN.chainId, wallet.address, ch.message)
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'sign_rejected',
    }
  }
  if (!signed?.signature || !signed.pub_key?.value) {
    return { ok: false, error: 'no_sig' }
  }
  try {
    const res = await fetch(sessionUrl('/sezs/session/verify'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-sezs-frost': '1' },
      body: JSON.stringify({
        origin,
        artist_id: wallet.address,
        nonce: ch.nonce,
        ts: ch.ts,
        method: 'adr036',
        login_id: wallet.address,
        pub_key: signed.pub_key.value,
        signature: signed.signature,
      }),
    })
    const data = (await res.json()) as Me
    if (!data?.ok) return { ok: false, error: data?.error || 'verify' }
    return data
  } catch {
    return { ok: false, error: 'inbox_unreachable' }
  }
}

export async function applyCookieRole(
  s: AuthSession | null
): Promise<AuthSession | null> {
  if (!s) return null
  const me = await fetchSessionRole()
  if (!me.ok || !me.role) return { ...s, role: 'guest' }
  return { ...s, role: me.role }
}
