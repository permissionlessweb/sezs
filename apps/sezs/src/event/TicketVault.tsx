import Link from 'next/link'
import { useEffect, useState } from 'react'

import {
  parseQr,
  readTickets,
  ticketRecord,
  writeStore,
  TicketQr,
  fromHex,
} from '../ticket'
import { decodeInner, encodeInner, innerPayload, publicEnvelope } from '../zafu/envelope.mjs'
import {
  createLabZidProvider,
  detectZafuOrLab,
  labDecryptFrom,
  labEncryptFor,
  labZidPubkey,
  bytesToUtf8,
} from '../zafu/lab-provider.mjs'
import { QrCapture } from '../ble/QrCapture'
import type { InfoFact } from '../ui/InfoPane'

const postEnvelope = async (pub: Record<string, unknown>) => {
  const res = await fetch('/sezs/ticket/envelope', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pub),
  })
  return res.json() as Promise<{ ok: boolean; error?: string; count?: number }>
}

const fetchEnvelopes = async (commitmentOrInvoice: string) => {
  const q = encodeURIComponent(commitmentOrInvoice)
  const res = await fetch('/sezs/ticket/envelope?c=' + q, { credentials: 'include' })
  return res.json() as Promise<{ ok: boolean; envelopes?: Array<any>; error?: string }>
}

export const TRANSFER_FACTS: InfoFact[] = [
  { label: 'Where', value: 'This browser made each ticket secret. You can keep a copy for another device or hand one to a friend with a QR or a passkey-approved open.' },
  { label: 'Door', value: 'The first use at the door is the one that counts.' },
  { label: 'Bring', value: 'To bring a ticket from another device, unlock with your passkey or scan its QR.' },
  { label: 'Transfer', value: 'Transfer does not change the commitment. This is a bearer ticket: the first person to use it at the door wins. A copy may still be on this device. Anyone with the QR can enter once.' },
]

type VaultProps = { focusCommitment?: string | null; intent?: 'full' | 'door' }

export const TicketVault = ({ focusCommitment, intent = 'full' }: VaultProps) => {
  const [tickets, setTickets] = useState(() => [] as ReturnType<typeof readTickets>)
  const [note, setNote] = useState('')
  const [providerKind, setProviderKind] = useState<'zafu' | 'lab' | null>(null)
  const [handle, setHandle] = useState<any>(null)
  const [myPub, setMyPub] = useState('')
  const [friendPub, setFriendPub] = useState('')
  const [lookup, setLookup] = useState('')
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState('')

  const refresh = () => setTickets(readTickets())

  useEffect(() => {
    refresh()
  }, [focusCommitment])

  const attach = async () => {
    setBusy(true)
    setNote('')
    try {
      const found = await detectZafuOrLab({ allowLab: true })
      if (!found) {
        setNote('No Zafu wallet and no lab ZID provider is available in this browser.')
        return
      }
      setProviderKind(found.kind as 'lab' | 'zafu')
      const h = found.kind === 'lab' ? found.handle : found.handle
      if (found.kind === 'lab') {
        setHandle(h)
        const pk = await labZidPubkey(h)
        setMyPub(pk.pubkey)
        setNote('Using the lab ZID provider (not the Zafu extension). Site-scoped keys here are for this origin only. A ticket brought from another device can be opened with a passkey or a QR.')
      } else {
        setNote('A Zafu wallet is present. Approve encryption in the wallet when asked. This page will seal only to your site-scoped ZID.')
        setHandle(h)
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'ZID provider failed.')
    } finally {
      setBusy(false)
    }
  }

  const ensureLab = async () => {
    if (handle) return handle
    const lab = await createLabZidProvider()
    setHandle(lab)
    setProviderKind('lab')
    const pk = await labZidPubkey(lab)
    setMyPub(pk.pubkey)
    return lab
  }

  const sealOne = async (t: (typeof tickets)[0], recipient?: { pubkey: string }) => {
    const h = await ensureLab()
    const me = recipient || (await labZidPubkey(h))
    const secret = fromHex(t.secretHex)
    const inner = encodeInner(
      innerPayload({
        secret,
        eventId: t.eventId,
        sku: t.sku,
        invoiceNonce: t.invoiceNonce,
        invoiceId: t.invoiceId,
        commitmentHex: t.commitmentHex,
      }),
    )
    const box = await labEncryptFor(h, me, inner)
    const pub = publicEnvelope({
      commitment: t.commitmentHex,
      invoiceId: t.invoiceId,
      ciphertext: box.ciphertext,
      ephemeral_pubkey: box.ephemeral_pubkey,
      pq_epoch: box.pq_epoch,
      pq_suite: box.pq_suite,
      origin: typeof location !== 'undefined' ? location.origin : null,
      postQuantum: box.postQuantum,
    })
    const r = await postEnvelope(pub)
    if (!r.ok) throw new Error(r.error || 'The backend refused the envelope.')
    writeStore({ ...t, sealed: { at: Date.now(), postQuantum: box.postQuantum, to: me.pubkey } })
    refresh()
    return box
  }

  const onSeal = async (t: (typeof tickets)[0]) => {
    setBusy(true)
    setNote('')
    try {
      await sealOne(t)
      setNote('Sealed this ticket to your ZID and stored only the ciphertext on the ticket backend. The backend cannot open the box.')
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Seal failed.')
    } finally {
      setBusy(false)
    }
  }

  const onRecover = async (raw?: string) => {
    setBusy(true)
    setNote('')
    setOpened('')
    try {
      const h = await ensureLab()
      const r = await fetchEnvelopes((raw ?? lookup).trim())
      if (!r.ok || !r.envelopes?.length) {
        setNote(r.error === 'bad_commitment' ? 'That is not a commitment or invoice id.' : 'No sealed backup is stored for that ticket.')
        return
      }
      let lastErr = 'Could not open any envelope with this ZID.'
      for (const env of r.envelopes) {
        try {
          const pt = await labDecryptFrom(h, env)
          const inner = decodeInner(pt)
          const secret = fromHex(inner.secretHex)
          const rec = ticketRecord({
            secret,
            sku: inner.sku,
            eventId: inner.eventId,
            invoiceId: inner.invoiceId,
            invoiceNonce: inner.invoiceNonce,
          })
          if (rec.commitmentHex !== inner.commitmentHex) throw new Error('envelope_mismatch')
          writeStore(rec)
          refresh()
          setOpened(rec.commitmentHex)
          setNote('Opened a sealed backup with your approval and restored the ticket QR in this browser. The door still uses the QR. A second admit is refused.')
          return
        } catch (e) {
          lastErr = e instanceof Error ? e.message : lastErr
        }
      }
      setNote(lastErr)
    } finally {
      setBusy(false)
    }
  }

  const onTransfer = async (t: (typeof tickets)[0]) => {
    setBusy(true)
    setNote('')
    try {
      const pub = friendPub.trim().toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(pub)) {
        setNote('A friend’s site-scoped ZID pubkey is 64 hex characters. Ask them to copy it from this page after they sign in with ZID, or hand them the QR out of band.')
        return
      }
      await sealOne(t, { pubkey: pub })
      setNote(
        'Re-sealed this ticket to the friend’s ZID and stored a new ciphertext. Transfer does not change the commitment. This is a bearer ticket: the first person to use it at the door wins. A copy may still be on this device. Anyone with the QR can enter once.',
      )
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Transfer failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel ticket-panel vault-panel">
      <h3 className="panel-heading">{intent === 'door' ? 'Tickets on this device' : 'Tickets and transfers'}</h3>
      <div className="cta-row">
        <button className="pix-btn" type="button" disabled={busy} onClick={() => void attach()}>
          {providerKind === 'zafu' ? 'Zafu ready' : providerKind === 'lab' ? 'Passkey ready' : 'Unlock with a passkey'}
        </button>
      </div>
      <QrCapture
        label="Scan a ticket QR"
        onRead={(value) => {
          const parsed = parseQr(value)
          if (parsed && 'ok' in parsed && parsed.ok) {
            setNote('A ticket QR was read. Open it from the list or the ticket page.')
            return
          }
          setLookup(value)
          void onRecover(value)
        }}
      />
      {myPub && intent !== 'door' ? (
        <p className="mono dim break">Your lab ZID pubkey {myPub}</p>
      ) : null}

      {tickets.length ? (
        <ul className="ticket-list">
          {tickets.map((t) => (
            <li key={t.commitmentHex} className={t.commitmentHex === focusCommitment || t.commitmentHex === opened ? 'is-on' : ''}>
              <p className="mono dim">{t.sku} · {t.rail || 'rail unset'}</p>
              {t.sealed ? <p className="honest ok">This ticket can be opened again with your passkey.</p> : null}
              <div className="cta-row">
                {intent !== 'door' ? (
                  <button className="pix-btn" type="button" disabled={busy} onClick={() => void onSeal(t)}>
                    Keep a copy for this device
                  </button>
                ) : null}
                <Link className="pix-btn ghost" href="/ticket">
                  Open QR
                </Link>
              </div>
              {intent !== 'door' ? (
                <>
                  <label className="fine">
                    Send a copy to a friend’s ZID
                    <input
                      className="field"
                      spellCheck={false}
                      value={friendPub}
                      onChange={(e) => setFriendPub(e.target.value)}
                      aria-label="Friend ZID pubkey"
                    />
                  </label>
                  <button className="pix-btn ghost" type="button" disabled={busy} onClick={() => void onTransfer(t)}>
                    Send copy
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No ticket is stored in this browser yet.</p>
      )}

      {opened && parseQr(readTickets().find((t) => t.commitmentHex === opened)?.qr || '')?.ok ? (
        <div className="print-ticket">
          <TicketQr value={readTickets().find((t) => t.commitmentHex === opened)!.qr} label="Door ticket" />
        </div>
      ) : null}
      {note ? <p className="msg">{note}</p> : null}
    </div>
  )
}
