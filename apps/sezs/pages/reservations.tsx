import Link from 'next/link'

import { useAuth } from '../src/auth/AuthContext'
import { Shell } from '../src/ui/Frame'

const Reservations = () => {
  const { session } = useAuth()
  const crew = session?.role === 'usher' || session?.role === 'admin'
  return (
    <Shell title="Reservations · The event">
      <section>
        <div className="wrap">
          <h2 className="section-title">Private calendar</h2>
          <p className="section-sub">
            Holds for sessions on the night. A hold is not attendance. No Cal.com on this
            board.
          </p>
          {!crew ? (
            <p>
              Crew only. <Link href="/tickets">Sign in</Link> with an usher or admin passkey.
            </p>
          ) : (
            <div className="panel">
              <p className="muted">
                Holds (hydro / needle / IV / bodywork / ink) land here after the crew board is
                ported. Unique kind+start. Not a Cal.com booking.
              </p>
            </div>
          )}
        </div>
      </section>
    </Shell>
  )
}

export default Reservations
