import { FormEvent, useEffect, useMemo, useState } from 'react'

import { Movement } from '../ui/primitives'
import { QrSvg } from '../ui/QrSvg'

type Invite = {
  id: string
  role: string
  label: string
  status: string
  createdAt: number
}

type Participant = {
  id: string
  inviteId: string
  role: string
  label: string
  displayName: string
  status: string
  zec: string
  um: string
  amount: string
  registeredAt: number
  paidAt: number | null
}

type Batch = {
  id: string
  status: string
  items: { participantId: string; displayName: string; amount: string; role: string }[]
  splits: { charity: number; venue: number; remainder: number }
  digest: string
  sessionId: string | null
  receiptId: string | null
  execution: { kind: string; chain?: string; frostGate?: string; frostNote?: string; note?: string } | null
  createdAt: number
  note: string
}

type State = {
  ok: boolean
  splits: { charity: number; venue: number; remainder: number }
  roleAmounts: Record<string, string>
  invites: Invite[]
  participants: Participant[]
  batches: Batch[]
}

const ROLES = ['artist', 'vendor', 'staff', 'usher'] as const

const api = async (path: string, body?: unknown) => {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

export const ParticipantsPanel = () => {
  const [st, setSt] = useState<State | null>(null)
  const [note, setNote] = useState('Issue a one-time key, then share it privately.')
  const [role, setRole] = useState<(typeof ROLES)[number]>('artist')
  const [label, setLabel] = useState('')
  const [issued, setIssued] = useState<{ key: string; local: string; pub: string; invite: Invite } | null>(null)
  const [busy, setBusy] = useState(false)
  const [hideKey, setHideKey] = useState(false)
  const [charity, setCharity] = useState('0.111')
  const [venue, setVenue] = useState('0.111')
  const [remainder, setRemainder] = useState('0.778')
  const [roleAmounts, setRoleAmounts] = useState<Record<string, string>>({
    artist: '',
    vendor: '',
    staff: '',
    usher: '',
  })
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [progress, setProgress] = useState('')

  const load = async () => {
    const d = await api('/sezs/payroll/state')
    if (!d?.ok) {
      setNote(d?.error === 'not_coordinator' ? 'Only event coordinators can open Participants.' : d?.error || 'Could not load participants.')
      setSt(null)
      return
    }
    setSt(d)
    setCharity(String(d.splits.charity))
    setVenue(String(d.splits.venue))
    setRemainder(String(d.splits.remainder))
    setRoleAmounts({ artist: '', vendor: '', staff: '', usher: '', ...d.roleAmounts })
    const next: Record<string, string> = {}
    for (const p of d.participants) next[p.id] = p.amount || d.roleAmounts[p.role] || ''
    setAmounts(next)
  }

  useEffect(() => {
    void load()
  }, [])

  const onGenerate = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setIssued(null)
    setHideKey(false)
    try {
      const d = await api('/sezs/payroll/invites', { role, label })
      if (!d?.ok) {
        setNote(d?.error || 'Could not issue a key.')
        return
      }
      setIssued({ key: d.key, local: d.share.local, pub: d.share.public, invite: d.invite })
      setNote('Key issued once. Copy it now — the server stored only a commitment.')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setNote(`Copied ${what}.`)
    } catch {
      setNote('Copy failed. Select the text instead.')
    }
  }

  const saveAmounts = async () => {
    setBusy(true)
    try {
      const d = await api('/sezs/payroll/amounts', {
        splits: { charity: Number(charity), venue: Number(venue), remainder: Number(remainder) },
        roleAmounts,
        amounts: Object.entries(amounts).map(([id, amount]) => ({ id, amount })),
      })
      if (!d?.ok) setNote(d?.error || 'Could not save amounts.')
      else {
        setNote('Amounts and split parameters saved for this session.')
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  const propose = async () => {
    setBusy(true)
    try {
      const d = await api('/sezs/payroll/batches', { note: 'session payroll' })
      if (!d?.ok) setNote(d?.error || 'Could not propose a batch.')
      else {
        setNote(`Batch ${d.batch.id} proposed. Digest ${d.batch.digest.slice(0, 12)}…`)
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  const signBatch = async (batchId: string) => {
    setBusy(true)
    setProgress('Opening a FROST session on the local bouncer…')
    try {
      const d = await api('/sezs/payroll/batches/frost', { batchId })
      if (!d?.ok) {
        setNote(d?.error || 'FROST signing failed.')
        setProgress('')
        return
      }
      setProgress(`Signed over session ${d.sessionId.slice(0, 8)}…`)
      setNote('FROST 2-of-3 signature accepted. You can execute the ZEC and UM payouts.')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const execute = async (batchId: string) => {
    setBusy(true)
    try {
      const d = await api('/sezs/payroll/batches/execute', { batchId })
      if (!d?.ok) setNote(d?.error === 'chain_unavailable' ? 'Local Zcash and Penumbra are not up, so the payouts were not submitted.' : (d?.message || d?.error || 'Execute failed.'))
      else {
        const zec = (d.batch.execution?.zec || []).map((x: { txid?: string }) => x.txid).filter(Boolean).join(', ')
        const um = (d.batch.execution?.um || []).map((x: { txid?: string }) => x.txid).filter(Boolean).join(', ')
        setNote(`Payouts submitted on the local chains.${zec ? ' ZEC ' + zec : ''}${um ? ' UM ' + um : ''}`)
        setProgress('')
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  const displayKey = useMemo(() => {
    if (!issued) return ''
    if (hideKey) return 'sezsreg_' + '•'.repeat(24)
    return issued.key
  }, [issued, hideKey])

  const displayLink = (url: string) => {
    if (!issued) return url
    if (!hideKey) return url
    return url.replace(issued.key, 'sezsreg_' + '•'.repeat(16))
  }

  return (
    <>
      <Movement n={1} title="Issue a registration key" lede="One-time commitment. The plaintext is shown once and never stored." align="left">
        <form className="inline-form" onSubmit={onGenerate}>
          <label className="fine">
            Role
            <select className="field" value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="fine">
            Label (optional)
            <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="act or name" maxLength={80} />
          </label>
          <button className="pix-btn" type="submit" disabled={busy}>
            Generate key
          </button>
        </form>
        {issued ? (
          <div className="payroll-issue" data-redact={hideKey ? '1' : '0'}>
            <p className="mono fine" data-reg-key={hideKey ? 'redacted' : 'live'}>
              {displayKey}
            </p>
            <p className="fine">{displayLink(issued.local)}</p>
            <p className="fine">{displayLink(issued.pub)}</p>
            <div className="inline-form">
              <button className="pix-btn ghost" type="button" onClick={() => void copy(issued.key, 'the key')}>
                Copy key
              </button>
              <button className="pix-btn ghost" type="button" onClick={() => void copy(issued.local, 'the local link')}>
                Copy local link
              </button>
              <button className="pix-btn ghost" type="button" onClick={() => void copy(issued.pub, 'the public link')}>
                Copy public link
              </button>
              <button className="pix-btn ghost" type="button" onClick={() => setHideKey((v) => !v)}>
                {hideKey ? 'Show key' : 'Redact key'}
              </button>
            </div>
            <div className="payroll-qr" data-reg-qr="1" aria-label="Registration QR">
              <QrSvg value={hideKey ? issued.local.replace(issued.key, 'redacted') : issued.local} />
            </div>
          </div>
        ) : null}
        <p className="fine">{note}</p>
      </Movement>

      <Movement n={2} title="Participants" lede="Addresses are truncated. Status: invited, registered, or paid." align="left">
        <table className="payroll-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>ZEC</th>
              <th>UM</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {(st?.participants || []).map((p) => (
              <tr key={p.id}>
                <td>{p.displayName || p.label || '—'}</td>
                <td>{p.role}</td>
                <td>{p.status}</td>
                <td className="mono">{p.zec}</td>
                <td className="mono">{p.um}</td>
                <td>
                  <input
                    className="field"
                    value={amounts[p.id] ?? ''}
                    onChange={(e) => setAmounts((m) => ({ ...m, [p.id]: e.target.value }))}
                    aria-label={`Amount for ${p.displayName}`}
                  />
                </td>
              </tr>
            ))}
            {(st?.invites || [])
              .filter((i) => i.status === 'invited')
              .map((i) => (
                <tr key={i.id}>
                  <td>{i.label || '—'}</td>
                  <td>{i.role}</td>
                  <td>invited</td>
                  <td>—</td>
                  <td>—</td>
                  <td>—</td>
                </tr>
              ))}
          </tbody>
        </table>
        {!st?.participants.length && !st?.invites.length ? <p className="fine">No participants yet.</p> : null}
      </Movement>

      <Movement n={3} title="Session split and role amounts" lede="Coordinators set these parameters per session." align="left">
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            void saveAmounts()
          }}
        >
          <label className="fine">
            Charity
            <input className="field" value={charity} onChange={(e) => setCharity(e.target.value)} />
          </label>
          <label className="fine">
            Venue
            <input className="field" value={venue} onChange={(e) => setVenue(e.target.value)} />
          </label>
          <label className="fine">
            Remainder
            <input className="field" value={remainder} onChange={(e) => setRemainder(e.target.value)} />
          </label>
          {ROLES.map((r) => (
            <label className="fine" key={r}>
              {r} amount
              <input
                className="field"
                value={roleAmounts[r] || ''}
                onChange={(e) => setRoleAmounts((m) => ({ ...m, [r]: e.target.value }))}
              />
            </label>
          ))}
          <button className="pix-btn" type="submit" disabled={busy}>
            Save parameters
          </button>
        </form>
      </Movement>

      <Movement n={4} title="Payout batch" lede="Propose a batch, then approve it with a 2-of-3 FROST signature over the local bouncer." align="left">
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            void propose()
          }}
        >
          <button className="pix-btn" type="submit" disabled={busy}>
            Propose batch
          </button>
        </form>
        {progress ? <p className="fine" data-frost-progress="1">{progress}</p> : null}
        {(st?.batches || []).map((b) => (
          <div key={b.id} className="payroll-batch" data-batch-status={b.status}>
            <p className="fine">
              {b.id} · {b.status}
              {b.digest ? ` · digest ${b.digest.slice(0, 12)}…` : ''}
              {b.receiptId ? ` · receipt ${b.receiptId}` : ''}
            </p>
            <ul className="fine">
              {b.items.map((it) => (
                <li key={it.participantId}>
                  {it.displayName} ({it.role}) · {it.amount}
                </li>
              ))}
            </ul>
            {b.status === 'proposed' || b.status === 'signing' ? (
              <button className="pix-btn" type="button" disabled={busy} onClick={() => void signBatch(b.id)}>
                Sign with FROST
              </button>
            ) : null}
            {b.status === 'signed' ? (
              <button className="pix-btn" type="button" disabled={busy} onClick={() => void execute(b.id)}>
                Execute payouts
              </button>
            ) : null}
            {b.status === 'executed' && b.execution ? (
              <p className="fine">
                Executed as {b.execution.kind}{b.execution.frostGate ? ` · ${b.execution.frostGate}` : ''}.
              </p>
            ) : null}
          </div>
        ))}
      </Movement>
    </>
  )
}

export default ParticipantsPanel
