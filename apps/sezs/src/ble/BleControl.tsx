import { useRouter } from 'next/router'

import { useBle } from './BleContext'

const CREW = ['/door', '/usher', '/check-in', '/checkin', '/admin', '/desk']

/** Header control that opens the usher-phone modal. */
export const BleControl = () => {
  const { openBle, devices } = useBle()
  const { pathname } = useRouter()
  const crew = CREW.some((p) => pathname === p || pathname.startsWith(p + '/'))
  const n = devices.filter((d) => d.status !== 'revoked').length
  const label = n ? `Phones · ${n}` : 'Phones'
  return (
    <button
      type="button"
      className={'rail-wallet ble-rail' + (crew ? ' is-crew' : '')}
      onClick={() => openBle()}
      aria-haspopup="dialog"
      aria-label="Manage usher phones"
    >
      {label}
    </button>
  )
}
