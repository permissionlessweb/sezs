import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

import {
  applyCookieRole,
  clearSession,
  loadSession,
  logoutRemote,
  migrateSession,
  saveSession,
  sealHttpSession,
} from './session'
import { emailClient } from './emailAuth'
import { AuthPolicy, AuthSession, SignInWallet } from './types'
import { readServerPaid } from '../pay/serverPaid'
import {
  assertAllOf,
  assertAnyOf,
  createPasskey,
} from './webauthn'

type AuthApi = {
  session: AuthSession | null
  ready: boolean
  error: string
  signIn: (alias?: string) => Promise<void>
  unlock: () => Promise<void>
  addDevice: (label?: string) => Promise<void>
  removeDevice: (credId: string) => Promise<void>
  setPolicy: (policy: AuthPolicy) => void
  /** Read paid from the server fact. Guest browsers do not fetch loopback. */
  refreshPaid: (binding?: string) => Promise<void>
  /** Attach ZID / browser key / email. Creates a session if there is none. */
  bindWallet: (wallet: SignInWallet, opts?: { alias?: string; passkeyCredId?: string }) => void
  signOut: () => void
  signInOpen: boolean
  openSignIn: () => void
  closeSignIn: () => void
}

const Ctx = createContext<AuthApi | null>(null)

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [signInOpen, setSignInOpen] = useState(false)
  const openSignIn = useCallback(() => setSignInOpen(true), [])
  const closeSignIn = useCallback(() => setSignInOpen(false), [])

  useEffect(() => {
    const s = loadSession()
    setSession(s)
    void applyCookieRole(s).then((next) => {
      setSession(next)
      setReady(true)
    })
  }, [])

  const persist = (s: AuthSession) => {
    const next = migrateSession({ ...s, role: 'guest' })
    saveSession(next)
    setSession(next)
    void applyCookieRole(next).then(setSession)
  }

  const signIn = useCallback(async (alias?: string) => {
    setError('')
    try {
      const name = (alias || 'guest').trim() || 'guest'
      const credId = await createPasskey(name)
      persist({
        credId,
        authenticators: [
          { credId, label: 'device-1', addedAt: Date.now() },
        ],
        policy: 'anyOf',
        role: 'guest',
        alias: name,
        createdAt: Date.now(),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
      throw e
    }
  }, [])

  const unlock = useCallback(async () => {
    setError('')
    const cur = loadSession()
    if (!cur) {
      setError('No passkey on this device.')
      throw new Error('No passkey on this device.')
    }
    try {
      const ids = cur.authenticators.map((a) => a.credId)
      if (cur.policy === 'allOf') await assertAllOf(ids)
      else await assertAnyOf(ids)
      persist(cur)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unlock failed.')
      throw e
    }
  }, [])

  const addDevice = useCallback(async (label?: string) => {
    setError('')
    const cur = loadSession()
    if (!cur) throw new Error('Sign in first.')
    try {
      const n = cur.authenticators.length + 1
      const credId = await createPasskey(cur.alias)
      persist({
        ...cur,
        authenticators: [
          ...cur.authenticators,
          {
            credId,
            label: (label || `device-${n}`).trim() || `device-${n}`,
            addedAt: Date.now(),
          },
        ],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add device failed.')
      throw e
    }
  }, [])

  const removeDevice = useCallback(async (credId: string) => {
    setError('')
    const cur = loadSession()
    if (!cur) throw new Error('Sign in first.')
    if (cur.authenticators.length < 2) {
      setError('Keep at least one passkey. Add another first to rotate.')
      throw new Error('Keep at least one passkey.')
    }
    const nextAuth = cur.authenticators.filter((a) => a.credId !== credId)
    persist({
      ...cur,
      credId: nextAuth[0].credId,
      authenticators: nextAuth,
    })
  }, [])

  const setPolicy = useCallback((policy: AuthPolicy) => {
    const cur = loadSession()
    if (!cur) return
    persist({ ...cur, policy })
  }, [])

  const refreshPaid = useCallback(async (binding?: string) => {
    const cur = loadSession()
    if (!cur) return
    const b = (binding || cur.wallet?.address || cur.credId || '').trim()
    if (!b) return
    const fact = await readServerPaid(b)
    if (fact.paid && fact.recordId && fact.rail) {
      persist({
        ...cur,
        paid: { rail: fact.rail, at: Date.now(), recordId: fact.recordId },
      })
    }
  }, [])

  const bindWallet = useCallback(
    (wallet: SignInWallet, opts?: { alias?: string; passkeyCredId?: string }) => {
      const cur = loadSession()
      const pk = opts?.passkeyCredId
      const base: AuthSession = cur
        ? {
            ...cur,
            wallet,
            authenticators:
              pk && !cur.authenticators.some((a) => a.credId === pk)
                ? [
                    ...cur.authenticators,
                    { credId: pk, label: `device-${cur.authenticators.length + 1}`, addedAt: Date.now() },
                  ]
                : cur.authenticators,
            credId: cur.credId || pk || '',
            role: 'guest',
          }
        : {
            credId: pk || '',
            authenticators: pk ? [{ credId: pk, label: 'device-1', addedAt: Date.now() }] : [],
            policy: 'anyOf',
            role: 'guest',
            alias: (opts?.alias || 'guest').trim() || 'guest',
            wallet,
            createdAt: Date.now(),
          }
      persist(base)
      void sealHttpSession(wallet).then(() => {
        void applyCookieRole(loadSession()).then(setSession)
      })
    },
    []
  )

  const signOut = useCallback(() => {
    const cur = loadSession()
    if (cur?.wallet?.kind === 'email') {
      void emailClient().logout()
    }
    void logoutRemote()
    clearSession()
    setSession(null)
    setError('')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const code = url.searchParams.get('email_code')
    const email = url.searchParams.get('email')
    if (!code || !email) return
    url.searchParams.delete('email_code')
    url.searchParams.delete('email')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    const normalized = email.trim().toLowerCase()
    void emailClient()
      .verifyCode(normalized, code)
      .then(() => {
        bindWallet({
          kind: 'email',
          address: '',
          email: normalized,
          emailVerified: true,
          connectedAt: Date.now(),
        })
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Email sign-in link was not accepted.')
        setSignInOpen(true)
      })
  }, [bindWallet])

  return (
    <Ctx.Provider
      value={{
        session,
        ready,
        error,
        signIn,
        unlock,
        addDevice,
        removeDevice,
        setPolicy,
        refreshPaid,
        bindWallet,
        signOut,
        signInOpen,
        openSignIn,
        closeSignIn,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export const useAuth = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
