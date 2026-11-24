import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { MarkdownRenderer, useDao } from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'
import {
  MESH_STORAGE_KEY,
  MeshResolveError,
  ResolvedMesh,
  getSupportedChainConfig,
  resolveMesh,
} from '@dao-dao/utils'

import {
  DevOpsDisclosure,
  DevOpsMonoLine,
} from '../../components/DevOpsDisclosure'
import { ModuleSectionHeader } from '../../components/ModuleSectionHeader'
import { CalendarEventsPanel } from './CalendarEventsPanel'
import { CalendarModuleData } from './types'

const CALENDAR_INFO_MD = `### What this is

The DAO’s **public calendar** of upcoming community events, stored with the community on-chain.

### How to use it

1. Browse the **month/week calendar** (default) or switch to Schedule list.  
2. Click an event chip or row for **details** (title, local+UTC times, access).  
3. If the schedule is empty, the community may not have published events yet — check back or ask a steward.

### Tips

- This tab is for **reading the schedule**, not for advanced setup.  
- Event Hub is the fuller place to register and join related workspaces.
`

const meshSourceLabel = (source: ResolvedMesh['source']): string => {
  switch (source) {
    case 'dao_storage':
      return `DAO storage “${MESH_STORAGE_KEY}”`
    case 'module':
      return 'Calendar module values'
    case 'text_record':
      return 'account text record'
    case 'chain_default':
      return 'chain headstash defaults'
    case 'override':
      return 'explicit override'
    default:
      return source
  }
}

/**
 * Calendar tab renderer — elegant event surface.
 *
 * Mesh (mesh.v1) is the discovery contract for query/Nostr planes. This shell
 * calls resolveMesh and surfaces friction (missing calendar, missing mesh,
 * source) so product signals are visible. Event list UI is owned by C3.
 */
export const CalendarRenderer = ({
  variables: {
    calendarContract,
    description,
    useChainMeshDefault = true,
    meshJson,
  },
}: ModuleRendererProps<CalendarModuleData>) => {
  const { t } = useTranslation()
  const dao = useDao()
  const chainConfig = getSupportedChainConfig(dao.chainId)
  const chainServices = chainConfig?.services

  const meshQuery = useQuery({
    queryKey: [
      'calendarModule',
      'resolveMesh',
      dao.chainId,
      dao.coreAddress,
      calendarContract,
      meshJson,
      useChainMeshDefault,
      // items map identity when mesh.v1 is updated on-chain
      dao.info.items[MESH_STORAGE_KEY] ?? null,
    ],
    queryFn: async (): Promise<ResolvedMesh> =>
      resolveMesh({
        chainId: dao.chainId,
        daoAddress: dao.coreAddress,
        // When useChainMeshDefault is off, omit chain services so resolve fails
        // closed unless DAO storage / module meshJson / text records exist.
        chainServices: useChainMeshDefault === false ? {} : chainServices,
        loaders: {
          getDaoStorageItem: async (key) => {
            const fromInfo = dao.info.items[key]
            if (fromInfo !== undefined && fromInfo !== '') {
              return fromInfo
            }
            return null
          },
          getModuleValues: async () => ({
            calendarContract: calendarContract || undefined,
            meshJson: meshJson || undefined,
          }),
        },
      }),
    retry: false,
  })

  const mesh = meshQuery.data
  const meshError = meshQuery.error
  const hasInlineMesh = !!(meshJson && meshJson.trim())
  const storageMesh = dao.info.items[MESH_STORAGE_KEY]
  // Prefer module var, then resolved mesh.calendar (lab inject / storage).
  const effectiveCalendar =
    (calendarContract && calendarContract.trim()) || mesh?.calendar || ''

  return (
    <div className="flex flex-col gap-4">
      <ModuleSectionHeader
        infoMarkdown={CALENDAR_INFO_MD}
        infoTitle={t('title.calendar', { defaultValue: 'Calendar' })}
        lede={
          description ? (
            <MarkdownRenderer className="text-sm" markdown={description} />
          ) : (
            t('info.calendarQuietLede', {
              defaultValue: 'Upcoming on-chain events for this community.',
            })
          )
        }
        title={t('title.calendar', { defaultValue: 'Calendar' })}
      />

      {!effectiveCalendar ? (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border-primary px-4 py-6">
          <p className="primary-text text-sm">
            {t('title.calendarNotConfigured', {
              defaultValue: 'Calendar not configured',
            })}
          </p>
          <p className="secondary-text text-sm">
            {t('info.calendarNotConfigured', {
              defaultValue:
                'No calendar contract yet. Operators: Manage Modules → Calendar (publishes mesh.v1).',
            })}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-border-primary bg-background-base p-4">
          <p className="primary-text text-sm">
            {t('title.upcomingEvents', { defaultValue: 'Upcoming events' })}
          </p>

          {meshQuery.isLoading || meshQuery.isFetching ? (
            <p className="caption-text opacity-70">
              {t('info.resolvingMesh', {
                defaultValue: 'Resolving schedule…',
              })}
            </p>
          ) : meshError ? (
            <div className="flex flex-col gap-1">
              <p className="secondary-text text-sm">
                {t('info.calendarMeshSoftFail', {
                  defaultValue:
                    'Schedule extras are unavailable. Showing contract defaults when possible.',
                })}
              </p>
              <DevOpsDisclosure>
                <DevOpsMonoLine
                  value={
                    meshError instanceof MeshResolveError
                      ? meshError.message
                      : String(meshError)
                  }
                />
              </DevOpsDisclosure>
            </div>
          ) : mesh && !mesh.calendar ? (
            <p className="secondary-text text-sm">
              {t('info.meshMissingCalendar', {
                defaultValue:
                  'Schedule address not published yet — DAO is half-configured.',
              })}
            </p>
          ) : null}

          <CalendarEventsPanel
            calendarContract={effectiveCalendar}
            chainId={dao.chainId}
            daoAddress={dao.coreAddress}
            defaultView="grid"
            meshJson={meshJson}
            persistView
            showDetail
          />

          <DevOpsDisclosure>
            {mesh?.warnings?.length ? (
              <ul className="list-inside list-disc text-xs opacity-80">
                {mesh.warnings.slice(0, 5).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            <DevOpsMonoLine
              label={t('info.calendarContract', {
                defaultValue: 'calendar',
              })}
              value={effectiveCalendar}
            />
            {mesh ? (
              <>
                <DevOpsMonoLine
                  label={t('info.meshSource', {
                    defaultValue: 'mesh source',
                  })}
                  value={meshSourceLabel(mesh.source)}
                />
                <DevOpsMonoLine
                  label="query"
                  value={mesh.query || '(chain-only)'}
                />
                <DevOpsMonoLine
                  label="relays"
                  value={mesh.relays.join(', ') || '—'}
                />
              </>
            ) : null}
            <DevOpsMonoLine
              label="DAO storage"
              value={
                storageMesh
                  ? `${MESH_STORAGE_KEY} set`
                  : `${MESH_STORAGE_KEY} not set`
              }
            />
            <DevOpsMonoLine
              label="chain defaults"
              value={useChainMeshDefault ? 'on' : 'off'}
            />
            <DevOpsMonoLine
              label="inline meshJson"
              value={hasInlineMesh ? 'set' : '—'}
            />
          </DevOpsDisclosure>
        </div>
      )}
    </div>
  )
}
