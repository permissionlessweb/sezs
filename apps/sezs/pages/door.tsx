import Link from 'next/link'
import { useEffect, useState } from 'react'

import { DoorCashAppQr } from '../src/event/DoorCashAppQr'
import { doorCheckIn, emptyUsherBook, UsherBook } from '../src/frost/usherBook'
import { Frame } from '../src/ui/Frame'
import { Halo, Movement, Orbit, Ritual } from '../src/ui/primitives'

const Door = () => {
  const [book, setBook] = useState<UsherBook>(emptyUsherBook)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('sezs-usher-book')
      if (!raw) return
      const parsed = JSON.parse(raw) as UsherBook
      if (Array.isArray(parsed.ushers)) setBook(parsed)
    } catch {
      setBook(emptyUsherBook())
    }
  }, [])

  const open = book.ushers.filter((name) => doorCheckIn('usher', name, book))

  return (
    <Frame title="Door · The event" shape="cube" core={[0.5, 0.3]}>
      <Halo kicker="Arrival" title="Door" />
      <Movement n={1} title="Door pay">
        <DoorCashAppQr />
      </Movement>
      <Movement n={2} title="Ushers">
        {open.length ? (
          <Orbit label="Ushers" items={open.map((u) => ({ key: u, title: u }))} />
        ) : (
          <span className="admin-badge">None</span>
        )}
      </Movement>
      <Movement n={3} title="At the door">
        <Ritual
          steps={[
            { title: 'Paid ticket', note: 'A purchased ticket is available for this event.' },
            { title: <Link href="/check-in">Check in</Link>, note: 'Revealed to an usher, it is verified and consumed, so it cannot be reused.' },
            { title: 'Door pay', note: 'Events may accept cash at the door, at a premium.' },
          ]}
        />
      </Movement>
    </Frame>
  )
}

export default Door
