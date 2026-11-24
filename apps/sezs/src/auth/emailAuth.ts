/**
 * Front-end client for email sign-in, following Ficus AuthProvider invariants:
 * sessionVersion bumps at login/logout boundaries, refresh fails closed
 * without signing out an active tab, credentials included, CSRF header sent,
 * and automatic solving for 428 PoW challenges when enabled under load.
 */
import { idleAdapter, reduceAdapter, type AdapterState } from './adapters/machine.ts'

export const EMAIL_CSRF_HEADER = 'x-sezs-csrf'
export const EMAIL_AUTH_PREFIX = '/sezs/auth/email'

export type EmailAuthPhase = 'idle' | 'connecting' | 'connected' | 'error'
export type EmailSession = {
  email: string
  verified: boolean
  loginId?: string
  bound?: { passkeyCredId?: string; zidPubkey?: string }
}

export type EmailAuthState = {
  sessionVersion: number
  /** null = still loading, true = offered, false = backend disabled */
  available: boolean | null
  isAuthenticated: boolean
  session: EmailSession | null
  error: string
  adapter: AdapterState
}

export const initialEmailAuth = (): EmailAuthState => ({
  sessionVersion: 0,
  available: null,
  isAuthenticated: false,
  session: null,
  error: '',
  adapter: idleAdapter(),
})

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type PowChallenge = {
  salt: string
  bits: number
  exp: number
  sig: string
}

export type BindChallenge = {
  nonce: string
  ts: number
  message: string
  challengeHex: string
  challengeB64: string
}

export type PasskeyAssertionPayload = {
  clientDataJSON: string
  authenticatorData: string
  signature: string
}

export type EmailAuthClient = {
  getState: () => EmailAuthState
  subscribe: (fn: (s: EmailAuthState) => void) => () => void
  refreshSession: () => Promise<void>
  requestLink: (email: string) => Promise<{ ok: boolean; status: string }>
  verifyCode: (email: string, code: string) => Promise<void>
  bindPasskey: (args: {
    credId: string
    publicKey: string
    assertChallenge: (challenge: BindChallenge) => Promise<PasskeyAssertionPayload>
  }) => Promise<void>
  bindZid: (args: {
    zidPubkey: string
    signChallenge: (challenge: BindChallenge) => Promise<string>
  }) => Promise<void>
  logout: () => Promise<void>
}

const jsonOf = async (res: Response) => {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

const headers = (): Record<string, string> => ({
  'content-type': 'application/json',
  [EMAIL_CSRF_HEADER]: '1',
})

const normalizeEmail = (email: string) => email.trim().toLowerCase()

const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

const hasLeadingZeroBits = (buf: Uint8Array, bits: number): boolean => {
  const fullBytes = bits >> 3
  const remBits = bits & 7
  for (let i = 0; i < fullBytes; i++) {
    if (buf[i] !== 0) return false
  }
  if (remBits > 0) {
    const mask = 0xff << (8 - remBits)
    if ((buf[fullBytes] & mask) !== 0) return false
  }
  return true
}

/** Portable WebCrypto SHA-256 PoW solver for stateless 428 challenges. */
export const solvePowChallenge = async (pow: PowChallenge): Promise<PowChallenge & { nonce: string }> => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('This browser cannot complete the request check.')
  const enc = new TextEncoder()
  for (let i = 0; i < 2_000_000; i++) {
    const nonce = i.toString(36)
    const digest = new Uint8Array(await subtle.digest('SHA-256', enc.encode(`${pow.salt}:${nonce}`)))
    if (hasLeadingZeroBits(digest, pow.bits)) return { ...pow, nonce }
  }
  throw new Error('Could not finish request check.')
}

const humanError = (code: string, fallback: string) => {
  switch (code) {
    case 'bad_email':
      return 'Enter a valid email address.'
    case 'bad_code':
      return 'That code was not accepted.'
    case 'expired':
      return 'That code expired. Request a new one.'
    case 'unknown_challenge':
      return 'No active code for that email. Request a new one.'
    case 'rate_limited':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'delivery_unavailable':
      return 'Email delivery is unavailable right now.'
    case 'origin_refused':
    case 'csrf_required':
      return 'Request refused for this origin.'
    case 'no_session':
      return 'Sign in with email first.'
    case 'bad_signature':
    case 'proof_required':
      return 'Could not verify the bound key proof.'
    default:
      return fallback
  }
}

export const createEmailAuthClient = (opts: { fetch?: FetchLike; base?: string } = {}): EmailAuthClient => {
  const fetchImpl = opts.fetch || ((input, init) => fetch(input, init))
  const defaultBase =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SEZS_EMAIL_AUTH_URL
      ? process.env.NEXT_PUBLIC_SEZS_EMAIL_AUTH_URL
      : ''
  const base = (opts.base ?? defaultBase).replace(/\/$/, '')
  let state = initialEmailAuth()
  const subs = new Set<(s: EmailAuthState) => void>()
  const emit = (next: EmailAuthState) => {
    state = next
    for (const fn of subs) fn(state)
  }

  const url = (path: string) => `${base}${EMAIL_AUTH_PREFIX}${path}`

  const call = async (path: string, init: RequestInit = {}) => {
    try {
      const res = await fetchImpl(url(path), {
        credentials: 'include',
        cache: 'no-store',
        ...init,
        headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
      })
      const body = await jsonOf(res)
      return { res, body }
    } catch {
      return { res: null, body: { error: 'unreachable' } as Record<string, unknown> }
    }
  }

  const bump = (partial: Partial<EmailAuthState>, bumpVersion = false) => {
    emit({
      ...state,
      ...partial,
      sessionVersion: state.sessionVersion + (bumpVersion ? 1 : 0),
    })
  }

  const unavailable = (error = 'Email sign-in isn’t available yet.') => {
    bump({
      available: false,
      isAuthenticated: false,
      error,
      adapter: reduceAdapter(
        state.adapter.phase === 'connecting' ? state.adapter : reduceAdapter(idleAdapter(), { type: 'start' }),
        { type: 'fail', error },
      ),
    })
  }

  const requestBindChallenge = async (): Promise<BindChallenge> => {
    const { res, body } = await call('/bind-challenge', { method: 'POST', body: '{}' })
    if (!res || res.status === 404 || res.status === 501) {
      unavailable()
      throw new Error('Email sign-in isn’t available yet.')
    }
    if (!res.ok || body.ok === false) {
      throw new Error(humanError(String(body.error || ''), 'Could not start binding.'))
    }
    return {
      nonce: String(body.nonce || ''),
      ts: Number(body.ts || 0),
      message: String(body.message || ''),
      challengeHex: String(body.challengeHex || ''),
      challengeB64: String(body.challengeB64 || ''),
    }
  }

  const client: EmailAuthClient = {
    getState: () => state,
    subscribe: (fn) => {
      subs.add(fn)
      fn(state)
      return () => subs.delete(fn)
    },
    refreshSession: async () => {
      const { res, body } = await call('/session', { method: 'GET' })
      if (!res) {
        bump({ error: state.isAuthenticated ? state.error : state.error })
        return
      }
      if (res.status === 404 || res.status === 501) {
        bump({ available: false, error: '' })
        return
      }
      if (!res.ok || body?.ok === false) {
        if (state.isAuthenticated) return
        bump({ available: true, isAuthenticated: false, session: null })
        return
      }
      const email = String(body.email || '')
      bump({
        available: true,
        isAuthenticated: true,
        session: {
          email,
          verified: true,
          loginId: String(body.login_id || email),
          bound: (body.bound as EmailSession['bound']) || undefined,
        },
        error: '',
      })
    },
    requestLink: async (raw) => {
      const email = normalizeEmail(raw)
      if (!looksLikeEmail(email)) throw new Error('Enter an email address.')
      bump({
        error: '',
        adapter: reduceAdapter(idleAdapter(), { type: 'start' }),
      })
      let { res, body } = await call('/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      if (res?.status === 428 && body?.pow && typeof body.pow === 'object') {
        const solved = await solvePowChallenge(body.pow as PowChallenge)
        ;({ res, body } = await call('/request', {
          method: 'POST',
          body: JSON.stringify({ email, pow: solved }),
        }))
      }
      if (!res || res.status === 404 || res.status === 501) {
        unavailable()
        throw new Error('Email sign-in isn’t available yet.')
      }
      if (!res.ok) {
        const error = humanError(String(body.error || ''), 'The sign-in email could not be requested.')
        bump({
          error,
          adapter: reduceAdapter(state.adapter, { type: 'fail', error }),
        })
        throw new Error(error)
      }
      bump({
        available: true,
        adapter: { ...state.adapter, waiting: true },
      })
      return { ok: true, status: String(body.status || 'awaiting') }
    },
    verifyCode: async (raw, code) => {
      const email = normalizeEmail(raw)
      const token = code.trim()
      if (!looksLikeEmail(email) || !token) throw new Error('Enter the code from your email.')
      const started = state.adapter.phase === 'connecting' ? state.adapter : reduceAdapter(idleAdapter(), { type: 'start' })
      bump({ error: '', adapter: started })
      const { res, body } = await call('/verify', {
        method: 'POST',
        body: JSON.stringify({ email, code: token }),
      })
      if (!res || res.status === 404 || res.status === 501) {
        unavailable()
        throw new Error('Email sign-in isn’t available yet.')
      }
      if (!res.ok || body.ok === false) {
        const error = humanError(String(body.error || ''), 'That code was not accepted.')
        bump({ error, adapter: reduceAdapter(started, { type: 'fail', error }) })
        throw new Error(error)
      }
      bump(
        {
          available: true,
          isAuthenticated: true,
          session: {
            email,
            verified: true,
            loginId: String(body.login_id || email),
            bound: (body.bound as EmailSession['bound']) || undefined,
          },
          error: '',
          adapter: reduceAdapter(started, { type: 'success', identity: { kind: 'email', id: email } }),
        },
        true,
      )
    },
    bindPasskey: async ({ credId, publicKey, assertChallenge }) => {
      if (!state.session) throw new Error('Verify email first.')
      const ch = await requestBindChallenge()
      const assertion = await assertChallenge(ch)
      const { res, body } = await call('/bind', {
        method: 'POST',
        body: JSON.stringify({ kind: 'p256/passkey', nonce: ch.nonce, credId, publicKey, assertion }),
      })
      if (!res || !res.ok) {
        throw new Error(humanError(String(body.error || ''), 'Could not bind passkey.'))
      }
      bump({
        session: {
          ...state.session,
          bound: (body.bound as EmailSession['bound']) || { ...state.session.bound, passkeyCredId: credId },
        },
      })
    },
    bindZid: async ({ zidPubkey, signChallenge }) => {
      if (!state.session) throw new Error('Verify email first.')
      const ch = await requestBindChallenge()
      const signature = await signChallenge(ch)
      const { res, body } = await call('/bind', {
        method: 'POST',
        body: JSON.stringify({ kind: 'ed25519/zid', nonce: ch.nonce, zidPubkey, signature }),
      })
      if (!res || !res.ok) {
        throw new Error(humanError(String(body.error || ''), 'Could not bind Zafu ZID.'))
      }
      bump({
        session: {
          ...state.session,
          bound: (body.bound as EmailSession['bound']) || { ...state.session.bound, zidPubkey },
        },
      })
    },
    logout: async () => {
      await call('/logout', { method: 'POST' })
      bump(
        {
          isAuthenticated: false,
          session: null,
          error: '',
          adapter: idleAdapter(),
        },
        true,
      )
    },
  }
  return client
}

let sharedClient: EmailAuthClient | null = null
export const emailClient = (): EmailAuthClient => {
  if (!sharedClient) sharedClient = createEmailAuthClient()
  return sharedClient
}
