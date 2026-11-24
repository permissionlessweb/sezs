import { useEffect, useState } from 'react'

import { useAuth } from '../src/auth/AuthContext'
import { fetchSessionRole, hasInboxBackend } from '../src/auth/session'
import { CheckInPanel } from '../src/event/CheckInPanel'
import { TicketVault } from '../src/event/TicketVault'
import { isSignedInUsher } from '../src/event/roles-gate'
import { useEvent } from '../src/event/useEvent'
import { eventNameOf } from '../src/event/title'
import { Frame } from '../src/ui/Frame'
import { Halo, Movement } from '../src/ui/primitives'

const CheckIn = () => {
  const ev = useEvent()
  const { session } = useAuth()
  const [splashUsher, setSplashUsher] = useState(false)
  useEffect(() => {
    if (!hasInboxBackend()) return
    let live = true
    fetchSessionRole()
      .then((d) => {
        if (live && d?.ok && d.role === 'usher') setSplashUsher(true)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const usher = isSignedInUsher(session, ev.data, { splashUsher })
  const name = eventNameOf(ev.data?.event.name)
  return (
    <Frame title={`Check-in · ${name}`} shape="cube" core={[0.5, 0.3]}>
      <Halo title="Check-in" />
      <Movement title="Your ticket" align="left">
        <div className="checkin-mobile">
          <CheckInPanel usher={usher} />
          <TicketVault intent="door" />
        </div>
      </Movement>
    </Frame>
  )
}

export default CheckIn
