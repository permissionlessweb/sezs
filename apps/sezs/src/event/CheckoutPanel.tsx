import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { RailId, TicketTier, priceCents } from './api'
import {
  EVENT_ID,
  memoOf,
  newTicketMaterial,
  readTickets,
  ticketRecord,
  toHex,
  writeStore,
  TicketQr,
} from '../ticket'
import { appendPurchase, purchaseCount } from '../ticket/purchase.mjs'
import { loadTicketV2 } from '../ticket/v2/index.mjs'
import {
  LabInvoice,
  connectPenumbra,
  invoiceDestOk,
  pollPaid,
  requestInvoice,
  splashOn,
} from '../pay/invoice'
import {
  bumpPhase,
  hapticForBump,
  ownPhase,
  phaseIsPaid,
  statusFromPaid,
  statusMark,
  ticketStepOf,
  TICKET_LABEL,
  TICKET_STEPS,
  type MintPhase,
  type StatusMark,
} from '../pay/checkoutStatus'
import type { InfoFact } from '../ui/InfoPane'
import { startVisibleInterval } from '../query/visibility'

const usd = (c: number) => `$${(c / 100).toFixed(2)}`

type Props = { rail: RailId; tier: TicketTier; eventId?: string; eventName?: string; domain?: string; qty?: number }

export const SHIELDED_FACTS = (rail: RailId, price: string): InfoFact[] => [
  { label: 'Price', value: `${price} · 50% off list` },
  {
    label: 'Network',
    value: 'No mainnet address is quoted from this page.',
  },
  {
    label: 'Quote',
    value:
      rail === 'zec'
        ? 'A URI on screen is not paid. Open it in Zafu, or scan the QR. Do not send real funds.'
        : 'A destination on screen is not paid. Do not send real funds.',
  },
  {
    label: 'Secret',
    value:
      'This browser makes a fresh ticket secret for this purchase: a hash derivation of a random seed, this event, the ticket type, and a one-time nonce. It is not derived from your payment key or wallet. The payment memo carries only the commitment. Signing in is not a ticket. A quoted destination is not paid. Lab destinations only — do not send real funds. You can buy another ticket as a separate payment.',
  },
  {
    label: 'Status',
    value: `Checkout for shielded ${rail === 'zec' ? 'ZEC' : 'Penumbra'} opens when a lab or testnet watcher is running.`,
  },
]

const copyText = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

const CopyRow = ({ label, value }: { label: string; value: string }) => {
  const [copied, setCopied] = useState(false)
  return (
    <p className="ledger-line pay-copy-row">
      <span>{label}</span>
      <span className="mono break">{value}</span>
      <button
        type="button"
        className="pix-link"
        onClick={() => {
          void copyText(value).then((ok) => {
            setCopied(ok)
            if (ok) window.setTimeout(() => setCopied(false), 1600)
          })
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </p>
  )
}

/** ZIP-321 URI and memo, collapsed under the QR by default. */
export const PayDetails = ({ uri, memo, dest }: { uri?: string | null; memo: string; dest?: string }) => {
  const [open, setOpen] = useState(false)
  const bodyId = 'pay-details-body'
  return (
    <div className="pay-details">
      <button
        type="button"
        className="pix-link"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide payment string' : uri ? 'Show ZIP-321 and memo' : 'Show destination and memo'}
      </button>
      {open ? (
        <div id={bodyId}>
          {uri ? <CopyRow label="ZIP-321" value={uri} /> : dest ? <CopyRow label="Destination" value={dest} /> : null}
          <CopyRow label="Memo" value={memo} />
        </div>
      ) : null}
    </div>
  )
}

const PayStatus = ({ step }: { step: (typeof TICKET_STEPS)[number] }) => {
  const idx = TICKET_STEPS.indexOf(step)
  return (
    <div className={'pay-status is-' + step} role="status">
      <ol className="pay-status-steps" aria-label="Payment status">
        {TICKET_STEPS.map((s, i) => {
          const done = idx > i || (step === 'accepted' && i === idx)
          const on = i === idx && !done
          return (
            <li key={s} className={done ? 'is-done' : on ? 'is-on' : ''} data-co={s}>
              {TICKET_LABEL[s]}
            </li>
          )
        })}
      </ol>
      <p className="pay-status-now">{TICKET_LABEL[step]}</p>
    </div>
  )
}

export const CheckoutPanel = ({ rail, tier, eventId, eventName, qty = 1 }: Props) => {
  const eid = eventId || EVENT_ID
  const sku = tier.id
  const live = splashOn() && (rail === 'zec' || rail === 'penumbra')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [invoice, setInvoice] = useState<LabInvoice | null>(null)
  const [batch, setBatch] = useState<LabInvoice[]>([])
  const [batchIx, setBatchIx] = useState(0)
  const [qr, setQr] = useState('')
  const [paid, setPaid] = useState(false)
  const count = purchaseCount(qty)
  const [phase, setPhase] = useState<MintPhase>('waiting')
  const baselineRef = useRef<StatusMark | null>(null)
  const lastPhaseRef = useRef<MintPhase>('waiting')

  const price = usd(priceCents(tier, rail))
  const step = ticketStepOf(phase)

  const applyStatus = (body: { phase?: string | null; paid?: boolean; status?: string | null; invoice?: LabInvoice }) => {
    const st = statusFromPaid(body)
    const next = bumpPhase(lastPhaseRef.current, ownPhase(st, baselineRef.current))
    if (next !== lastPhaseRef.current) {
      hapticForBump(lastPhaseRef.current, next)
      lastPhaseRef.current = next
    }
    setPhase(next)
    const nowPaid = phaseIsPaid(next, body.paid)
    if (nowPaid) {
      setPaid(true)
      if (body.invoice) setInvoice(body.invoice)
    }
    return nowPaid
  }

  const settleCurrent = (inv: LabInvoice) => {
    const list = (readTickets() as { commitmentHex: string }[])
    const rec = list.find((t) => t.commitmentHex === inv.commitment)
    if (rec) writeStore({ ...rec, paidAt: Date.now() })
    const next = batch.slice(batchIx + 1)
    if (next.length) {
      const nx = next[0]
      setBatchIx(batchIx + 1)
      setInvoice(nx)
      setPaid(false)
      lastPhaseRef.current = 'waiting'
      setPhase('waiting')
      baselineRef.current = statusMark({ phase: 'waiting' })
      setMsg(`Ticket ${batchIx + 2} of ${batch.length}. A URI on screen is not paid.`)
      return 'next'
    }
    setPaid(true)
    setInvoice(inv)
    return 'done'
  }


  const invoiceOf = (rec: { invoiceId?: string | null; rail?: string | null; sku: string; eventId: string; commitmentHex: string; dest?: string | null; memo: string; uri?: string | null; paidAt?: number | null }) => ({
    id: rec.invoiceId || '',
    rail: (rec.rail || rail) as RailId,
    sku: rec.sku,
    eventId: rec.eventId,
    amountCents: priceCents(tier, rail) ,
    commitment: rec.commitmentHex,
    dest: rec.dest || '',
    memo: rec.memo,
    uri: rec.uri || null,
    status: rec.paidAt ? 'paid' as const : 'pending' as const,
    paidAt: rec.paidAt || null,
    leafIndex: null,
  })

  useEffect(() => {
    const pending = (readTickets() as { eventId: string; sku: string; rail?: string | null; uri?: string | null; dest?: string | null; paidAt?: number | null; invoiceId?: string | null; commitmentHex: string; memo: string; qr?: string }[])
      .filter((t) => t.eventId === eid && t.sku === sku && t.rail === rail && !t.paidAt && (t.uri || t.dest))
    if (!pending.length) return
    const invoices = pending.map(invoiceOf)
    setBatch(invoices)
    setBatchIx(0)
    setInvoice(invoices[0])
    setPaid(false)
    const rec = pending[0]
    if (rec.qr) setQr(rec.qr)
  }, [eid, sku, rail, tier])

  useEffect(() => {
    if (!invoice || paid || !live) return
    let stop = false
    const tick = async () => {
      try {
        const r = await pollPaid(invoice.commitment)
        if (stop) return
        if (r.ok === false && r.error === 'unknown_invoice') return
        const nowPaid = applyStatus(r)
        if (nowPaid && invoice) {
          const step = settleCurrent(invoice)
          if (step === 'done') setMsg('Payment has been confirmed.')
        }
      } catch {
        /* watcher may be down; keep waiting */
      }
    }
    const off = startVisibleInterval(() => void tick(), 2000)
    return () => {
      stop = true
      off()
    }
    // applyStatus is stable enough over this invoice's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice, paid, live])

  const start = async () => {
    if (!live) return
    setBusy(true)
    setMsg('')
    try {
      const v2 = await loadTicketV2()
      const result = await appendPurchase({
        count,
        rail,
        sku,
        eventId: eid,
        buildRecord: async () => {
          const material = await newTicketMaterial({ eventId: eid, sku })
          const secret = v2.fitSecret(material.secret)
          const commitmentBytes = v2.commitment(secret, sku, eid)
          return ticketRecord({
            secret,
            sku,
            eventId: eid,
            rail,
            invoiceNonce: material.invoiceNonce,
            commitment: commitmentBytes,
          })
        },
        requestInvoice: (body) => requestInvoice(body),
      })
      const okInv = result.issued.filter((x) => x.invoice && invoiceDestOk(rail, x.invoice))
      for (const row of okInv) {
        const inv = row.invoice!
        const commitment = row.rec.commitmentHex
        if (inv.memo !== memoOf(Uint8Array.from(commitment.match(/../g)!.map((x) => parseInt(x, 16))))) {
          setMsg('The lab invoice memo does not match this ticket’s commitment.')
          return
        }
      }
      if (!okInv.length) {
        setMsg(result.issued.find((x) => x.error)?.error || 'The lab invoice did not issue.')
        return
      }
      const invoices = okInv.map((x) => x.invoice!) as LabInvoice[]
      const first = okInv[0]
      setQr(first.rec.qr)
      setBatch(invoices)
      setBatchIx(0)
      baselineRef.current = statusMark({ phase: 'waiting' })
      lastPhaseRef.current = 'waiting'
      setPhase('waiting')
      setInvoice(invoices[0])
      setPaid(invoices[0].status === 'paid')
      if (invoices[0].status === 'paid') {
        lastPhaseRef.current = 'Settled'
        setPhase('Settled')
      }
      const more = invoices.length > 1 ? ` · ${invoices.length} tickets, one payment each` : ''
      setMsg(
        rail === 'zec'
          ? 'Quoted a lab ZIP-321 request. A URI on screen is not paid. Open it in Zafu, or scan the QR. Do not send real funds.' + more
          : 'Quoted a lab Penumbra destination and memo. A destination on screen is not paid. Do not send real funds.' + more,
      )
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Checkout failed.')
    } finally {
      setBusy(false)
    }
  }

  const onPoll = async () => {
    if (!invoice) return
    setBusy(true)
    try {
      const r = await pollPaid(invoice.commitment)
      const nowPaid = applyStatus(r)
      if (nowPaid && invoice) {
        const step = settleCurrent(invoice)
        if (step === 'done') setMsg('Payment has been confirmed.')
      } else if (ticketStepOf(ownPhase(statusFromPaid(r), baselineRef.current)) === 'mempool')
        setMsg('Payment is in the mempool. It is not on the guest list until it confirms.')
      else setMsg('Not paid yet. A URI or destination on screen is not payment.')
    } finally {
      setBusy(false)
    }
  }

  const onPenumbra = async () => {
    const r = await connectPenumbra()
    setMsg(r.note)
  }

  if (!live) {
    return (
      <div className="panel ticket-panel checkout-panel">
        <div className="admin-badges">
          <span className="admin-badge">{price} · 50% off list</span>
          <span className="admin-badge">Checkout opens soon</span>
        </div>
      </div>
    )
  }

  return (
    <div className="panel ticket-panel checkout-panel">
      <h3 className="panel-heading">{rail === 'zec' ? 'Shielded ZEC' : 'Shielded Penumbra'} · {price}{batch.length > 1 ? ` · ${Math.min(batchIx + 1, batch.length)} of ${batch.length}` : count > 1 && !invoice ? ` · ${count}` : ''}</h3>
      {!invoice ? (
        <button className="pix-btn" type="button" disabled={busy} onClick={start}>
          {busy ? 'Working…' : rail === 'zec' ? 'Make a ZEC request for Zafu' : 'Make a Penumbra request'}
        </button>
      ) : (
        <>
          {invoice ? <PayStatus step={step} /> : null}
          {!paid && rail === 'zec' && invoice.uri ? (
            <div className="pay-qr-block">
              <TicketQr value={invoice.uri} label="ZIP-321 payment request" />
              <PayDetails uri={invoice.uri} memo={invoice.memo} />
              <a className="pix-btn" href={invoice.uri}>
                Open in Zafu
              </a>
            </div>
          ) : !paid ? (
            <div className="pay-qr-block">
              <PayDetails dest={invoice.dest} memo={invoice.memo} />
              <button className="pix-btn" type="button" onClick={onPenumbra}>
                Connect a Penumbra provider
              </button>
            </div>
          ) : null}
          {paid ? (
            <p className="honest ok">
              Payment is on the guest list. <Link href="/ticket">Open your tickets</Link>.
            </p>
          ) : (
            <div className="cta-row">
              <button className="pix-btn" type="button" disabled={busy} onClick={onPoll}>
                Check for payment
              </button>
            </div>
          )}
        </>
      )}
      {qr && paid ? (
        <p className="honest">
          <Link href="/ticket">Open your tickets</Link>
        </p>
      ) : null}
      {paid ? (
        <div className="cta-row">
          <button
            className="pix-btn ghost"
            type="button"
            disabled={busy}
            onClick={() => {
              setInvoice(null)
              setBatch([])
              setBatchIx(0)
              setPaid(false)
              setQr('')
              setPhase('waiting')
              lastPhaseRef.current = 'waiting'
              baselineRef.current = null
              setMsg('Start a separate payment for another ticket. Each ticket has its own seed, nonce, and commitment.')
            }}
          >
            Buy another ticket
          </button>
        </div>
      ) : null}
      {msg ? <p className="msg">{msg}</p> : null}
      {eventName ? <p className="muted">{eventName}</p> : null}
    </div>
  )
}

