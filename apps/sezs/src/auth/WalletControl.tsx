import { useAuth } from './AuthContext'
import { signInComplete, walletDisplayId, walletLabel } from './types'

/** Header control. Always present. Opens the shared sign-in modal. */
export const WalletControl = () => {
  const { session, openSignIn } = useAuth()
  const done = signInComplete(session)
  const label = done && session?.wallet
    ? `${walletLabel(session.wallet.kind)} · ${walletDisplayId(session.wallet)}`
    : session
      ? 'Finish sign-in'
      : 'Sign in'

  return (
    <button
      type="button"
      className={'rail-wallet' + (done ? ' is-on' : '')}
      onClick={() => openSignIn()}
      aria-haspopup="dialog"
    >
      {label}
    </button>
  )
}
