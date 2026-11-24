import { FormEvent, useEffect, useState } from 'react'

import { frostError } from './errors'
import {
  ackRosterChange,
  initialRoster,
  needsRekey,
  proposeRosterChange,
  recordRekey,
  RosterState,
} from './rosterChange'
import { verifyRekeyTx } from './rekeyVerify'

export function RosterPanel(props: {
  onRoster: (state: RosterState) => void
}) {
  const [state, setState] = useState<RosterState>(() => initialRoster())
  const [seat, setSeat] = useState('')
  const [action, setAction] = useState<'add' | 'remove'>('add')
  const [newVk, setNewVk] = useState('')
  const [error, setError] = useState('')
  const [rekey, setRekey] = useState('')

  useEffect(() => {
    props.onRoster(state)
    // initial roster only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const apply = (next: RosterState) => {
    setState(next)
    setError('')
    props.onRoster(next)
  }

  const onPropose = (e: FormEvent) => {
    e.preventDefault()
    const r = proposeRosterChange(state, 'desk', newVk, seat, action)
    if (!r.ok) {
      setError(frostError(r.error))
      return
    }
    apply(r.state)
  }

  const onAck = (id: string) => {
    const r = ackRosterChange(state, id, `ack:${state.epoch + 1}:${id}:${seat}`)
    if (!r.ok) {
      setError(frostError(r.error))
      return
    }
    apply(r.state)
  }

  const onRekey = async (e: FormEvent) => {
    e.preventDefault()
    const checked = await verifyRekeyTx(rekey)
    if (!checked.ok) {
      setError(frostError(checked.error))
      return
    }
    const r = recordRekey(state, rekey.trim().toLowerCase())
    if (!r.ok) {
      setError(frostError(r.error))
      return
    }
    apply(r.state)
  }

  const pendingShares = state.pending ? Object.keys(state.pending.shares).length : 0

  return (
    <div className="admin-panel-block">
      <div className="admin-badges">
        <span className="admin-badge">
          {state.t} of {state.n}
        </span>
        <span className="admin-badge">Epoch {state.epoch}</span>
        {state.pending ? (
          <span className="admin-badge">
            Pending {pendingShares} of {state.t}
          </span>
        ) : (
          <span className="admin-badge ok">Ready</span>
        )}
        {needsRekey(state) ? <span className="admin-badge bad">Rekey</span> : null}
      </div>
      {state.seats.length ? (
        <ul className="admin-seat-list">
          {state.seats.map((id) => (
            <li key={id}>
              <span className="mono">{id}</span>
              {state.pending ? (
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => onAck(id)}
                  disabled={Boolean(state.pending.shares[id])}
                >
                  {state.pending.shares[id] ? 'Agreed' : 'Agree'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <span className="admin-badge">None</span>
      )}
      {state.pending ? (
        <div className="admin-badges">
          <span className="admin-badge">{action}</span>
          <span className="mono fine">{state.pending.newVk}</span>
          <span className="mono fine">{state.pending.nextSeats.join(' · ')}</span>
        </div>
      ) : null}
      {error ? <p className="msg bad">{error}</p> : null}
      <form className="cta-row" onSubmit={onPropose}>
        <select
          className="field"
          aria-label="Add or remove"
          value={action}
          onChange={(e) => setAction(e.target.value === 'remove' ? 'remove' : 'add')}
        >
          <option value="add">Add holder</option>
          <option value="remove">Remove holder</option>
        </select>
        <input
          className="field"
          aria-label="Seat id"
          value={seat}
          onChange={(e) => setSeat(e.target.value)}
          placeholder="Seat"
          spellCheck={false}
        />
        <input
          className="field"
          aria-label="New group verifying key"
          value={newVk}
          onChange={(e) => setNewVk(e.target.value)}
          placeholder="New group key"
          spellCheck={false}
        />
        <button className="btn" type="submit" disabled={Boolean(state.pending)}>
          Propose
        </button>
      </form>
      {needsRekey(state) ? (
        <form className="cta-row" onSubmit={onRekey}>
          <input
            className="field"
            aria-label="Rekey transaction id"
            value={rekey}
            onChange={(e) => setRekey(e.target.value)}
            placeholder="Rekey txid"
            spellCheck={false}
          />
          <button className="btn ghost" type="submit">
            Check rekey
          </button>
        </form>
      ) : null}
    </div>
  )
}
