import { FormEvent, useEffect, useState } from 'react'

import { emailClient } from './emailAuth'

/** Email sign-in: request a 6-digit code (or follow the emailed link), then verify. */
export const EmailSignIn = ({ onVerified }: { onVerified?: (email: string) => void }) => {
  const client = emailClient()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [awaiting, setAwaiting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void client.refreshSession().then(() => {
      const s = client.getState()
      if (s.isAuthenticated && s.session?.email) {
        onVerified?.(s.session.email)
      }
    })
  }, [client, onVerified])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMsg('')
    try {
      await fn()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Email sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  const onRequest = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await client.requestLink(email)
      setAwaiting(true)
    })
  }

  const onVerify = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await client.verifyCode(email, code)
      onVerified?.(email.trim().toLowerCase())
    })
  }

  return (
    <div className="ticket-auth" data-adapter="email">
      <form onSubmit={awaiting ? onVerify : onRequest}>
        <label htmlFor="email-signin">Email</label>
        <input
          id="email-signin"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          disabled={awaiting}
          required
        />
        {awaiting ? (
          <>
            <label htmlFor="email-code">Code</label>
            <input
              id="email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(ev) => setCode(ev.target.value)}
              required
            />
          </>
        ) : null}
        <div className="row ticket-actions">
          <button className="btn pix-btn" type="submit" disabled={busy}>
            {busy ? '…' : awaiting ? 'Verify code' : 'Email me a code'}
          </button>
          {awaiting ? (
            <button
              className="btn ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                setAwaiting(false)
                setCode('')
                setMsg('')
              }}
            >
              Change email
            </button>
          ) : null}
        </div>
      </form>
      {msg ? <p className="msg bad">{msg}</p> : null}
    </div>
  )
}
