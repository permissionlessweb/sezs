import { CalendarEventsPanel } from '../../Calendar/CalendarEventsPanel'

export type EventCalendarStripProps = {
  chainId: string
  calendarContract?: string
  meshJson?: string
  daoAddress?: string
  onSelectEvent?: (eventId: string) => void
  selectedEventId?: string | null
}

/**
 * Zone A — thin wrapper around CalendarEventsPanel for Event Hub.
 * Selection remains parent-owned (eventId state in Renderer).
 */
export const EventCalendarStrip = ({
  chainId,
  calendarContract,
  meshJson,
  daoAddress,
  onSelectEvent,
  selectedEventId,
}: EventCalendarStripProps) => (
  // Quiet support for Event Hub: no extra card shade — panel owns empty/list chrome.
  <div className="flex flex-col gap-0">
    <CalendarEventsPanel
      // Event Hub product surface: prefer chain plane (empty query = chain-only).
      accessPlane="chain"
      calendarContract={calendarContract}
      chainId={chainId}
      compact
      daoAddress={daoAddress}
      limit={10}
      meshJson={meshJson}
      onSelectEvent={onSelectEvent}
      selectedEventId={selectedEventId}
    />
  </div>
)
