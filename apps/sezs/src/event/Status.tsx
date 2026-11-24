import { ReactNode } from 'react'
import { EventState } from './useEvent'

export const EventGate = ({
  ev,
  children,
}: {
  ev: EventState
  children: (data: NonNullable<EventState['data']>) => ReactNode
}) => {
  if (ev.loading) return <p className="honest">Loading the event record…</p>
  if (!ev.data) {
    return <p className="honest">{ev.note || 'No event contract is configured, so there is nothing to show yet.'}</p>
  }
  return (
    <>
      {ev.note ? <p className="fine event-note">{ev.note}</p> : null}
      {children(ev.data)}
    </>
  )
}
