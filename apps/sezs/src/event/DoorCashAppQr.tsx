/**
 * Door and admin only. cashapp-qr.png is user-supplied.
 * The app does not ship an image and does not invent one.
 */
import { useEffect, useState } from 'react'

export const DoorCashAppQr = () => {
  const [src, setSrc] = useState<string | null | 'loading'>('loading')

  useEffect(() => {
    let cancelled = false
    fetch('/cashapp-qr.png', { method: 'HEAD', cache: 'no-store' })
      .then((r) => {
        if (!cancelled) setSrc(r.ok ? '/cashapp-qr.png' : null)
      })
      .catch(() => {
        if (!cancelled) setSrc(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (src === 'loading') {
    return (
      <div className="door-cashapp-qr" data-cash-qr="loading">
        <span className="admin-badge">Checking</span>
      </div>
    )
  }
  if (!src) {
    return (
      <div className="door-cashapp-qr" data-cash-qr="missing">
        <span className="admin-badge">No QR</span>
      </div>
    )
  }
  return (
    <div className="door-cashapp-qr" data-cash-qr="present">
      <img className="door-qr-img" src={src} alt="Cash App" />
    </div>
  )
}
