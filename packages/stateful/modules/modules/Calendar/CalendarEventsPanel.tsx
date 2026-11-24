import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SmallLoader } from '@dao-dao/stateless'
import {
  createMeshQueryClient,
  getChainMeshServices,
  getCosmWasmClientForChainId,
  resolveMesh,
  subscribeNostr,
  type MeshCalendarAccessPlane,
  type NostrEvent,
} from '@dao-dao/utils'

import { CalendarEventDetail } from './CalendarEventDetail'
import { CalendarMonthGrid } from './CalendarMonthGrid'
import type { CalendarPanelEvent } from './calendarGrid'
import {
  buildCalendarNostrFilters,
  mergeCalendarEvents,
  nostrEventToCalendarPanel,
} from './calendarNostr'

/**
 * Event list / grid for Calendar / Event Hub.
 *
 * Planes (mesh.v1, compatible with dao-calendar + Nostr calendar NIPs):
 * - **chain** (default when query empty): LCD → CW721 tokens on dao-calendar
 * - **public**: optional HTTP listEvents index
 * - **private**: members-only HTTP index (host auth; FE does not invent gates)
 *
 * Empty schedule is a normal state — not a red error.
 *
 * Views (CAL-UX-1/3): default **grid** (month/week); optional **list** (UTC ranges).
 * Compact (Event Hub strip) stays list-only.
 */
export type CalendarViewMode = 'grid' | 'list'

const VIEW_STORAGE_KEY = 'dao-dao.calendar.viewMode'

export type CalendarEventsPanelProps = {
  chainId: string
  calendarContract?: string
  meshJson?: string
  /** Optional DAO core address for storage mesh.v1 (when loader available) */
  daoAddress?: string
  limit?: number
  /**
   * Force access plane. Default: mesh.calendarAccess or chain if no query base.
   */
  accessPlane?: MeshCalendarAccessPlane
  /**
   * When set, event rows/chips are activatable and call back with String(id).
   * Omitted → selection still works when showDetail is true.
   */
  onSelectEvent?: (eventId: string) => void
  /** Optional selected event id for active row/chip styling. */
  selectedEventId?: string | null
  /**
   * Quiet chrome for Event Hub / nested surfaces: hide source line + plane
   * switcher from first paint (still available under technical details).
   * Compact forces schedule **list** (strip).
   */
  compact?: boolean
  /**
   * Default view when not compact. Grid is product default (CAL-UX-3).
   * sessionStorage may override after first toggle when persistView.
   */
  defaultView?: CalendarViewMode
  /** Persist grid/list preference in sessionStorage. */
  persistView?: boolean
  /** When true (Calendar tab), show detail surface under grid/list. */
  showDetail?: boolean
}

/** @deprecated use CalendarPanelEvent */
export type PanelEvent = CalendarPanelEvent

function flattenEvents(body: unknown): CalendarPanelEvent[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as any).events)
      ? (body as any).events
      : []
  return list.map((raw: any, i: number) => {
    if (raw?.event) {
      return {
        id: raw.id ?? i,
        title: raw.event.title || 'Untitled',
        start: raw.event.start_time,
        end: raw.event.end_time,
        access: raw.access === 'private' ? 'private' : 'public',
        description: raw.event.description || raw.event.body || undefined,
        cid: raw.event.cid || raw.cid || undefined,
      }
    }
    return {
      id: raw?.id ?? i,
      title: raw?.title || 'Untitled',
      start: raw?.start_time ?? raw?.start,
      end: raw?.end_time ?? raw?.end,
      access: raw?.access === 'private' ? 'private' : 'public',
      description: raw?.description || raw?.body || undefined,
      cid: raw?.cid || undefined,
    }
  })
}

async function loadOnChainEvents(
  chainId: string,
  calendarContract: string,
  limit: number
): Promise<CalendarPanelEvent[]> {
  const cw = await getCosmWasmClientForChainId(chainId)
  const { tokens } = await cw.queryContractSmart(calendarContract, {
    all_tokens: { limit },
  })
  const tokenIds: string[] = Array.isArray(tokens) ? tokens : []
  // dao-calendar (CW721 + Nostr d-tags): events often use evt/… or bare d_tag ids
  const events: CalendarPanelEvent[] = []
  for (const tokenId of tokenIds.slice(0, limit)) {
    try {
      const info = await cw.queryContractSmart(calendarContract, {
        nft_info: { token_id: tokenId },
      })
      const ext = info?.extension || {}
      const dTag = ext.d_tag || tokenId
      let start: string | undefined
      let end: string | undefined
      const cidRaw: string | undefined =
        typeof ext.cid === 'string' ? ext.cid : undefined
      let cid: string | undefined = cidRaw
      if (cidRaw && cidRaw.includes('start=')) {
        try {
          const u = new URL(cidRaw.replace(/^lab:/, 'http:'))
          const s = u.searchParams.get('start')
          const e = u.searchParams.get('end')
          if (s) start = new Date(Number(s) * 1000).toISOString()
          if (e) end = new Date(Number(e) * 1000).toISOString()
          // lab: time-encoding is not an IPFS CID for detail body
          cid = undefined
        } catch {
          /* ignore */
        }
      }
      // NIP-style times if present on extension
      if (!start && ext.start_time) start = String(ext.start_time)
      if (!end && ext.end_time) end = String(ext.end_time)
      events.push({
        id: tokenId,
        title: String(dTag).replace(/-/g, ' '),
        start,
        end,
        access:
          ext.private === true || ext.access === 'private'
            ? 'private'
            : 'public',
        description:
          typeof ext.description === 'string'
            ? ext.description
            : typeof ext.body === 'string'
              ? ext.body
              : undefined,
        cid,
      })
    } catch {
      events.push({ id: tokenId, title: tokenId, access: 'public' })
    }
  }
  return events
}

function readStoredView(fallback: CalendarViewMode): CalendarViewMode {
  if (typeof sessionStorage === 'undefined') return fallback
  try {
    const v = sessionStorage.getItem(VIEW_STORAGE_KEY)
    if (v === 'grid' || v === 'list') return v
  } catch {
    /* ignore */
  }
  return fallback
}

export const CalendarEventsPanel = ({
  chainId,
  calendarContract,
  meshJson,
  limit = 20,
  accessPlane: accessPlaneProp,
  onSelectEvent,
  selectedEventId,
  compact = false,
  defaultView = 'grid',
  persistView = true,
  showDetail = false,
}: CalendarEventsPanelProps) => {
  const { t } = useTranslation()
  const [planeOverride, setPlaneOverride] = useState<
    MeshCalendarAccessPlane | null
  >(null)
  const [viewMode, setViewMode] = useState<CalendarViewMode>(() =>
    compact ? 'list' : readStoredView(defaultView)
  )
  const [internalSelected, setInternalSelected] = useState<string | null>(null)
  /** Progressive Nostr calendar events (CAL-NOSTR-4); never blocks chain load. */
  const [nostrLive, setNostrLive] = useState<CalendarPanelEvent[]>([])
  const [nostrStatus, setNostrStatus] = useState<
    'off' | 'connecting' | 'live' | 'error'
  >('off')
  const [nostrErr, setNostrErr] = useState<string | undefined>()

  useEffect(() => {
    if (compact) setViewMode('list')
  }, [compact])

  const effectiveSelected =
    selectedEventId !== undefined && selectedEventId !== null
      ? selectedEventId
      : selectedEventId === null
        ? null
        : internalSelected

  const selectionEnabled =
    typeof onSelectEvent === 'function' || showDetail

  const handleSelect = (id: string) => {
    if (onSelectEvent) onSelectEvent(id)
    if (showDetail && selectedEventId === undefined) {
      setInternalSelected(id)
    }
  }

  const handleCloseDetail = () => {
    if (onSelectEvent) onSelectEvent('')
    if (showDetail && selectedEventId === undefined) {
      setInternalSelected(null)
    }
  }

  const setView = (v: CalendarViewMode) => {
    setViewMode(v)
    if (persistView && !compact && typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(VIEW_STORAGE_KEY, v)
      } catch {
        /* ignore */
      }
    }
  }

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      'calendar-events-panel',
      chainId,
      calendarContract,
      meshJson,
      limit,
      accessPlaneProp,
      planeOverride,
    ],
    queryFn: async () => {
      const services = getChainMeshServices(chainId)
      let mesh: Awaited<ReturnType<typeof resolveMesh>> | undefined
      let meshErr: string | undefined
      let plane: MeshCalendarAccessPlane =
        planeOverride || accessPlaneProp || 'chain'

      try {
        mesh = await resolveMesh({
          chainId,
          chainServices: services,
          overrides: {
            ...(calendarContract ? { calendar: calendarContract } : {}),
          },
          loaders: {
            getModuleValues: async () => ({
              calendarContract,
              meshJson,
            }),
          },
        })
        if (!planeOverride && !accessPlaneProp) {
          plane =
            mesh.calendarAccess || (mesh.query ? 'public' : 'chain')
        }
      } catch (e) {
        meshErr = e instanceof Error ? e.message : String(e)
      }

      const calendar =
        calendarContract || mesh?.calendar || undefined

      const queryBase =
        plane === 'private'
          ? mesh?.queryPlanes?.private || mesh?.query || ''
          : plane === 'public'
            ? mesh?.queryPlanes?.public || mesh?.query || ''
            : ''

      if (plane !== 'chain' && queryBase) {
        try {
          const client = createMeshQueryClient(mesh!, undefined, {
            plane,
          })
          const body = await client.listEvents({ limit })
          const events = flattenEvents(body)
          return {
            events,
            warnings: mesh?.warnings || [],
            source: 'query_plane' as const,
            queryBase,
            plane,
            calendar,
            relays: mesh?.relays || [],
          }
        } catch (e) {
          meshErr = e instanceof Error ? e.message : String(e)
          // Fall through to on-chain — never hard-fail product UX on index lag.
        }
      }

      if (calendar) {
        try {
          const events = await loadOnChainEvents(chainId, calendar, limit)
          const warnings: string[] = []
          if (meshErr && plane !== 'chain') {
            warnings.push(
              'Indexed schedule unavailable — showing on-chain events only.'
            )
          }
          return {
            events,
            warnings,
            debugDetail: [
              ...(mesh?.warnings || []),
              meshErr && plane !== 'chain' ? `index: ${meshErr}` : '',
              events.length === 0 ? 'all_tokens empty (normal until mint)' : '',
            ].filter(Boolean),
            source: 'on_chain' as const,
            queryBase: 'lcd',
            plane: 'chain' as const,
            calendar,
            relays: mesh?.relays || [],
          }
        } catch (chainErr) {
          const chainMsg =
            chainErr instanceof Error ? chainErr.message : String(chainErr)
          return {
            events: [] as CalendarPanelEvent[],
            warnings: [
              'Schedule temporarily unreachable — showing empty list (not a hard failure).',
            ],
            debugDetail: [
              ...(mesh?.warnings || []),
              meshErr ? `index: ${meshErr}` : '',
              `chain: ${chainMsg}`,
            ].filter(Boolean),
            source: 'on_chain' as const,
            queryBase: 'lcd',
            plane: 'chain' as const,
            calendar,
            relays: mesh?.relays || [],
          }
        }
      }

      if (mesh) {
        return {
          events: [] as CalendarPanelEvent[],
          warnings: [
            'No calendar contract configured — schedule stays empty until mesh.v1.calendar is set.',
          ],
          debugDetail: [
            ...(mesh.warnings || []),
            meshErr || '',
            `source=${mesh.source}`,
          ].filter(Boolean),
          source: mesh.source,
          queryBase: mesh.query || '',
          plane,
          calendar: undefined,
          relays: mesh.relays || [],
        }
      }
      throw new Error(meshErr || 'no calendar contract and mesh resolve failed')
    },
    staleTime: 30_000,
    retry: 1,
  })

  // CAL-NOSTR-4: progressive live plane over mesh.relays only (never invent).
  const relayList = data?.relays || []
  const relayKey = relayList.join('|')
  useEffect(() => {
    setNostrLive([])
    setNostrErr(undefined)
    if (!relayList.length || typeof window === 'undefined') {
      setNostrStatus('off')
      return
    }
    setNostrStatus('connecting')
    const byId = new Map<string, CalendarPanelEvent>()
    const sub = subscribeNostr({
      relays: relayList,
      filters: buildCalendarNostrFilters(limit),
      subPrefix: 'cal-nostr',
      maxRelays: 3,
      onEvent: (ev: NostrEvent) => {
        const panel = nostrEventToCalendarPanel(ev)
        if (!panel) return
        byId.set(String(panel.id), panel)
        setNostrLive([...byId.values()])
        setNostrStatus('live')
      },
      onError: (err) => {
        setNostrErr(err.message)
        setNostrStatus((s) => (s === 'live' ? s : 'error'))
      },
      onStatus: (status) => {
        if (status === 'open') {
          setNostrStatus((s) => (s === 'live' ? s : 'connecting'))
        }
      },
    })
    return () => {
      sub.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relayKey encodes relays
  }, [relayKey, limit])

  const displayEvents = useMemo(
    () => mergeCalendarEvents(data?.events || [], nostrLive),
    [data?.events, nostrLive]
  )

  const warningText = useMemo(
    () => data?.warnings?.filter(Boolean).join(' · '),
    [data?.warnings]
  )
  const debugDetail = useMemo(() => {
    const d = (data as { debugDetail?: string[] } | undefined)?.debugDetail
    const parts = [
      ...(d || []),
      relayList.length
        ? `nostr: ${nostrStatus} relays=${relayList.length}${
            nostrErr ? ` err=${nostrErr}` : ''
          } live=${nostrLive.length}`
        : 'nostr: off (no mesh.relays)',
    ]
    return parts.filter(Boolean).join('\n')
  }, [data, relayList, nostrStatus, nostrErr, nostrLive.length])

  const selectedEvent = useMemo(() => {
    if (!effectiveSelected || !displayEvents.length) return null
    return (
      displayEvents.find((e) => String(e.id) === String(effectiveSelected)) ||
      null
    )
  }, [effectiveSelected, displayEvents])

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border-primary px-3 py-6"
      >
        <SmallLoader size={20} />
        <p className="caption-text text-text-tertiary">
          {t('info.loadingCalendarEvents', {
            defaultValue: 'Loading schedule…',
          })}
        </p>
      </div>
    )
  }

  if (isError) {
    const msg = error instanceof Error ? error.message : String(error)
    const isSoft =
      /HTTP 5\d\d|HTTP 404|Failed to fetch|failed to fetch|ECONNREFUSED|query plane|headstash|blossom|on-chain dao-calendar|unset|no calendar/i.test(
        msg
      )
    return (
      <div className="rounded-md border border-dashed border-border-primary px-3 py-6 text-center">
        <p className="primary-text text-text-body text-sm">
          {isSoft
            ? t('info.calendarScheduleUnavailable', {
                defaultValue: 'No scheduled events yet.',
              })
            : t('info.calendarQueryError', {
                defaultValue: 'Could not load calendar events.',
              })}
        </p>
        <p className="secondary-text text-text-secondary mt-1 text-xs">
          {isSoft
            ? t('info.calendarEmptyHint', {
                defaultValue:
                  'When the DAO mints public events on dao-calendar, they appear here. Empty schedule is normal.',
              })
            : t('info.calendarQueryErrorHint', {
                defaultValue:
                  'Try again later. Technical detail is below if you need it.',
              })}
        </p>
        <details className="mt-3 text-left">
          <summary className="caption-text text-text-tertiary cursor-pointer">
            {t('info.technicalDetails', {
              defaultValue: 'Technical details',
            })}
          </summary>
          <p className="caption-text text-text-tertiary mt-1 break-all">
            {msg}
          </p>
          {calendarContract ? (
            <p className="caption-text text-text-tertiary mt-1 font-mono">
              {calendarContract}
            </p>
          ) : null}
        </details>
      </div>
    )
  }

  const activePlane = planeOverride || data?.plane || 'chain'
  const showPlaneSwitcher =
    !compact &&
    (process.env.NODE_ENV !== 'production' ||
      !!planeOverride ||
      !!accessPlaneProp)

  const planeSwitcher = showPlaneSwitcher ? (
    <div className="flex flex-wrap items-center gap-1">
      <span className="caption-text text-text-tertiary mr-1">
        {t('info.calendarAccessPlane', { defaultValue: 'Plane' })}
      </span>
      {(['chain', 'public', 'private'] as MeshCalendarAccessPlane[]).map(
        (p) => {
          const active = activePlane === p
          return (
            <button
              key={p}
              aria-pressed={active}
              className={`rounded-md px-2 py-0.5 text-xs capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-interactive-focus ${
                active
                  ? 'bg-background-interactive-selected text-text-body ring-1 ring-inset ring-border-interactive-focus'
                  : 'text-text-secondary hover:bg-background-interactive-hover'
              }`}
              onClick={() => setPlaneOverride(p)}
              type="button"
            >
              {p}
            </button>
          )
        }
      )}
    </div>
  ) : null

  const viewToggle =
    !compact ? (
      <div className="flex flex-wrap items-center gap-1">
        {(
          [
            ['grid', t('info.calendarViewGrid', { defaultValue: 'Calendar' })],
            [
              'list',
              t('info.calendarViewList', {
                defaultValue: 'Schedule list',
              }),
            ],
          ] as const
        ).map(([v, label]) => {
          const active = viewMode === v
          return (
            <button
              key={v}
              aria-pressed={active}
              className={`rounded-md px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-interactive-focus ${
                active
                  ? 'bg-background-interactive-selected text-text-body ring-1 ring-inset ring-border-interactive-focus'
                  : 'text-text-secondary hover:bg-background-interactive-hover'
              }`}
              onClick={() => setView(v)}
              type="button"
            >
              {label}
            </button>
          )
        })}
      </div>
    ) : null

  const listBody = !displayEvents.length ? (
    <div className="rounded-md border border-dashed border-border-primary px-3 py-8 text-center">
      <p className="primary-text text-text-body text-sm">
        {t('info.noUpcomingEvents', {
          defaultValue: 'No scheduled events yet.',
        })}
      </p>
      <p className="secondary-text text-text-secondary mt-2 text-xs">
        {t('info.calendarEmptyHint', {
          defaultValue:
            'Public events mint as dao-calendar NFTs (DAO is minter). Empty schedule is a normal product state — not an error.',
        })}
      </p>
    </div>
  ) : (
    <ul className="flex flex-col gap-2">
      {displayEvents.map((ev) => {
        const id = String(ev.id)
        const selected =
          effectiveSelected != null &&
          effectiveSelected !== '' &&
          effectiveSelected === id
        const interactive = selectionEnabled
        const body = (
          <>
            <div className="flex items-start justify-between gap-2">
              <p className="primary-text text-text-body text-sm">
                {ev.title}
              </p>
              {ev.access === 'private' ? (
                <span className="caption-text text-text-tertiary shrink-0 rounded-md border border-border-secondary bg-background-tertiary px-1.5 py-0.5">
                  private
                </span>
              ) : null}
            </div>
            {(ev.start || ev.end) && (
              <p className="caption-text text-text-tertiary font-mono">
                {ev.start}
                {ev.end ? ` → ${ev.end}` : ''}
              </p>
            )}
          </>
        )
        return (
          <li key={id}>
            {interactive ? (
              <button
                aria-pressed={selected}
                className={`w-full rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-interactive-focus ${
                  selected
                    ? 'border-border-interactive-focus bg-background-interactive-selected ring-1 ring-inset ring-border-interactive-focus'
                    : 'border-border-primary bg-background-base hover:bg-background-interactive-hover'
                }`}
                onClick={() => handleSelect(id)}
                type="button"
              >
                {body}
              </button>
            ) : (
              <div className="rounded-md border border-border-primary bg-background-base px-3 py-2">
                {body}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="flex flex-col gap-3">
      {!compact ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="caption-text text-text-tertiary">
            {data?.source === 'on_chain'
              ? t('info.calendarSourceChain', {
                  defaultValue: 'On-chain schedule',
                })
              : t('info.calendarSourceIndex', {
                  defaultValue: `Indexed · ${activePlane}`,
                })}
          </p>
          {viewToggle}
        </div>
      ) : null}

      {warningText ? (
        <p className="secondary-text text-text-secondary text-xs">
          {warningText}
        </p>
      ) : null}

      {(debugDetail || planeSwitcher) && (
        <details>
          <summary className="caption-text text-text-tertiary cursor-pointer">
            {t('info.technicalDetails', {
              defaultValue: 'Technical details',
            })}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {planeSwitcher}
            {debugDetail ? (
              <pre className="caption-text text-text-tertiary whitespace-pre-wrap break-all">
                {debugDetail}
              </pre>
            ) : null}
          </div>
        </details>
      )}

      {viewMode === 'grid' && !compact ? (
        <CalendarMonthGrid
          events={displayEvents}
          onSelectEvent={selectionEnabled ? handleSelect : undefined}
          selectedEventId={
            effectiveSelected && effectiveSelected !== ''
              ? effectiveSelected
              : null
          }
        />
      ) : (
        listBody
      )}

      {showDetail && !compact ? (
        <CalendarEventDetail
          calendarContract={calendarContract || data?.calendar}
          event={
            effectiveSelected && effectiveSelected !== ''
              ? selectedEvent
              : null
          }
          onClose={
            effectiveSelected && effectiveSelected !== ''
              ? handleCloseDetail
              : undefined
          }
        />
      ) : null}
    </div>
  )
}
