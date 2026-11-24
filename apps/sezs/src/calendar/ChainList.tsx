import { useEffect, useState } from 'react'

import { ChainEvent, fetchContractEvents, lcdAllowed } from './listEvents'

/** Contract list only. The posted night table is separate and is not this. */
export const ChainList = () => {
  const lcd = process.env.NEXT_PUBLIC_SEZS_LCD || ''
  const calendar = process.env.NEXT_PUBLIC_SEZS_CALENDAR || ''
  const [rows, setRows] = useState<ChainEvent[] | null>(null)

  useEffect(() => {
    if (!lcd || !calendar || !lcdAllowed(lcd)) return
    let cancel = false
    fetchContractEvents(lcd, calendar)
      .then((list) => {
        if (!cancel) setRows(list)
      })
      .catch(() => {
        if (!cancel) setRows([])
      })
    return () => {
      cancel = true
    }
  }, [lcd, calendar])

  if (!lcd || !calendar) {
    return <span className="admin-badge">Offline</span>
  }
  if (rows === null) {
    return <span className="admin-badge">Checking</span>
  }
  if (!rows.length) {
    return <span className="admin-badge">None</span>
  }
  return (
    <ul data-source="contract">
      {rows.map((r) => (
        <li key={r.title + r.start}>
          <span>{r.start}</span> {r.title}
        </li>
      ))}
    </ul>
  )
}
