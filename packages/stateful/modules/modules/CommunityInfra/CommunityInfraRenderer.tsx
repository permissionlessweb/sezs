import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ButtonLink,
  Loader,
  MarkdownRenderer,
  useDao,
} from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'
import { getSupportedChainConfig } from '@dao-dao/utils'

import { useMembership, useWallet } from '../../../hooks'
import {
  DEFAULT_EVENT_HUB_RESIDUAL_DOCS,
  DEFAULT_HERMES_BOARD_LABEL,
  formatDigestPin,
  fullDigestRef,
} from './constants'
import {
  advanceResidualGate,
  buildHermesBoardDeepLink,
  buildResidualCardDraft,
  canSpawnResidualForRow,
  residualSpawnUnlocked,
  type ResidualSpawnGate,
} from './hermesBridge'
import { buildResolvedInstances, probeResolvedInstances } from './probe'
import {
  CommunityInfraComponentRow,
  CommunityInfraHealth,
  CommunityInfraLocation,
  CommunityInfraModuleData,
  CommunityInfraResolvedInstance,
} from './types'

/** Wallet is contract admin or DAO-level admin when that address is a wallet. */
const resolveIsAdmin = (
  address: string | undefined,
  admin: string | undefined,
  contractAdmin: string | null | undefined
): boolean => {
  if (!address) return false
  const candidates = [admin, contractAdmin].filter(
    (a): a is string => typeof a === 'string' && a.length > 0
  )
  return candidates.includes(address)
}

const healthClasses = (health: CommunityInfraHealth): string => {
  switch (health) {
    case 'green':
      return 'bg-background-button-success/20 text-text-interactive-valid border-border-interactive-valid'
    case 'canary':
      return 'bg-background-button-warning/20 text-text-interactive-warning-body border-border-interactive-warning'
    case 'red':
      return 'bg-background-button-error/20 text-text-interactive-error border-border-interactive-error'
    default:
      return 'bg-background-secondary text-text-tertiary border-border-primary'
  }
}

const HealthPill = ({ health }: { health: CommunityInfraHealth }) => (
  <span
    className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-xs uppercase tracking-wide ${healthClasses(health)}`}
  >
    {health}
  </span>
)

const LOCATION_FILTERS: Array<CommunityInfraLocation | 'all'> = [
  'all',
  'local',
  'mesh',
  'akash',
  'unknown',
]

/**
 * CommunityInfra tab — multi-instance status matrix (M2).
 * Probes existing endpoints only; green/canary/red with honest offline/CORS reasons.
 * Digest pins from LAB-IMAGE-DIGESTS (public-safe).
 */
export const CommunityInfraRenderer = ({
  variables,
}: ModuleRendererProps<CommunityInfraModuleData>) => {
  const {
    description,
    requireAdmin = true,
    hermesDeepLinkUrl = '',
    hermesBoardLabel = DEFAULT_HERMES_BOARD_LABEL,
    enableResidualSpawn = true,
    eventHubResidualDocsUrl = DEFAULT_EVENT_HUB_RESIDUAL_DOCS,
    buzzCanonicalUrl = '',
    buzzDualUrl = '',
  } = variables

  const { t } = useTranslation()
  const dao = useDao()
  const { address } = useWallet({
    chainId: dao.chainId,
    attemptConnection: true,
  })
  const { isMember = false } = useMembership()
  const isAdmin = resolveIsAdmin(
    address,
    dao.info.admin,
    dao.info.contractAdmin
  )

  /** Dual-gate residual spawn per instance:role key. */
  const [spawnGates, setSpawnGates] = useState<
    Record<string, ResidualSpawnGate>
  >({})
  const [spawnDraftKey, setSpawnDraftKey] = useState<string | null>(null)

  const chainServices = getSupportedChainConfig(dao.chainId)?.services
  const merged: CommunityInfraModuleData = useMemo(
    () => ({
      ...variables,
      buzzCanonicalUrl:
        variables.buzzCanonicalUrl?.trim() ||
        chainServices?.buzzEmbed ||
        variables.buzzCanonicalUrl,
      hashMerchantUrl:
        variables.hashMerchantUrl?.trim() ||
        chainServices?.merkleServer ||
        variables.hashMerchantUrl,
    }),
    [variables, chainServices]
  )

  const baseInstances = useMemo(
    () => buildResolvedInstances(merged),
    [merged]
  )
  const [instances, setInstances] =
    useState<CommunityInfraResolvedInstance[]>(baseInstances)
  const [probing, setProbing] = useState(false)
  const [lastBatchAt, setLastBatchAt] = useState<string | null>(null)
  const [locationFilter, setLocationFilter] = useState<
    CommunityInfraLocation | 'all'
  >('all')
  const [activeInstanceId, setActiveInstanceId] = useState<string | 'all'>(
    'all'
  )

  const runProbe = useCallback(async () => {
    setProbing(true)
    try {
      const next = await probeResolvedInstances(buildResolvedInstances(merged))
      setInstances(next)
      setLastBatchAt(new Date().toISOString())
    } finally {
      setProbing(false)
    }
  }, [merged])

  useEffect(() => {
    void runProbe()
  }, [runProbe])

  useEffect(() => {
    setInstances(baseInstances)
  }, [baseInstances])

  if (requireAdmin && isMember && address && !isAdmin) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-border-primary p-4">
        <p className="primary-text">
          {t('info.communityInfraOperatorsOnly', {
            defaultValue: 'Community infra matrix is operators-only.',
          })}
        </p>
        <p className="secondary-text text-sm">
          {t('info.communityInfraOperatorsOnlyDetail', {
            defaultValue:
              'Connect a DAO admin wallet to view endpoint health. Members still see Hermes Ops / Event Hub deep-links elsewhere.',
          })}
        </p>
      </div>
    )
  }

  const filtered = instances.filter((inst) => {
    if (locationFilter !== 'all' && inst.location !== locationFilter) {
      return false
    }
    if (activeInstanceId !== 'all' && inst.id !== activeInstanceId) {
      return false
    }
    return true
  })

  const allRows = filtered.flatMap((i) => i.rows)
  const buzzOpen =
    buzzCanonicalUrl?.trim() ||
    allRows.find((r) => r.role === 'buzz')?.url ||
    chainServices?.buzzEmbed ||
    ''
  const buzzDualOpen =
    buzzDualUrl?.trim() ||
    allRows.find((r) => r.role === 'buzz_dual')?.url ||
    ''
  const hermesOpen =
    hermesDeepLinkUrl?.trim() ||
    allRows.find((r) => r.role === 'hermes_board')?.url ||
    ''
  const residualDocs =
    eventHubResidualDocsUrl?.trim() || DEFAULT_EVENT_HUB_RESIDUAL_DOCS
  const residualIsHttp = residualDocs.startsWith('http')

  const boardLabel = hermesBoardLabel?.trim() || DEFAULT_HERMES_BOARD_LABEL
  const hermesBoardOpen = buildHermesBoardDeepLink({
    deepLinkUrl: hermesOpen,
    boardLabel,
    daoAddress: dao.coreAddress,
    chainId: dao.chainId,
    view: 'kanban',
  })

  const rowGateKey = (instanceId: string, role: string) =>
    `${instanceId}:${role}`

  const setGate = (key: string, event: 'ack_no_live' | 'confirm_spawn' | 'reset') => {
    setSpawnGates((prev) => ({
      ...prev,
      [key]: advanceResidualGate(prev[key] ?? 0, event),
    }))
  }

  const makeDraft = (
    inst: CommunityInfraResolvedInstance,
    row: CommunityInfraComponentRow
  ) =>
    buildResidualCardDraft({
      row,
      instanceLabel: inst.label,
      boardLabel,
      daoAddress: dao.coreAddress,
      chainId: dao.chainId,
    })

  const openResidualForRow = (
    inst: CommunityInfraResolvedInstance,
    row: CommunityInfraComponentRow
  ) => {
    const draft = makeDraft(inst, row)
    const href = buildHermesBoardDeepLink({
      deepLinkUrl: hermesOpen,
      boardLabel,
      daoAddress: dao.coreAddress,
      chainId: dao.chainId,
      residual: { title: draft.title, body: draft.body },
      view: 'kanban',
    })
    if (href && typeof window !== 'undefined') {
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }

  const copyResidualDraft = async (
    inst: CommunityInfraResolvedInstance,
    row: CommunityInfraComponentRow
  ) => {
    const draft = makeDraft(inst, row)
    const text = `# ${draft.title}\n\n${draft.body}`
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      }
    } catch {
      // Clipboard may be denied; dual-gate open still works.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {description ? (
        <MarkdownRenderer className="text-base" markdown={description} />
      ) : (
        <p className="secondary-text text-sm">
          {t('info.communityInfraIntro', {
            defaultValue:
              'Community instance infrastructure (read-only). Multi-instance matrix with location tags and LAB-IMAGE-DIGESTS pins — no new hosts, no secrets.',
          })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col">
          <span className="primary-text text-sm">
            {t('info.communityInfraInstances', {
              defaultValue: 'Community instances',
            })}{' '}
            ({instances.length})
          </span>
          <span className="secondary-text font-mono text-xs">
            chain={dao.chainId} · dao={dao.coreAddress.slice(0, 12)}…
          </span>
        </div>
        <Button disabled={probing} onClick={() => void runProbe()} size="sm">
          {probing
            ? t('button.probing', { defaultValue: 'Probing…' })
            : t('button.reprobe', { defaultValue: 'Reprobe' })}
        </Button>
        {lastBatchAt ? (
          <span className="secondary-text font-mono text-xs">
            last batch {lastBatchAt}
          </span>
        ) : null}
      </div>

      {/* Instance list + location filter */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setActiveInstanceId('all')}
            size="sm"
            variant={activeInstanceId === 'all' ? 'primary' : 'ghost'}
          >
            {t('button.allInstances', { defaultValue: 'All instances' })}
          </Button>
          {instances.map((inst) => (
            <Button
              key={inst.id}
              onClick={() => setActiveInstanceId(inst.id)}
              size="sm"
              variant={activeInstanceId === inst.id ? 'primary' : 'secondary'}
            >
              {inst.label}{' '}
              <span className="font-mono text-xs opacity-80">
                [{inst.location}]
              </span>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="secondary-text text-xs">
            {t('info.filterLocation', { defaultValue: 'Filter location:' })}
          </span>
          {LOCATION_FILTERS.map((loc) => (
            <Button
              key={loc}
              onClick={() => setLocationFilter(loc)}
              size="sm"
              variant={locationFilter === loc ? 'primary' : 'ghost'}
            >
              {loc}
            </Button>
          ))}
        </div>
      </div>

      {/* HermesOps bridge — board label deep-link (members/ops; no secrets). */}
      <div className="flex flex-col gap-2 rounded-md border border-border-primary p-3">
        <span className="primary-text text-sm">
          {t('info.hermesOpsBridge', {
            defaultValue: 'HermesOps bridge',
          })}
        </span>
        <span className="secondary-text font-mono text-xs">
          board={boardLabel}
          {hermesBoardOpen || hermesOpen
            ? ` · ${hermesBoardOpen || hermesOpen}`
            : ' · no deep-link configured'}
        </span>
        <p className="secondary-text text-xs">
          {t('info.hermesOpsBridgeDetail', {
            defaultValue:
              'Deep-link opens the Hermes kanban board label for this DAO. Residual spawn from red/canary cells is dual-gated and never sets Akash LIVE.',
          })}
        </p>
        <div className="flex flex-wrap gap-2">
          {buzzOpen ? (
            <ButtonLink href={buzzOpen} variant="secondary">
              {t('button.openBuzz', { defaultValue: 'Open Buzz' })}
            </ButtonLink>
          ) : null}
          {buzzDualOpen && buzzDualOpen !== buzzOpen ? (
            <ButtonLink href={buzzDualOpen} variant="ghost">
              {t('button.openBuzzDual', { defaultValue: 'Open Buzz dual' })}
            </ButtonLink>
          ) : null}
          {hermesBoardOpen || hermesOpen ? (
            <ButtonLink
              href={hermesBoardOpen || hermesOpen}
              variant="secondary"
            >
              {t('button.openHermesBoard', {
                defaultValue: `Open Hermes board (${boardLabel})`,
              })}
            </ButtonLink>
          ) : null}
          {residualIsHttp ? (
            <ButtonLink href={residualDocs} variant="ghost">
              {t('button.openEventHubResidual', {
                defaultValue: 'Event Hub residual docs',
              })}
            </ButtonLink>
          ) : (
            <p className="secondary-text max-w-md font-mono text-xs break-all">
              {t('info.eventHubResidualDocsPath', {
                defaultValue: 'Event Hub residual docs (repo path):',
              })}{' '}
              {residualDocs}
            </p>
          )}
        </div>
      </div>

      {probing && allRows.every((r) => r.health === 'unknown') ? (
        <Loader />
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-md border border-border-primary p-4">
          <p className="secondary-text text-sm">
            {t('info.communityInfraNoInstances', {
              defaultValue:
                'No instances match this location filter. Adjust filter or configure instances in the module editor.',
            })}
          </p>
        </div>
      ) : (
        filtered.map((inst) => (
          <div key={inst.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="primary-text text-sm">{inst.label}</span>
              <span className="secondary-text font-mono text-xs">
                id={inst.id} · location={inst.location}
              </span>
            </div>
            <div className="overflow-x-auto rounded-md border border-border-primary">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead className="bg-background-secondary">
                  <tr>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">URL</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Last probe</th>
                    <th className="px-3 py-2 font-medium">Location</th>
                    <th className="px-3 py-2 font-medium">Digest</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inst.rows.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-3 secondary-text text-sm"
                        colSpan={7}
                      >
                        {t('info.communityInfraEmptyRows', {
                          defaultValue:
                            'No components for this instance (no blank iframe). Configure URLs or enable ENDPOINTS-SSOT seed.',
                        })}
                      </td>
                    </tr>
                  ) : (
                    inst.rows.map((row) => (
                      <tr
                        key={`${inst.id}:${row.role}`}
                        className="border-t border-border-secondary align-top"
                      >
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-0.5">
                            <span className="primary-text text-sm">
                              {row.label}
                            </span>
                            <span className="secondary-text font-mono text-xs">
                              {row.role}
                              {row.optional ? ' · optional' : ''}
                              {row.source ? ` · ${row.source}` : ''}
                            </span>
                          </div>
                        </td>
                        <td className="max-w-[240px] px-3 py-2 font-mono text-xs break-all">
                          {row.url || '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            <HealthPill health={row.health} />
                            {row.reason ? (
                              <span className="secondary-text text-xs break-all opacity-80">
                                {row.reason}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {row.lastProbeAt || '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {row.location}
                        </td>
                        <td
                          className="max-w-[200px] px-3 py-2 font-mono text-xs break-all"
                          title={fullDigestRef(row.digest)}
                        >
                          {formatDigestPin(row.digest)}
                        </td>
                        <td className="px-3 py-2">
                          {enableResidualSpawn &&
                          canSpawnResidualForRow(row.health) ? (
                            <div className="flex max-w-[220px] flex-col gap-1">
                              {(() => {
                                const key = rowGateKey(inst.id, row.role)
                                const gate = spawnGates[key] ?? 0
                                if (gate === 0) {
                                  return (
                                    <Button
                                      onClick={() => setGate(key, 'ack_no_live')}
                                      size="sm"
                                      variant="ghost"
                                    >
                                      {t('button.residualAckNoLive', {
                                        defaultValue: '1/2 Ack: no Akash LIVE',
                                      })}
                                    </Button>
                                  )
                                }
                                if (gate === 1) {
                                  return (
                                    <Button
                                      onClick={() => {
                                        setGate(key, 'confirm_spawn')
                                        setSpawnDraftKey(key)
                                      }}
                                      size="sm"
                                      variant="secondary"
                                    >
                                      {t('button.residualConfirmSpawn', {
                                        defaultValue: '2/2 Confirm residual',
                                      })}
                                    </Button>
                                  )
                                }
                                return (
                                  <div className="flex flex-col gap-1">
                                    <Button
                                      disabled={!residualSpawnUnlocked(gate)}
                                      onClick={() => openResidualForRow(inst, row)}
                                      size="sm"
                                      variant="primary"
                                    >
                                      {t('button.openResidualHermes', {
                                        defaultValue: 'Open residual in Hermes',
                                      })}
                                    </Button>
                                    <Button
                                      onClick={() =>
                                        void copyResidualDraft(inst, row)
                                      }
                                      size="sm"
                                      variant="ghost"
                                    >
                                      {t('button.copyResidualDraft', {
                                        defaultValue: 'Copy draft',
                                      })}
                                    </Button>
                                    <Button
                                      onClick={() => {
                                        setGate(key, 'reset')
                                        setSpawnDraftKey(null)
                                      }}
                                      size="sm"
                                      variant="ghost"
                                    >
                                      {t('button.reset', {
                                        defaultValue: 'Reset',
                                      })}
                                    </Button>
                                  </div>
                                )
                              })()}
                              {spawnDraftKey === rowGateKey(inst.id, row.role) ? (
                                <span className="secondary-text text-xs">
                                  {t('info.residualNoLive', {
                                    defaultValue:
                                      'Opens Hermes with residual draft only — never Akash LIVE.',
                                  })}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="secondary-text font-mono text-xs">
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      <p className="secondary-text text-xs">
        {t('info.communityInfraHonesty', {
          defaultValue:
            'Green requires a successful browser fetch. Red/canary include offline, timeout, and CORS blocks — never silent blanks. Seeds: ENDPOINTS-SSOT + optional LAB-IMAGE-DIGESTS. Residual spawn is dual-gated (no Akash LIVE). No secrets.',
        })}
      </p>
    </div>
  )
}
