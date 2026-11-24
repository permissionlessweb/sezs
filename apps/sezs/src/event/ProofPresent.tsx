import { useEffect, useMemo, useState } from 'react'

import { TicketQr } from '../ticket'
import {
  animatedUrTransport,
  checkInTransports,
  nfcTransport,
  printedRaptorqTransport,
  ProofBundle,
  ProofTransport,
} from '../ticket/transport'

type Props = {
  bundle: ProofBundle | null
  /** Prefer print grid for paper tickets. */
  preferPrint?: boolean
  progress?: string
}

export const ProofPresent = ({ bundle, preferPrint, progress }: Props) => {
  const [id, setId] = useState(preferPrint ? 'printed-raptorq' : 'animated-ur')
  const [frame, setFrame] = useState(0)
  const transport = useMemo(
    () => checkInTransports.find((t) => t.id === id) || animatedUrTransport,
    [id]
  )
  const [frames, setFrames] = useState<{ payload: string; index: number; total: number }[]>([])
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let live = true
    setErr('')
    setFrames([])
    if (!bundle) return
    if (!transport.implemented) {
      setNote('NFC is reserved. Use the moving code or the printed grid.')
      return
    }
    transport
      .present(bundle)
      .then((h) => {
        if (!live) return
        setFrames(h.frames)
        setNote(h.note)
        setFrame(0)
      })
      .catch((e: unknown) => {
        if (!live) return
        setErr(e instanceof Error ? e.message : 'The proof could not be framed.')
      })
    return () => {
      live = false
    }
  }, [bundle, transport])

  useEffect(() => {
    if (transport.id !== 'animated-ur' || frames.length < 2) return
    const t = setInterval(() => setFrame((i) => (i + 1) % frames.length), 400)
    return () => clearInterval(t)
  }, [transport.id, frames.length])

  const shown = transport.id === 'animated-ur' ? frames.slice(frame, frame + 1) : frames
  const grid = transport.id === 'printed-raptorq'

  return (
    <section className="proof-present" data-transport={id} data-frames={frames.length}>
      {progress ? <p className="proof-present-progress">{progress}</p> : null}
      <div className="proof-present-tabs" role="tablist">
        {([animatedUrTransport, printedRaptorqTransport, nfcTransport] as ProofTransport[]).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={id === t.id}
            className={id === t.id ? 'pix-btn' : 'pix-btn ghost'}
            onClick={() => setId(t.id)}
            disabled={!t.implemented && t.id === 'nfc'}
          >
            {t.label}
          </button>
        ))}
      </div>
      {err ? <p className="proof-present-err">{err}</p> : null}
      {note ? <p className="proof-present-note">{note}</p> : null}
      {!bundle ? <p>The ticket proof is not in this browser yet.</p> : null}
      {grid ? (
        <ol className="proof-grid">
          {shown.map((f) => (
            <li key={f.index}>
              <span className="proof-grid-n">
                {f.index}/{f.total}
              </span>
              <TicketQr value={f.payload} label={`Print code ${f.index} of ${f.total}`} />
            </li>
          ))}
        </ol>
      ) : shown[0] ? (
        <div className="proof-live">
          <span className="proof-grid-n">
            {shown[0].index}/{shown[0].total}
          </span>
          <TicketQr value={shown[0].payload} label="Live door proof" />
        </div>
      ) : null}
    </section>
  )
}
