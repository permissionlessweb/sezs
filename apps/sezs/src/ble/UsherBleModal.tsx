import { useEffect } from 'react'

import { useBle } from './BleContext'
import { UsherBlePanel } from './UsherBlePanel'

/** Device-management dialog, following the sign-in modal pattern. */
export const UsherBleModal = () => {
  const { open, closeBle } = useBle()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeBle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeBle])

  if (!open) return null

  return (
    <div className="wallet-scrim" role="presentation" onClick={() => closeBle()}>
      <div
        className="wallet-modal ble-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ble-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wallet-modal-bar">
          <h2 id="ble-modal-title">Usher phones</h2>
          <button type="button" className="pix-link" onClick={() => closeBle()}>
            close
          </button>
        </div>
        <div className="wallet-modal-body">
          <UsherBlePanel />
        </div>
      </div>
    </div>
  )
}
