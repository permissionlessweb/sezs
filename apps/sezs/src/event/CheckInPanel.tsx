import Link from 'next/link'

import { useAuth } from '../auth/AuthContext'
import { UsherDoor } from './UsherDoor'

/** Guest ticket reminder plus, when the signed-in account is an usher, the door. */
export const CheckInPanel = ({ usher = false }: { usher?: boolean }) => {
  const { session, unlock, error } = useAuth()

  return (
    <div className="grid door-grid checkin-mobile">
      <div className="card">
        <strong>Your ticket</strong>
        <p>
          If this device already has a ticket, it is ready below. You can also unlock one with a passkey or scan a
          ticket QR. Sign-in is not a ticket.{' '}
          <Link href="/ticket">Open the ticket page</Link>
        </p>
        {session ? (
          <button className="btn" type="button" onClick={() => unlock()}>
            Unlock passkey
          </button>
        ) : null}
        {error ? <p className="honest">{error}</p> : null}
      </div>
      {usher ? <UsherDoor /> : null}
    </div>
  )
}
