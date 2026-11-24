import { useEffect, useState } from 'react'

import { doorView } from './door'
import { smartQueryUrl } from './listEvents'

/**
 * Reads terp.cw_ave only when both public env names are set.
 * Does not call check_in_guest. Does not print the LCD URL.
 * Unpublished / missing pointers stay in the console, not on the page.
 */
export const DoorPointer = () => {
  const lcdSet = Boolean(process.env.NEXT_PUBLIC_SEZS_LCD)
  const calendarSet = Boolean(process.env.NEXT_PUBLIC_SEZS_CALENDAR)
  const [cwAve, setCwAve] = useState<string | null>(null)
  const [asked, setAsked] = useState(false)

  useEffect(() => {
    if (!lcdSet || !calendarSet) return
    const lcd = process.env.NEXT_PUBLIC_SEZS_LCD || ''
    const cal = process.env.NEXT_PUBLIC_SEZS_CALENDAR || ''
    const url = smartQueryUrl(lcd, cal, {
      list_events: { start_after: null, limit: 1 },
    })
    if (!url) return
    let cancel = false
    fetch(url, { redirect: 'manual' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancel || !body) return
        const raw = JSON.stringify(body)
        const m = raw.match(/"cw_ave"\s*:\s*"(terp1[0-9a-z]+)"/)
        setCwAve(m ? m[1] : '')
        setAsked(true)
      })
      .catch(() => {
        if (!cancel) setAsked(true)
      })
    return () => {
      cancel = true
    }
  }, [lcdSet, calendarSet])

  const view = doorView({
    lcdSet,
    calendarSet,
    cwAve: asked ? cwAve : null,
  })

  useEffect(() => {
    const line = view.cwAve ? `${view.text} ${view.cwAve}` : view.text
    if (view.cwAve) console.info('SEZS door:', line)
    else console.warn('SEZS door:', line)
  }, [view.text, view.cwAve])

  return null
}
