import { useTranslation } from 'react-i18next'

import { SegmentedControls } from '@dao-dao/stateless'

import {
  EVENT_HUB_SURFACE_TABS,
  EventHubSurfaceTab,
} from '../constants'

export type EventSurfaceTabsProps = {
  selected: EventHubSurfaceTab
  onSelect: (tab: EventHubSurfaceTab) => void
  /** When false, Ops tab is hidden (non-members). */
  showOps: boolean
}

export const EventSurfaceTabs = ({
  selected,
  onSelect,
  showOps,
}: EventSurfaceTabsProps) => {
  const { t } = useTranslation()

  const tabs = EVENT_HUB_SURFACE_TABS.filter(
    (tab) => tab.id !== 'ops' || showOps
  ).map((tab) => ({
    label: t(`title.eventHubTab.${tab.id}`, { defaultValue: tab.label }),
    value: tab.id,
  }))

  // If Ops was selected but is now hidden, parent should reset — still guard.
  const safeSelected =
    selected === 'ops' && !showOps ? 'work' : selected

  return (
    <SegmentedControls
      onSelect={(value) => onSelect(value)}
      selected={safeSelected}
      tabs={tabs}
    />
  )
}
