import { useEffect, useState } from 'react'

import { withBasePath } from '../ui/basePath'
import { useAuth } from './AuthContext'
import { SignInPanel } from './SignInPanel'
import { AdapterId, WalletAdapter, listWalletAdapters } from './adapters/registry'
import { signInComplete, walletDisplayId, walletLabel } from './types'
import { docsHref } from '../docs/links'

const WalletFacts = ({ adapter }: { adapter: WalletAdapter }) => (
  <div className="wallet-info-pane" data-wallet-info={adapter.id}>
    <dl className="wallet-facts">
      {adapter.facts.map((row) => (
        <div key={row.label} className="wallet-fact">
          <dt>{row.label}</dt>
          <dd>
            <span className="admin-badge">{row.value}</span>
          </dd>
        </div>
      ))}
    </dl>
    <p className="wallet-docs">
      {adapter.official ? (
        <a className="pix-link" href={adapter.official} target="_blank" rel="noopener noreferrer">
          Official
        </a>
      ) : null}
      {adapter.official && adapter.docs ? ' · ' : null}
      <a className="pix-link" href={docsHref(adapter.docs)} target="_blank" rel="noopener noreferrer">
        Docs
      </a>
    </p>
  </div>
)

/** Two-column sign-in: adapter list on the left, selected panel on the right. Mobile is list, then panel. */
export const SignInShell = ({ variant = 'modal' }: { variant?: 'modal' | 'page' }) => {
  const { session, signOut, error, closeSignIn } = useAuth()
  const done = signInComplete(session)
  const adapters = listWalletAdapters()
  const [sel, setSel] = useState<AdapterId>(adapters[0]?.id || 'zafu')
  const [step, setStep] = useState<'list' | 'panel'>('list')
  const [info, setInfo] = useState(false)
  const current =
    (done && session?.wallet
      ? adapters.find((a) => a.walletKind === session.wallet?.kind)
      : null) ||
    adapters.find((a) => a.id === sel) ||
    adapters[0]

  const docs = !info && current ? (
    <p className="wallet-docs">
      <a className="pix-link" href={docsHref(current.docs)} target="_blank" rel="noopener noreferrer">
        Docs
      </a>
    </p>
  ) : null

  const paneHead = current ? (
    <header className="wallet-pane-head">
      <img className="wallet-logo" src={withBasePath(current.logo)} alt="" width={36} height={36} />
      <div>
        <h3 className="wallet-pane-title">{current.title}</h3>
        {current.blurb && !info ? <small>{current.blurb}</small> : null}
      </div>
      {current.facts.length && !done ? (
        <button
          type="button"
          className={'wallet-info-btn' + (info ? ' is-on' : '')}
          aria-pressed={info}
          aria-label={info ? 'Close info' : `${current.title} info`}
          onClick={() => setInfo((on) => !on)}
        >
          i
        </button>
      ) : null}
    </header>
  ) : null

  return (
    <div className="wallet-split" data-step={done ? 'panel' : step} data-signed-in={done ? 'true' : 'false'} data-info={info ? 'true' : 'false'}>
      <ul className="wallet-list" role="listbox" aria-label="Sign-in options">
        {adapters.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              className={'wallet-opt' + (current?.id === a.id ? ' is-on' : '')}
              aria-selected={current?.id === a.id}
              onClick={() => {
                setSel(a.id)
                setStep('panel')
                setInfo(false)
              }}
            >
              <img className="wallet-logo" src={withBasePath(a.logo)} alt="" width={28} height={28} />
              <span>
                <strong>{a.title}</strong>
                {a.blurb ? <small>{a.blurb}</small> : null}
              </span>
            </button>
            {a.facts.length ? (
              <button
                type="button"
                className={'wallet-info-btn' + (info && current?.id === a.id ? ' is-on' : '')}
                aria-label={`${a.title} info`}
                onClick={() => {
                  setSel(a.id)
                  setStep('panel')
                  setInfo(true)
                }}
              >
                i
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="wallet-pane">
        <button type="button" className="wallet-back pix-link" onClick={() => { setStep('list'); setInfo(false) }}>
          Options
        </button>
        {paneHead}
        {done && session ? (
          <div className="wallet-pane-body" data-signed-in="true">
            <div className="admin-badges">
              <span className="admin-badge ok">{session.alias}</span>
              <span className="admin-badge">{session.role}</span>
              <span className={session.paid ? 'admin-badge ok' : 'admin-badge'}>
                {session.paid ? session.paid.rail : 'not paid'}
              </span>
            </div>
            <p className="mono fine">
              {session.wallet ? `${walletLabel(session.wallet.kind)} · ${walletDisplayId(session.wallet)}` : 'No wallet'}
            </p>
            <button
              type="button"
              className="pix-btn ghost"
              onClick={() => {
                signOut()
                if (variant === 'modal') closeSignIn()
              }}
            >
              Disconnect
            </button>
          </div>
        ) : info && current ? (
          <div className="wallet-pane-body">
            <WalletFacts adapter={current} />
          </div>
        ) : (
          <div className="wallet-pane-body">
            <SignInPanel adapterId={sel} />
            {error ? <p className="msg bad">{error}</p> : null}
          </div>
        )}
        {docs}
      </div>
    </div>
  )
}

/** Single sign-in dialog, opened from the rail, tickets checkout, or the artist desk. */
export const SignInModal = () => {
  const { signInOpen, closeSignIn } = useAuth()

  useEffect(() => {
    if (!signInOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSignIn()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [signInOpen, closeSignIn])

  if (!signInOpen) return null

  return (
    <div className="wallet-scrim" role="presentation" onClick={() => closeSignIn()}>
      <div
        className="wallet-modal wallet-split-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wallet-modal-bar">
          <h2 id="wallet-modal-title">Sign in</h2>
          <button type="button" className="pix-link" onClick={() => closeSignIn()}>
            close
          </button>
        </div>
        <SignInShell variant="modal" />
      </div>
    </div>
  )
}
