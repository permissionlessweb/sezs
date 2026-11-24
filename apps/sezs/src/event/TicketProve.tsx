import { useEffect, useState } from 'react'

import { fetchLeaves } from '../pay/invoice'
import { readTickets, writeStore, fromHex, toHex } from '../ticket'
import { createProver, loadTicketV2 } from '../ticket/v2/index.mjs'
import { doorAuthPubkeyString } from '../ticket/v2/door-auth.mjs'
import type { ProofBundle } from '../ticket/transport'
import { ProofPresent } from './ProofPresent'
import { eventOrigin } from './api'
import { useEvent } from './useEvent'

const b64 = (u: Uint8Array) => {
  let s = ''
  u.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

type Rec = {
  eventId: string
  sku: string
  secretHex: string
  commitmentHex: string
  invoiceNonce?: string | null
  invoiceId?: string | null
  alphaNonce?: string | null
  bundleB64?: string | null
  printedSigB64?: string | null
}

export const TicketProve = () => {
  const ev = useEvent()
  const [tickets, setTickets] = useState<Rec[]>([])
  const [ix, setIx] = useState(0)
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState('')
  const [bundle, setBundle] = useState<ProofBundle | null>(null)
  const [payload, setPayload] = useState('')
  const [challengeHex, setChallengeHex] = useState('')
  const [busy, setBusy] = useState(false)

  const domain = eventOrigin(ev.data?.event)
  const doorAuth = ev.data?.event.doorAuthPubkey || ev.data?.consume?.doorAuthPubkey || ''
  const ticket = tickets[ix] || tickets[0]

  const refresh = () => setTickets(readTickets() as Rec[])
  useEffect(() => {
    refresh()
  }, [])

  const fieldsOf = async (circuit: Uint8Array, consent: ProofBundle['consent']): Promise<ProofBundle> => {
    const t = await loadTicketV2()
    const f = t.consumeFields(circuit)
    return {
      v: 2,
      proof: circuit,
      root: fromHex(f.root),
      nullifier: fromHex(f.nullifier),
      eventId: t.eventIdFp(ticket.eventId),
      domain: t.domainFp(domain),
      rkX: fromHex(f.rk_x),
      rkY: fromHex(f.rk_y),
      consent,
    }
  }

  const prove = async () => {
    if (!ticket) return
    setBusy(true)
    setErr('')
    setProgress('Loading the guest list and warming the prover…')
    const prover = createProver()
    try {
      const leaves = await fetchLeaves()
      if (!leaves.ok || !leaves.leaves || !leaves.leaves.length) {
        setErr('No published guest-list leaves yet. Pay first, then wait for a root publish.')
        return
      }
      if (!leaves.published) {
        setProgress('The guest list has unpaid or unpublished leaves. Proving against the current tree; the door will refuse an unpublished root.')
      } else {
        setProgress('Building the door proof in this browser. This takes a few seconds. The secret never leaves this device.')
      }
      const secret = fromHex(ticket.secretHex)
      const p = await prover.prove({
        secret,
        sku: ticket.sku,
        eventId: ticket.eventId,
        domain,
        leaves: leaves.leaves,
      })
      const circuit = p.bundle as Uint8Array
      if (circuit.length !== 4321) {
        setErr(`The proof bundle is ${circuit.length} bytes; it should be 4,321.`)
        return
      }
      const t = await loadTicketV2()
      const N = t.nullifier(secret, ticket.eventId)
      const printedSig = doorAuth
        ? t.signPrinted({
            secret,
            eventId: ticket.eventId,
            domain,
            alphaNonce: p.alphaNonce,
            nullifier: N,
            doorAuthPubkey: doorAuthPubkeyString(doorAuth),
          })
        : null
      const consent: ProofBundle['consent'] = printedSig
        ? { kind: 'printed', payload: printedSig as Uint8Array }
        : { kind: 'printed', payload: new Uint8Array() }
      const pb = await fieldsOf(circuit, consent)
      setBundle(pb)
      writeStore({
        ...ticket,
        alphaNonce: toHex(p.alphaNonce as Uint8Array),
        bundleB64: b64(circuit),
        printedSigB64: printedSig ? b64(printedSig as Uint8Array) : null,
      })
      refresh()
      setPayload(
        printedSig
          ? JSON.stringify({
              kind: 'printed',
              bundle: b64(circuit),
              sig: b64(printedSig as Uint8Array),
            })
          : JSON.stringify({ kind: 'circuit', bundle: b64(circuit) }),
      )
      setProgress(`Proof ready in ${p.ms || 'a few'} ms. Show the moving code, or print the grid.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The proof could not be built.')
      setProgress('')
    } finally {
      prover.terminate()
      setBusy(false)
    }
  }

  const approveLive = async () => {
    if (!ticket?.bundleB64 || !ticket.alphaNonce) {
      setErr('Build the door proof first.')
      return
    }
    const raw = challengeHex.trim().replace(/^sezs-door-v2:/i, '')
    if (!raw) {
      setErr('Paste the live challenge from the usher.')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const t = await loadTicketV2()
      const challenge = fromHex(raw)
      const parsed = t.parseChallenge(challenge) as { eventId?: string; domain?: string; usher?: string }
      const sig = t.signLive({
        secret: fromHex(ticket.secretHex),
        eventId: ticket.eventId,
        domain,
        alphaNonce: fromHex(ticket.alphaNonce),
        challenge,
      })
      const circuit = unb64(ticket.bundleB64)
      const pb = await fieldsOf(circuit, { kind: 'live', payload: new Uint8Array([...challenge, 0, ...(sig as Uint8Array)]) })
      // Store challenge+sig separately in the paste payload for the usher.
      setBundle(pb)
      const body = JSON.stringify({
        kind: 'live',
        bundle: ticket.bundleB64,
        challenge: b64(challenge),
        sig: b64(sig as Uint8Array),
        usher: parsed.usher || '',
      })
      setPayload(body)
      setProgress(`Approved check-in${parsed.usher ? ` by ${parsed.usher}` : ''}. Show the moving code to the usher.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The live approval failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!tickets.length) {
    return (
      <p className="honest">
        No ticket is stored in this browser. Buy on the tickets page first. Signing in is not a ticket.
      </p>
    )
  }

  return (
    <div className="ticket-prove">
      {tickets.length > 1 ? (
        <label>
          Ticket
          <select value={String(ix)} onChange={(e) => setIx(Number(e.target.value))}>
            {tickets.map((t, i) => (
              <option key={t.commitmentHex} value={i}>
                {t.sku} · {t.commitmentHex.slice(0, 8)}…
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button className="pix-btn" type="button" disabled={busy} onClick={() => void prove()} data-prove>
        {ticket?.bundleB64 ? 'Rebuild the door proof' : 'Build the door proof'}
      </button>
      {progress ? <p className="honest proof-present-progress">{progress}</p> : null}
      {err ? <p className="honest proof-present-err">{err}</p> : null}
      <ProofPresent bundle={bundle} progress="" />
      <div className="ticket-live-approve">
        <label className="honest" htmlFor="live-challenge">
          Live challenge from the usher
        </label>
        <textarea
          id="live-challenge"
          rows={3}
          value={challengeHex}
          onChange={(e) => setChallengeHex(e.target.value)}
          placeholder="Paste the sezs-door-v2 challenge."
        />
        <button className="pix-btn" type="button" disabled={busy} onClick={() => void approveLive()} data-approve-live>
          Approve this check-in
        </button>
      </div>
      {payload ? (
        <label className="honest">
          Give this to the usher
          <textarea readOnly rows={4} value={payload} data-usher-payload />
        </label>
      ) : null}
    </div>
  )
}
