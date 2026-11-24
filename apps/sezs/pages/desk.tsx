import { FormEvent, useEffect, useState } from 'react'

import { useAuth } from '../src/auth/AuthContext'
import { artistSessionOk } from '../src/auth/artistSession'
import { signInComplete } from '../src/auth/types'
import { DeskPanel } from '../src/event/DeskPanel'
import { useEvent } from '../src/event/useEvent'
import { eventNameOf } from '../src/event/title'
import { Shell } from '../src/ui/Frame'

type PayApi = {
  ARTISTS: { id: string; name: string; set: string }[]
  unlock: (
    session: unknown,
    billedId: string
  ) => { ok: boolean; id?: string; name?: string; message?: string }
}

const grabPay = (): PayApi | null => {
  if (typeof window === 'undefined') return null
  return (window as unknown as { SEZS_ARTIST_PAY?: PayApi }).SEZS_ARTIST_PAY || null
}

const Desk = () => {
  const ev = useEvent()
  const { session, openSignIn } = useAuth()
  const signedIn = signInComplete(session)
  const ok = artistSessionOk(session)
  const [who, setWho] = useState('')
  const [note, setNote] = useState('')
  const [pay, setPay] = useState<PayApi | null>(null)
  const name = eventNameOf(ev.data?.event.name)

  useEffect(() => {
    const found = grabPay()
    if (found) {
      setPay(found)
      return
    }
    const s = document.createElement('script')
    s.src = '/sezs-assets/artist-pay.js'
    s.async = true
    s.onload = () => setPay(grabPay())
    document.head.appendChild(s)
    return () => {
      s.remove()
    }
  }, [])

  const onPick = (e: FormEvent) => {
    e.preventDefault()
    if (!pay || !session) {
      setNote('Sign in first.')
      return
    }
    const r = pay.unlock(session, who)
    setNote(r.ok ? `${r.name} · flags here are not a send.` : r.message || 'Not billed.')
  }

  return (
    <Shell title={`Artist desk · ${name}`} blur="always">
      <section>
        <div className="wrap desk-readable">
          <h2 className="section-title">Artist desk</h2>
          {!signedIn ? (
            <p className="halo-act">
              <button type="button" className="pix-btn" onClick={() => openSignIn()}>
                Sign in
              </button>
            </p>
          ) : (
            <>
              <form className="cta-row" onSubmit={onPick}>
                <label htmlFor="billed-id">Billed name</label>
                <select
                  id="billed-id"
                  className="field"
                  value={who}
                  onChange={(e) => setWho(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {(pay?.ARTISTS || ev.data?.artists || []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}{'set' in a && a.set ? ` · ${a.set}` : ''}
                    </option>
                  ))}
                </select>
                <button className="btn" type="submit" disabled={!ok || !who}>
                  Open queue
                </button>
              </form>
              {note ? <p className="muted">{note}</p> : null}
              {session ? <DeskPanel session={session} /> : null}
            </>
          )}
        </div>
      </section>
    </Shell>
  )
}

export default Desk
