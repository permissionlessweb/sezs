import { FormEvent, useEffect, useState } from 'react'

import { frostError } from './errors'
import {
  ackUsher,
  doorCheckIn,
  emptyUsherBook,
  proposeUsher,
  UsherBook,
} from './usherBook'

const KEY = 'sezs-usher-book'

function load(): UsherBook {
  if (typeof sessionStorage === 'undefined') return emptyUsherBook()
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return emptyUsherBook()
    const b = JSON.parse(raw) as UsherBook
    if (!Array.isArray(b.ushers)) return emptyUsherBook()
    return b
  } catch {
    return emptyUsherBook()
  }
}

export function UsherPanel(props: { holders: string[]; threshold: number }) {
  const [book, setBook] = useState<UsherBook>(emptyUsherBook)
  const [id, setId] = useState('')
  const [action, setAction] = useState<'add' | 'remove'>('add')
  const [error, setError] = useState('')

  useEffect(() => {
    setBook(load())
  }, [])

  const save = (next: UsherBook) => {
    setBook(next)
    setError('')
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* private mode: the door page will not see it */
    }
  }

  const onPropose = (e: FormEvent) => {
    e.preventDefault()
    const r = proposeUsher(book, props.holders, 'desk', id, action)
    if (!r.ok) {
      setError(frostError(r.error))
      return
    }
    save(r.book)
  }

  const onAck = (actor: string) => {
    const r = ackUsher(book, props.holders, actor, `usher:${book.pending?.action}:${actor}:${id}`, props.threshold)
    if (!r.ok) {
      setError(frostError(r.error))
      return
    }
    save(r.book)
  }

  const onDuty = book.ushers.filter((name) => doorCheckIn('usher', name, book))

  return (
    <div className="admin-panel-block">
      <div className="admin-badges">
        <span className="admin-badge">{book.ushers.length}</span>
        {book.pending ? <span className="admin-badge">Pending</span> : null}
        {onDuty.length ? <span className="admin-badge ok">{onDuty.length} on duty</span> : <span className="admin-badge">None</span>}
      </div>
      {book.ushers.length ? <p className="mono fine">{book.ushers.join(' · ')}</p> : null}
      {error ? <p className="msg bad">{error}</p> : null}
      {book.pending
        ? props.holders.map((h) => (
            <button key={h} className="btn ghost" type="button" onClick={() => onAck(h)} disabled={Boolean(book.pending?.shares[h])}>
              {h} {book.pending?.shares[h] ? 'agreed' : 'agrees'}
            </button>
          ))
        : null}
      <form className="cta-row" onSubmit={onPropose}>
        <select
          className="field"
          aria-label="Add or remove usher"
          value={action}
          onChange={(e) => setAction(e.target.value === 'remove' ? 'remove' : 'add')}
        >
          <option value="add">Add usher</option>
          <option value="remove">Remove usher</option>
        </select>
        <input
          className="field"
          aria-label="Usher id"
          placeholder="Usher"
          value={id}
          onChange={(e) => setId(e.target.value)}
          spellCheck={false}
        />
        <button className="btn" type="submit" disabled={Boolean(book.pending)}>
          Propose
        </button>
      </form>
    </div>
  )
}
