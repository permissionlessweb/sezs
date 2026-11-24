import { useEffect, useRef, useState } from 'react'

import { TicketQr } from '../ticket'

const HIDE_MS = 20_000
const HOLD_MS = 400

type Props = { value: string; label?: string }

/** Ticket QR is treated like a seed phrase: not in the DOM until revealed. */
export const RevealTicketQr = ({ value, label = 'Ticket' }: Props) => {
  const [on, setOn] = useState(false)
  const hideAt = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdAt = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (hideAt.current) clearTimeout(hideAt.current)
    hideAt.current = null
  }

  const hide = () => {
    clearTimer()
    setOn(false)
  }

  const show = () => {
    setOn(true)
    clearTimer()
    hideAt.current = setTimeout(hide, HIDE_MS)
  }

  useEffect(() => () => {
    clearTimer()
    if (holdAt.current) clearTimeout(holdAt.current)
  }, [])

  useEffect(() => {
    if (!on) return
    const onVis = () => {
      if (document.visibilityState !== 'visible') hide()
    }
    const onBlur = () => hide()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', onBlur)
    }
  }, [on])

  const onPointerDown = () => {
    if (holdAt.current) clearTimeout(holdAt.current)
    holdAt.current = setTimeout(() => {
      holdAt.current = null
      show()
    }, HOLD_MS)
  }

  const onPointerUp = () => {
    if (holdAt.current) {
      clearTimeout(holdAt.current)
      holdAt.current = null
    }
  }

  return (
    <div className="ticket-reveal">
      {on && value ? (
        <div className="ticket-reveal-qr">
          <TicketQr value={value} label={label} />
          <button type="button" className="pix-btn ghost" onClick={hide}>
            Hide
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="pix-btn ticket-reveal-btn"
          aria-pressed={false}
          onClick={show}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          Reveal ticket
        </button>
      )}
    </div>
  )
}
