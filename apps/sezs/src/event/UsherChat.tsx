import { FormEvent, useEffect, useState } from 'react'

import { createLabZidProvider, labZidPubkey } from '../zafu/lab-provider.mjs'

type Member = { seat: string; zidPubkey: string; origin?: string | null }
type Group = {
  members: Member[]
  room: null | {
    id: string
    appScope: string
    channel: string
    stale: boolean
    createdAt: number
    inviteCount: number
  }
}

type Msg = { at: number; from: string; body: string }

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(path, { credentials: 'include', ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } })
  return res.json()
}

/**
 * Usher channel on the admin page, gated by ZID sign-in.
 */
export const UsherChat = ({ role }: { role: string | null }) => {
  const [group, setGroup] = useState<Group | null>(null)
  const [error, setError] = useState('')
  const [zid, setZid] = useState('')
  const [seat, setSeat] = useState('')
  const [body, setBody] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const allowed = role === 'admin' || role === 'usher'

  const refresh = async () => {
    const g = await api('/sezs/usher/group')
    if (g?.ok) setGroup(g.group)
    const m = await api('/sezs/usher/chat')
    if (m?.ok && Array.isArray(m.messages)) setMsgs(m.messages)
  }

  useEffect(() => {
    if (!allowed) return
    void refresh()
  }, [allowed])

  const onZid = async () => {
    setBusy(true)
    setError('')
    try {
      const lab = await createLabZidProvider()
      const pk = await labZidPubkey(lab)
      setZid(pk.pubkey)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ZID sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  const onRegister = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api('/sezs/usher/zid', {
        method: 'POST',
        body: JSON.stringify({ seat: seat || role, zidPubkey: zid, origin: typeof location !== 'undefined' ? location.origin : '' }),
      })
      if (!r.ok) setError(r.message || r.error || 'Register refused.')
      else await refresh()
    } finally {
      setBusy(false)
    }
  }

  const onRotate = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api('/sezs/usher/room', { method: 'POST', body: JSON.stringify({ rotate: true }) })
      if (!r.ok) setError(r.message || r.error || 'Room create refused.')
      else await refresh()
    } finally {
      setBusy(false)
    }
  }

  const onSend = async (e: FormEvent) => {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    setBusy(true)
    setError('')
    try {
      const r = await api('/sezs/usher/chat', { method: 'POST', body: JSON.stringify({ body: text, zidPubkey: zid }) })
      if (!r.ok) setError(r.message || r.error || 'Send refused.')
      else {
        setBody('')
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  if (!allowed) {
    return (
      <div className="usher-chat-panel" data-chat="locked">
        <span className="admin-badge">Locked</span>
      </div>
    )
  }

  const room = group?.room
  const memberCount = group?.members.length ?? 0

  return (
    <div className="usher-chat-panel">
      <div className="admin-badges">
        <span className={zid ? 'admin-badge ok' : 'admin-badge'}>{zid ? 'ZID ready' : 'No ZID'}</span>
        <span className="admin-badge">{memberCount}</span>
        <span className={room && !room.stale ? 'admin-badge ok' : room?.stale ? 'admin-badge bad' : 'admin-badge'}>
          {room ? (room.stale ? 'Stale' : 'Room') : 'No room'}
        </span>
      </div>
      <div className="cta-row">
        <button className="pix-btn" type="button" disabled={busy} onClick={() => void onZid()}>
          {zid ? 'ZID ready' : 'Sign in with ZID'}
        </button>
      </div>
      {zid ? <p className="mono dim break">{zid}</p> : null}
      <form className="inline-form" onSubmit={onRegister}>
        <input
          className="field"
          value={seat}
          onChange={(e) => setSeat(e.target.value)}
          aria-label="Seat"
          placeholder="Seat"
          spellCheck={false}
        />
        <button className="pix-btn ghost" type="submit" disabled={busy || !zid}>
          Register
        </button>
      </form>
      <button className="pix-btn" type="button" disabled={busy || !memberCount} onClick={() => void onRotate()}>
        {room && !room.stale ? 'Room is current' : 'Open room'}
      </button>
      <ul className="usher-log">
        {msgs.map((m, i) => (
          <li key={i}>
            <span className="mono dim">{m.from}</span> {m.body}
          </li>
        ))}
      </ul>
      <form className="cta-row" onSubmit={onSend}>
        <input
          className="field"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Message"
          placeholder="Message"
          spellCheck={false}
        />
        <button className="pix-btn" type="submit" disabled={busy || !zid || !room || room.stale}>
          Send
        </button>
      </form>
      {error ? <p className="msg bad">{error}</p> : null}
    </div>
  )
}
