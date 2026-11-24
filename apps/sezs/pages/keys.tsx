import { useState } from 'react'
import { useEvent } from '../src/event/useEvent'
import { eventNameOf } from '../src/event/title'
import { useAuth } from '../src/auth/AuthContext'
import { SignInShell } from '../src/auth/SignInModal'
import { Frame } from '../src/ui/Frame'
import { Halo, Movement, Orbit, Ritual } from '../src/ui/primitives'

const Keys = () => {
  const {
    session,
    error,
    addDevice,
    removeDevice,
    setPolicy,
    unlock,
  } = useAuth()
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const evName = eventNameOf(useEvent().data?.event.name)

  return (
    <Frame title={`Keys · ${evName}`} shape="octa" core={[0.5, 0.3]}>
      <Halo
        kicker="Sign-in"
        title="Keys"
        sub="Sign in with Zafu, or a passkey plus a browser key. A passkey on its own does not sign you in. Signing in does not mark you paid. Email sign-in is not available on this build."
      />

      <Movement n={1} title="Ways to sign in">
        <Orbit
          label="Ways to sign in"
          items={[
            { key: 'zafu', title: 'Zafu', note: 'Log in with Zafu. The extension signs a site-scoped ZID for this origin.' },
            { key: 'zafu-passkey', title: 'Zafu passkey', note: 'A Zafu passkey plus a browser key sealed with WebAuthn PRF. User verification is required.' },
            { key: 'eph', title: 'This browser', note: 'A passkey on this device plus a browser key sealed with WebAuthn PRF. No plaintext fallback.' },
          ]}
          center={<span className="orbit-center-t">one account</span>}
        />
      </Movement>

      {!session ? (
        <Movement n={2} title="Sign in" align="left">
          <SignInShell variant="page" />
        </Movement>
      ) : (
        <>
          <Movement n={2} title="Your devices" lede="Policy decides which keys can unlock. anyOf means any one listed device. allOf means every listed device, in order.">
            <div className="toggle-pair" role="group" aria-label="Unlock policy">
              <button type="button" className={'pix-btn' + (session.policy === 'anyOf' ? '' : ' ghost')} disabled={busy || session.policy === 'anyOf'} onClick={() => setPolicy('anyOf')}>
                anyOf
              </button>
              <span className="toggle-line" aria-hidden="true" />
              <button type="button" className={'pix-btn' + (session.policy === 'allOf' ? '' : ' ghost')} disabled={busy || session.policy === 'allOf'} onClick={() => setPolicy('allOf')}>
                allOf
              </button>
            </div>
            <Orbit
              label="Devices"
              center={<span className={'orbit-center-t ' + (session.paid ? 'ok' : 'bad')}>{session.paid ? `paid · ${session.paid.rail}` : 'not paid'}</span>}
              items={session.authenticators.map((a) => ({
                key: a.credId,
                title: a.label,
                note: (
                  <>
                    <span className="mono">{a.credId.slice(0, 10)}…</span>
                    {session.authenticators.length > 1 ? (
                      <button type="button" className="pix-link" disabled={busy} onClick={() => run(() => removeDevice(a.credId))}>
                        remove
                      </button>
                    ) : null}
                  </>
                ),
              }))}
            />
          </Movement>
          <Movement n={3} title="Rotate a key">
            <Ritual steps={[{ title: 'Add the new device' }, { title: 'Unlock with it once' }, { title: 'Remove the old one' }]} />
            <div className="inline-form">
              <label htmlFor="key-label">New device label</label>
              <input id="key-label" placeholder="phone, laptop…" value={label} onChange={(e) => setLabel(e.target.value)} />
              <button className="pix-btn" type="button" disabled={busy} onClick={() => run(() => addDevice(label))}>
                Add device
              </button>
              <button className="pix-btn ghost" type="button" disabled={busy} onClick={() => run(() => unlock())}>
                Unlock ({session.policy})
              </button>
            </div>
            {error ? <p className="msg bad">{error}</p> : null}
            <p className="fine">Artist 20/80 payouts are handled on the desk after a paid ticket, not here.</p>
          </Movement>
        </>
      )}
    </Frame>
  )
}

export default Keys
