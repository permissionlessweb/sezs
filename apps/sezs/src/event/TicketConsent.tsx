import { useEffect, useState } from 'react'

import { TicketQr, readTickets, toHex, nullifierOf, fromHex, EVENT_ID } from '../ticket'
import {
  parseChallengeUri,
  signChallenge,
  signPrintAuth,
  encodeApproveUri,
  encodeAdmitUri,
  normalizeOrigin,
} from '../ticket/auth.mjs'
import { FIXTURE } from './fixture'
import { eventOrigin } from './api'

type Rec = {
  eventId: string
  sku: string
  secretHex: string
  commitmentHex: string
}

const domainOf = () => eventOrigin(FIXTURE.event)

export const TicketConsent = () => {
  const [tickets, setTickets] = useState<Rec[]>([])
  const [challengeText, setChallengeText] = useState('')
  const [choice, setChoice] = useState('')
  const [note, setNote] = useState(
    'Approve a live door challenge here. A printed authorization is for when you will not have this page at the door. The ticket secret never leaves this device.',
  )
  const [approval, setApproval] = useState('')
  const [prints, setPrints] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setTickets(readTickets() as Rec[])
  }, [])

  useEffect(() => {
    if (!tickets.length) return
    let live = true
    ;(async () => {
      try {
        const res = await fetch('/sezs/door/config', { credentials: 'include' })
        const data = (await res.json()) as { ok?: boolean; domain?: string; doorAuthPubkey?: string; eventId?: string }
        if (!live || !data?.ok || !data.doorAuthPubkey) {
          if (live) setNote((n) => n)
          return
        }
        const domain = normalizeOrigin(data.domain) || domainOf()
        const next: Record<string, string> = {}
        for (const rec of tickets) {
          const signed = await signPrintAuth({
            secret: fromHex(rec.secretHex),
            eventId: rec.eventId || data.eventId || EVENT_ID,
            domain,
            adminPubkey: data.doorAuthPubkey,
            sku: rec.sku,
          })
          next[rec.commitmentHex] = encodeAdmitUri({
            eventId: rec.eventId || EVENT_ID,
            domain,
            sku: rec.sku,
            ticketPubkey: signed.publicHex,
            signature: signed.signatureHex,
            commitment: rec.commitmentHex,
          })
        }
        if (live) setPrints(next)
      } catch {
        /* door config is optional until the lab door is up */
      }
    })()
    return () => {
      live = false
    }
  }, [tickets])

  const approve = async () => {
    const rec = tickets.find((t) => t.commitmentHex === choice) || tickets[0]
    if (!rec) {
      setNote('No ticket is stored in this browser.')
      return
    }
    const parsed = parseChallengeUri(challengeText)
    if (!parsed.ok) {
      setNote('That is not a live door challenge. Ask the door to show a new one.')
      setApproval('')
      return
    }
    setBusy(true)
    try {
      const signed = await signChallenge({
        secret: fromHex(rec.secretHex),
        eventId: parsed.eventId,
        domain: parsed.domain,
        nonce: parsed.nonce,
        usherPubkey: parsed.usherPubkey,
        timestamp: parsed.timestamp,
      })
      const n = toHex(nullifierOf(fromHex(rec.secretHex), rec.eventId || EVENT_ID))
      const uri = encodeApproveUri({
        eventId: parsed.eventId,
        nonce: parsed.nonce,
        ticketPubkey: signed.publicHex,
        signature: signed.signatureHex,
        nullifier: n,
      })
      setApproval(uri)
      setNote(
        `You approved a check-in for ${parsed.eventId} at ${parsed.domain}. Show this approval to the door. It expires with the challenge. The ticket secret stayed on this device.`,
      )
    } catch {
      setApproval('')
      setNote('This page could not sign the challenge.')
    } finally {
      setBusy(false)
    }
  }

  if (!tickets.length) return null

  return (
    <div className="consent-board">
      <div className="consent-live">
        <h3 className="consent-title">Approve a door</h3>
        <p className="honest">
          Paste or scan the challenge from the door. You are authorizing that door, for this event, to admit this
          ticket once. If you do not approve, they cannot accept it.
        </p>
        {tickets.length > 1 ? (
          <label className="honest">
            Ticket
            <select aria-label="Ticket to approve with" value={choice || tickets[0].commitmentHex} onChange={(e) => setChoice(e.target.value)}>
              {tickets.map((t) => (
                <option key={t.commitmentHex} value={t.commitmentHex}>
                  {t.sku} · {t.commitmentHex.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="honest" htmlFor="door-challenge-input">
          Door challenge
        </label>
        <textarea
          id="door-challenge-input"
          aria-label="Door challenge"
          value={challengeText}
          onChange={(e) => setChallengeText(e.target.value)}
          rows={3}
        />
        <button className="pix-btn" type="button" disabled={busy} onClick={() => void approve()}>
          Approve this door check-in
        </button>
        {approval ? (
          <div className="approval-frame">
            <TicketQr value={approval} label="Holder approval" />
            <p className="mono break ticket-payload">{approval}</p>
          </div>
        ) : null}
        <p className="honest">{note}</p>
      </div>
      <div className="consent-print">
        <h3 className="consent-title">Printed authorization</h3>
        <p className="honest">
          This print authorizes any door key listed for this event to admit this ticket once. Anyone who has the
          paper can present it. That is the consent you give when you print. It is still a bearer ticket. The
          secret is not in the print; keep a sealed backup if you need to restore it.
        </p>
        {tickets.map((rec) => {
          const uri = prints[rec.commitmentHex]
          return (
            <div className="print-ticket" key={rec.commitmentHex}>
              <p className="print-kicker">Printed authorization</p>
              {uri ? (
                <>
                  <TicketQr value={uri} label="Printed door authorization" />
                  <p className="mono break ticket-payload">{uri}</p>
                </>
              ) : (
                <p className="honest">The door key is not available yet, so a print cannot be authorized.</p>
              )}
              <p className="mono dim">Commitment {rec.commitmentHex}</p>
              <div className="cta-row no-print">
                <button className="pix-btn" type="button" onClick={() => window.print()}>
                  Print
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
