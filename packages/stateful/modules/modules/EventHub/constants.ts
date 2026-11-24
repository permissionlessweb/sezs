/**
 * Event Hub constants.
 * Design: docs/research/dao-event-ui-orch/STATUS-U0.md
 */

/** Minimum height for work/collab/ops iframe slots. */
export const EVENT_HUB_SLOT_MIN_HEIGHT = 480

/** Alias used by some slot stubs. */
export const EVENTHUB_IFRAME_MIN_HEIGHT = EVENT_HUB_SLOT_MIN_HEIGHT

/** Minimum height for calendar strip. */
export const EVENT_HUB_CALENDAR_MIN_HEIGHT = 200

/** Surface tab ids for Work | Collab | Ops. */
export type EventHubSurfaceTab = 'work' | 'collab' | 'ops'

export const EVENT_HUB_SURFACE_TABS: {
  id: EventHubSurfaceTab
  label: string
}[] = [
  { id: 'work', label: 'Work' },
  { id: 'collab', label: 'Collab' },
  { id: 'ops', label: 'Ops' },
]

/** postMessage protocol version for Event Hub shell (future). */
export const EVENTHUB_PROTOCOL_VERSION = 'terp-eventhub/v1' as const
