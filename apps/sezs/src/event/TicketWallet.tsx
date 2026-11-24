import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import {
  readTickets,
  setTicketStatus,
  writeStore,
  type TicketRecord,
} from '../ticket'
import { encodeGuestQr, parseGuestQr } from '../ticket/v2/guest-qr.mjs'
import { fromHex } from '../ticket'
import { decodeInner, encodeInner, innerPayload, publicEnvelope } from '../zafu/envelope.mjs'
import { createLabZidProvider, labEncryptFor } from '../zafu/lab-provider.mjs'
import { RevealTicketQr } from './RevealTicketQr'

const compactQrOf = (t: TicketRecord) => {
  try {
    if (t.qr && parseGuestQr(t.qr).ok && String(t.qr).startsWith('sezs3')) return t.qr
    return encodeGuestQr({ secret: fromHex(t.secretHex), sku: t.sku, eventId: t.eventId })
  } catch {
    return t.qr
  }
}

const shortId = (t: TicketRecord) => (t.commitmentHex || '').slice(0, 8)
const statusOf = (t: TicketRecord) => (t.status === 'consumed' || t.status === 'transferred' ? t.status : 'unused')

const STATUSES = ['unused', 'consumed', 'transferred'] as const

const postEnvelope = async (pub: Record<string, unknown>) => {
  const res = await fetch('/sezs/ticket/envelope', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pub),
  })
  return res.json() as Promise<{ ok: boolean; error?: string }>
}

type Props = { eventName?: string; eventId?: string }

export const TicketWallet = ({ eventName, eventId }: Props) => {
  const [tickets, setTickets] = useState([] as TicketRecord[])
  const [status, setStatus] = useState<'all' | (typeof STATUSES)[number]>('all')
  const [event, setEvent] = useState('all')
  const [sku, setSku] = useState('all')
  const [open, setOpen] = useState<string | null>(null)
  const [friendPub, setFriendPub] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const refresh = () => setTickets(readTickets() as TicketRecord[])

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const events = useMemo(() => [...new Set(tickets.map((t) => t.eventId).filter(Boolean))], [tickets])
  const skus = useMemo(() => [...new Set(tickets.map((t) => t.sku).filter(Boolean))], [tickets])

  const rows = tickets.filter((t) => {
    if (status !== 'all' && statusOf(t) !== status) return false
    if (event !== 'all' && t.eventId !== event) return false
    if (sku !== 'all' && t.sku !== sku) return false
    return true
  })

  const active = tickets.find((t) => t.commitmentHex === open) || null

  const eventLabel = (id: string) => (id && eventId && id === eventId && eventName ? eventName : id)

  const onTransfer = async (t: TicketRecord) => {
    const pub = friendPub.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pub)) {
      setNote('Need a 64-character hex ZID key.')
      return
    }
    setBusy(true)
    setNote('')
    try {
      const h = await createLabZidProvider()
      const secret = fromHex(t.secretHex)
      const inner = encodeInner(
        innerPayload({
          secret,
          eventId: t.eventId,
          sku: t.sku,
          invoiceNonce: t.invoiceNonce || undefined,
          invoiceId: t.invoiceId || undefined,
          commitmentHex: t.commitmentHex,
        }),
      )
      const box = await labEncryptFor(h, { pubkey: pub }, inner)
      const r = await postEnvelope(
        publicEnvelope({
          commitment: t.commitmentHex,
          invoiceId: t.invoiceId || undefined,
          ciphertext: box.ciphertext,
          ephemeral_pubkey: box.ephemeral_pubkey,
          pq_epoch: box.pq_epoch,
          pq_suite: box.pq_suite,
          origin: typeof location !== 'undefined' ? location.origin : null,
          postQuantum: box.postQuantum,
        }),
      )
      if (!r.ok) throw new Error(r.error || 'Transfer refused.')
      setTicketStatus(t.commitmentHex, 'transferred', { transferredTo: pub })
      // keep a local copy; status is transferred
      writeStore({ ...t, status: 'transferred', transferredTo: pub, sealed: { at: Date.now(), to: pub } })
      setFriendPub('')
      refresh()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Transfer failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!tickets.length) {
    return (
      <div className="ticket-wallet">
        <span className="admin-badge">None</span>
        <p className="halo-act">
          <Link className="pix-btn" href="/tickets">Tickets</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="ticket-wallet">
      <div className="ticket-wallet-bar">
        <span className="admin-badge" data-ticket-count={rows.length}>
          {rows.length}
        </span>
        <div className="ticket-filters" role="group" aria-label="Filters">
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="all">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Event
            <select value={event} onChange={(e) => setEvent(e.target.value)}>
              <option value="all">All</option>
              {events.map((id) => (
                <option key={id} value={id}>
                  {eventLabel(id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            SKU
            <select value={sku} onChange={(e) => setSku(e.target.value)}>
              <option value="all">All</option>
              {skus.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <ul className="ticket-grid">
        {rows.map((t) => (
          <li key={t.commitmentHex}>
            <button
              type="button"
              className={'ticket-card' + (open === t.commitmentHex ? ' is-on' : '')}
              onClick={() => {
                setOpen(t.commitmentHex)
                setNote('')
              }}
            >
              <strong className="ticket-card-event">{eventLabel(t.eventId)}</strong>
              <span className="admin-badge">{t.sku}</span>
              <span className={'ticket-st is-' + statusOf(t)}>{statusOf(t)}</span>
              <span className="ticket-card-id mono">{shortId(t)}</span>
            </button>
          </li>
        ))}
      </ul>

      {active ? (
        <div
          className="wallet-scrim"
          role="presentation"
          onClick={() => setOpen(null)}
          data-ticket-detail="open"
        >
          <div
            className="wallet-modal ticket-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ticket-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="wallet-modal-bar">
              <h2 id="ticket-detail-title">{eventLabel(active.eventId)}</h2>
              <button type="button" className="pix-link" onClick={() => setOpen(null)}>
                close
              </button>
            </div>
            <div className="admin-badges">
              <span className="admin-badge">{active.sku}</span>
              <span className={'ticket-st is-' + statusOf(active)}>{statusOf(active)}</span>
              <span className="admin-badge mono">{shortId(active)}</span>
            </div>
            <RevealTicketQr value={compactQrOf(active)} label={shortId(active)} />
            {statusOf(active) !== 'consumed' ? (
              <form
                className="ticket-transfer"
                onSubmit={(e) => {
                  e.preventDefault()
                  void onTransfer(active)
                }}
              >
                <label>
                  Transfer
                  <input
                    className="field"
                    value={friendPub}
                    onChange={(e) => setFriendPub(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    name="zid"
                    placeholder="zid"
                    aria-label="Recipient ZID"
                  />
                </label>
                <button className="pix-btn ghost" type="submit" disabled={busy}>
                  Transfer
                </button>
              </form>
            ) : null}
            {note ? <p className="msg">{note}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
