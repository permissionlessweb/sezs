import { FormEvent, useEffect, useMemo, useState } from 'react'

import { useAuth } from './AuthContext'
import {
  forgetSealed,
  prepareBrowserAccount,
  Prepared,
  registerBrowserAccount,
  registerDeskOpen,
  rootInMemory,
} from './browserAccount'
import { shortAddr } from './chainConfig'
import { EmailSignIn } from './EmailSignIn'
import {
  assertPasskeyChallenge,
  assertWithPrf,
  createPasskeyForSignIn,
  createPasskeyWithKey,
} from './passkeyKey'
import { defaultPasskeyName, passkeyDisplayName } from './passkeyName'
import { issuePasskeyChallenge, verifyPasskeySession } from './passkeySession'
import { hasInboxBackend } from './session'
import { issueZidChallenge, verifyZidSession } from './zidSession'
import { signInComplete, SignInWallet, walletLabel } from './types'
import { DOCS, docsHref } from '../docs/links'
import { AdapterId } from './adapters/registry'
import { loginWithZid } from './zidLogin'

type Step = 'grant' | 'sign' | 'broadcast' | 'confirm'
const STEP_TEXT: Record<Step, string> = {
  grant: 'Asking the desk to cover the fee…',
  sign: 'Signing the registration on this device…',
  broadcast: 'Sending it to Terp…',
  confirm: 'Waiting for Terp to show it on your account…',
}

/**
 * Sign-in is Zafu ZID, passkey session, or a passkey + PRF-sealed browser key.
 */
export const SignInPanel = ({ adapterId }: { adapterId?: AdapterId } = {}) => {
  const { session, bindWallet } = useAuth()
  const wallet = session?.wallet
  const [alias, setAlias] = useState('')
  const [suggestedName, setSuggestedName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [step, setStep] = useState<Step | null>(null)
  const [prep, setPrep] = useState<Prepared | null>(null)
  const [status, setStatus] = useState('')

  const deskOpen = registerDeskOpen()
  const pending = wallet?.kind === 'browser' && !wallet.registered
  const setupLive = pending && rootInMemory(wallet?.address)
  const interrupted = pending && !setupLive
  const origin = useMemo(
    () => (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3051'),
    [],
  )
  useEffect(() => {
    setSuggestedName(defaultPasskeyName())
  }, [])
  const passkeyName = () => passkeyDisplayName(alias || session?.alias)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMsg('')
    setStatus('')
    try {
      await fn()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Something went wrong. Nothing was sent.')
    } finally {
      setBusy(false)
      setStep(null)
      setStatus('')
    }
  }

  const connectZid = () =>
    run(async () => {
      const w = await loginWithZid({
        origin,
        issueChallenge: issueZidChallenge,
        verifySignature: verifyZidSession,
        onState: (s) => {
          if (s.waiting) setStatus('Approve in Zafu…')
        },
      })
      bindWallet(w, { alias })
    })

  const signInExistingPasskey = () =>
    run(async () => {
      const ch = await issuePasskeyChallenge(origin)
      const signed = await assertPasskeyChallenge(null, ch.challengeB64)
      if (hasInboxBackend()) {
        const vr = await verifyPasskeySession({
          origin,
          nonce: ch.nonce,
          ts: ch.ts,
          credId: signed.credId,
          assertion: signed.assertion,
        })
        if (!vr.ok) throw new Error(vr.error || 'Passkey verification failed.')
      }
      bindWallet(
        {
          kind: 'passkey',
          address: '',
          passkeyCredId: signed.credId,
          passkeyVerified: true,
          connectedAt: Date.now(),
        },
        { alias, passkeyCredId: signed.credId },
      )
    })

  const createPasskeySignIn = () =>
    run(async () => {
      const ch = await issuePasskeyChallenge(origin)
      const pk = await createPasskeyForSignIn(passkeyName())
      const signed = await assertPasskeyChallenge(pk.credId, ch.challengeB64)
      if (hasInboxBackend()) {
        const vr = await verifyPasskeySession({
          origin,
          nonce: ch.nonce,
          ts: ch.ts,
          credId: pk.credId,
          publicKey: pk.params.public_key,
          assertion: signed.assertion,
        })
        if (!vr.ok) throw new Error(vr.error || 'Passkey verification failed.')
      }
      bindWallet(
        {
          kind: 'passkey',
          address: '',
          passkeyCredId: pk.credId,
          passkey: pk.params,
          passkeyVerified: true,
          connectedAt: Date.now(),
        },
        { alias, passkeyCredId: pk.credId },
      )
    })

  const bindPrepared = (p: Prepared) => {
    const w: SignInWallet = {
      kind: 'browser',
      address: p.address,
      browserPubkey: p.browserPubkey,
      passkeyCredId: p.passkeyCredId,
      passkey: p.passkey,
      connectedAt: Date.now(),
    }
    bindWallet(w, { alias, passkeyCredId: p.passkeyCredId })
    setPrep(p)
  }

  const startBrowser = () =>
    run(async () => {
      const ch = hasInboxBackend() ? await issuePasskeyChallenge(origin) : null
      const pk = await createPasskeyWithKey(
        passkeyName(),
        ch ? { challengeB64: ch.challengeB64 } : undefined,
      )
      if (ch && pk.assertion) {
        const vr = await verifyPasskeySession({
          origin,
          nonce: ch.nonce,
          ts: ch.ts,
          credId: pk.credId,
          publicKey: pk.params.public_key,
          assertion: pk.assertion,
        })
        if (!vr.ok) throw new Error(vr.error || 'Passkey verification failed.')
      }
      const p = await prepareBrowserAccount({ passkey: pk.params, passkeyCredId: pk.credId, prfKey: pk.prfKey })
      bindPrepared(p)
    })

  const restartBrowser = () =>
    run(async () => {
      if (!wallet?.passkeyCredId || !wallet.passkey) {
        await startBrowser()
        return
      }
      let prf: Uint8Array | null = null
      if (hasInboxBackend()) {
        const ch = await issuePasskeyChallenge(origin, wallet.passkeyCredId)
        const signed = await assertPasskeyChallenge(wallet.passkeyCredId, ch.challengeB64, { withPrf: true })
        prf = signed.prf
        const vr = await verifyPasskeySession({
          origin,
          nonce: ch.nonce,
          ts: ch.ts,
          credId: wallet.passkeyCredId,
          assertion: signed.assertion,
        })
        if (!vr.ok) throw new Error(vr.error || 'Passkey verification failed.')
      } else {
        prf = await assertWithPrf(wallet.passkeyCredId)
      }
      if (!prf) throw new Error('This passkey could not unlock the sealed browser key.')
      forgetSealed(wallet.address)
      const p = await prepareBrowserAccount({ passkey: wallet.passkey, passkeyCredId: wallet.passkeyCredId, prfKey: prf })
      bindPrepared(p)
    })

  const register = () =>
    run(async () => {
      const p: Prepared | null =
        prep && prep.address === wallet?.address
          ? prep
          : wallet?.browserPubkey && wallet.passkey && wallet.passkeyCredId
            ? {
                address: wallet.address,
                browserPubkey: wallet.browserPubkey,
                passkey: wallet.passkey,
                passkeyCredId: wallet.passkeyCredId,
                sealed: true,
              }
            : null
      if (!p || !wallet) throw new Error('Setup was interrupted. Start again.')
      const { registered } = await registerBrowserAccount(p, setStep)
      bindWallet({ ...wallet, registered, originDestroyedAt: Date.now() })
    })

  const compact = Boolean(adapterId)
  const onEmailVerified = (email: string) => {
    bindWallet({ kind: 'email', address: '', email, emailVerified: true, connectedAt: Date.now() }, { alias })
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (adapterId === 'email') return
    if (adapterId === 'zafu-passkey') {
      void signInExistingPasskey()
      return
    }
    if (adapterId === 'ephemeral') {
      void startBrowser()
      return
    }
    void connectZid()
  }

  if (signInComplete(session)) return null

  if (pending && wallet) {
    return (
      <div className="panel ticket-panel">
        <h3 className="panel-heading">Finish signing in</h3>
        <p className="muted">
          Account <span className="mono">{shortAddr(wallet.address)}</span> on this browser.
        </p>
        <ol className="step-list">
          <li className="done">
            <span className="step-n">1</span>
            <span>Passkey saved on this device.</span>
          </li>
          <li className="done">
            <span className="step-n">2</span>
            <span>Browser key made and locked to your passkey.</span>
          </li>
          <li className={setupLive ? 'on' : ''}>
            <span className="step-n">3</span>
            <span>Register both on Terp. One signature from a setup key; the desk covers the fee.</span>
          </li>
          <li>
            <span className="step-n">4</span>
            <span>Setup key erased from this tab.</span>
          </li>
        </ol>
        {interrupted ? (
          <p className="honest">
            Setup was interrupted before registration, so this account can’t be finished. Start
            again for a fresh one. Nothing was paid or sent.
          </p>
        ) : !deskOpen ? (
          <p className="honest">
            Registration isn’t open yet, so this browser can’t finish signing in. Use Zafu
            for now. Leaving this page discards the unfinished account. Nothing was paid or sent.
          </p>
        ) : (
          <p className="honest">
            You’re not signed in until Terp shows your passkey and browser key on this account.
            Then the setup key is erased. This does not pay for a ticket.
          </p>
        )}
        <div className="row ticket-actions">
          {interrupted ? (
            <button className="btn" type="button" disabled={busy} onClick={restartBrowser}>
              {busy ? '…' : 'Start again'}
            </button>
          ) : (
            <button className="btn" type="button" disabled={busy || !deskOpen} onClick={register}>
              {busy ? '…' : deskOpen ? 'Register account' : 'Registration not open'}
            </button>
          )}
          <button className="btn ghost" type="button" disabled={busy} onClick={() => connectZid()}>
            Use {walletLabel('zid')}
          </button>
        </div>
        {step ? <p className="msg">{STEP_TEXT[step]}</p> : null}
        {msg ? <p className="msg bad">{msg}</p> : null}
      </div>
    )
  }

  const finishing = !!session
  const isPasskey = adapterId === 'zafu-passkey'
  const isBrowser = adapterId === 'ephemeral'
  const isEmail = adapterId === 'email'

  return (
    <div className="panel ticket-panel">
      {compact ? null : <h3 className="panel-heading">{finishing ? 'Finish signing in' : 'Sign in'}</h3>}
      {isEmail ? (
        <EmailSignIn onVerified={onEmailVerified} />
      ) : (
        <form onSubmit={onSubmit} className="ticket-auth">
          {!finishing ? (
            <>
              <label htmlFor="ticket-alias">Alias (optional)</label>
              <input
                id="ticket-alias"
                placeholder={isPasskey || isBrowser ? suggestedName || 'sez-yy-mm-dd' : 'how we greet you'}
                value={alias}
                onChange={(ev) => setAlias(ev.target.value)}
                autoComplete="username"
              />
            </>
          ) : null}
          <div className="row ticket-actions">
            <button className="btn pix-btn" type="submit" disabled={busy}>
              {busy
                ? status || (isPasskey || isBrowser ? '…' : 'Connecting…')
                : isPasskey
                  ? 'Log in with passkey'
                  : isBrowser
                    ? 'Create passkey'
                    : 'Log in with Zafu'}
            </button>
            {isPasskey ? (
              <button className="btn ghost" type="button" disabled={busy} onClick={createPasskeySignIn}>
                Create passkey
              </button>
            ) : null}
          </div>
        </form>
      )}
      {compact ? null : (
        <p className="mv-foot">
          <a className="pix-link" href={docsHref(DOCS.wallets)} target="_blank" rel="noopener noreferrer">
            Learn about wallets
          </a>
        </p>
      )}
      {msg ? <p className="msg bad">{msg}</p> : null}
    </div>
  )
}
