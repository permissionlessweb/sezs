import { useMemo, useState } from 'react'

import { TicketQr, readTickets, type TicketRecord } from '../ticket'
import { encodeGuestQr, parseGuestQr, guestQrSize, GUEST_QR_CHAR_BUDGET } from '../ticket/v2/guest-qr.mjs'
import { fromHex } from '../ticket'

const PRINT_COPIES = 9

const compactQrOf = (t: TicketRecord) => {
  try {
    if (t.qr && parseGuestQr(t.qr).ok && String(t.qr).startsWith('sezs3')) return t.qr
    return encodeGuestQr({ secret: fromHex(t.secretHex), sku: t.sku, eventId: t.eventId })
  } catch {
    return t.qr
  }
}

export const GuestTicket = ({ tickets }: { tickets?: TicketRecord[] }) => {
  const list = tickets || (typeof window !== 'undefined' ? (readTickets() as TicketRecord[]) : [])
  const [ix, setIx] = useState(0)
  const [print, setPrint] = useState(false)
  const ticket = list[ix] || list[0]
  const qr = useMemo(() => (ticket ? compactQrOf(ticket) : ''), [ticket])
  const size = qr ? guestQrSize(qr) : null

  if (!list.length) {
    return (
      <p className="honest">
        No ticket is stored in this browser. Buy on the tickets page first. Signing in is not a ticket.
      </p>
    )
  }

  return (
    <div className="guest-ticket" data-qr-chars={size?.chars || 0}>
      {list.length > 1 ? (
        <label>
          Ticket
          <select value={String(ix)} onChange={(e) => setIx(Number(e.target.value))}>
            {list.map((t, i) => (
              <option key={t.commitmentHex} value={i}>
                {t.sku} · {t.commitmentHex.slice(0, 8)}…
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="honest">
        Show this code at the door. It is the ticket opening only — not a proof. The usher’s device builds the
        proof. Anyone who has this code can be admitted once.
      </p>
      {qr ? (
        <div className="guest-ticket-qr">
          <TicketQr value={qr} label="Your ticket" />
        </div>
      ) : null}
      {size ? (
        <p className="muted">
          Ticket QR v3 · {size.chars} characters
          {size.withinBudget ? ` (budget ${GUEST_QR_CHAR_BUDGET})` : ' — over the usual size budget'}
        </p>
      ) : null}
      <p className="halo-act">
        <button type="button" className="pix-btn ghost" onClick={() => setPrint((v) => !v)}>
          {print ? 'Hide printout' : 'Print a 3×3 grid'}
        </button>
      </p>
      {print && qr ? (
        <div className="guest-print">
          <p className="honest">
            Nine copies of the same ticket. Any one is enough if another is damaged. This replaces the old five-to-nine
            proof grid — the proof is no longer printed.
          </p>
          <ol className="proof-grid guest-print-grid">
            {Array.from({ length: PRINT_COPIES }, (_, i) => (
              <li key={i}>
                <span className="proof-grid-n">
                  {i + 1}/{PRINT_COPIES}
                </span>
                <TicketQr value={qr} label={`Print copy ${i + 1} of ${PRINT_COPIES}`} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}
