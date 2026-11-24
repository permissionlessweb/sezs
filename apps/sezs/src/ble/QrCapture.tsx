import { useEffect, useRef, useState } from 'react'

import { cameraAvailable, detectQr } from '../ui/scanQr'

/** Webcam or image-file QR capture. Returns the raw payload only. */
export const QrCapture = ({ onRead, label = 'Scan' }: { onRead: (value: string) => void; label?: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [live, setLive] = useState(false)
  const [err, setErr] = useState('')
  const timer = useRef<number | null>(null)

  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    const el = videoRef.current
    const stream = el?.srcObject as MediaStream | null
    stream?.getTracks().forEach((t) => t.stop())
    if (el) el.srcObject = null
    setLive(false)
  }

  const tick = async () => {
    const el = videoRef.current
    if (!el) return
    try {
      const value = await detectQr(el)
      if (value) {
        stop()
        onRead(value)
        return
      }
    } catch {
      /* keep scanning */
    }
    timer.current = window.setTimeout(() => void tick(), 240)
  }

  const start = async () => {
    setErr('')
    if (!cameraAvailable()) {
      setErr('Camera needs a live view in this browser. Use a photo, or paste the payload.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setLive(true)
      void tick()
    } catch {
      setErr('The camera could not be opened. Use a photo instead.')
    }
  }

  useEffect(() => () => stop(), [])

  return (
    <div className="ble-scan" data-qr-scanner="">
      <div className="cta-row">
        <button type="button" className="pix-btn" onClick={() => (live ? stop() : void start())}>
          {live ? 'Stop' : label}
        </button>
        <label className="pix-btn ghost scan-label">
          Photo
          <input
            type="file"
            accept="image/*"
            hidden
            aria-label="Read a QR photo"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              void detectQr(f).then((v) => (v ? onRead(v) : setErr('The QR could not be read.')))
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <video ref={videoRef} className={'ble-scan-cam' + (live ? ' is-on' : '')} playsInline muted />
      {err ? <p className="door-note is-no">{err}</p> : null}
    </div>
  )
}
