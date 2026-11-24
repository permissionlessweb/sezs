import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ButtonLink, MarkdownRenderer, useDao } from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'
import { MESH_STORAGE_KEY } from '@dao-dao/utils'

import {
  BUZZ_CONNECT_STEPS,
  HERMES_CONNECT_STEPS,
  buildLabGatewayMeshJson,
} from './constants'
import { partitionGateways, resolveGatewayDirectory } from './resolveGateways'
import {
  CommunityGatewaysModuleData,
  GatewayEntry,
  GatewayVisibility,
} from './types'

const visibilityLabelKey = (
  v: GatewayVisibility
): { key: string; defaultValue: string } => {
  switch (v) {
    case 'registered':
      return {
        key: 'info.gatewayVisibilityRegistered',
        defaultValue: 'Registered (mesh)',
      }
    case 'members':
      return {
        key: 'info.gatewayVisibilityMembers',
        defaultValue: 'Members',
      }
    case 'operators':
      return {
        key: 'info.gatewayVisibilityOperators',
        defaultValue: 'Operators',
      }
    default:
      return { key: 'info.gatewayVisibilityPublic', defaultValue: 'Public' }
  }
}

const GatewayCard = ({ entry }: { entry: GatewayEntry }) => {
  const { t } = useTranslation()
  const vis = visibilityLabelKey(entry.visibility)
  const kindLabel =
    entry.kind === 'buzz'
      ? t('title.buzz', { defaultValue: 'Buzz' })
      : t('title.hermes', { defaultValue: 'Hermes' })
  return (
    <div className="rounded-md border border-border-primary bg-background-base p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="primary-text text-sm font-medium">{entry.label}</p>
          <p className="secondary-text text-xs">
            {kindLabel}
            {' · '}
            {t(vis.key, { defaultValue: vis.defaultValue })}
          </p>
        </div>
        <ButtonLink href={entry.url} openInNewTab variant="secondary">
          {t('button.open', { defaultValue: 'Open' })}
        </ButtonLink>
      </div>
      <p className="font-mono text-[11px] text-text-tertiary break-all">
        {entry.url}
      </p>
      {entry.relayWss ? (
        <p className="secondary-text text-xs break-all">
          <span className="font-medium">
            {t('info.wssLabel', { defaultValue: 'WSS' })}{' '}
          </span>
          <span className="font-mono opacity-80">{entry.relayWss}</span>
        </p>
      ) : null}
      {entry.note ? (
        <p className="secondary-text text-xs leading-snug">{entry.note}</p>
      ) : null}
    </div>
  )
}

const StepsList = ({ steps }: { steps: string[] }) => (
  <ol className="secondary-text list-decimal pl-5 space-y-2 text-sm leading-snug">
    {steps.map((s, i) => (
      <li key={i}>{s}</li>
    ))}
  </ol>
)

/**
 * Unified Buzz + Hermes directory — informational only.
 * No Hermes dashboard iframe; no forced Buzz iframe (use Event Hub for live collab).
 */
export const CommunityGatewaysRenderer = ({
  variables,
}: ModuleRendererProps<CommunityGatewaysModuleData>) => {
  const { t } = useTranslation()
  const dao = useDao()

  const {
    description,
    useChainMeshDefault = true,
    meshJson = '',
    gateways = [],
    showBuzzSteps = true,
    showHermesSteps = true,
  } = variables

  const chainMeshJson = useMemo(() => {
    // Prefer on-chain mesh item when present; lab inject as soft fallback on 120u-1.
    const fromDao = dao.info.items?.[MESH_STORAGE_KEY]
    if (typeof fromDao === 'string' && fromDao.trim()) {
      return fromDao
    }
    if (dao.chainId === '120u-1' || dao.chainId === 'terp-150') {
      return buildLabGatewayMeshJson()
    }
    return null
  }, [dao.chainId, dao.info.items])

  const directory = useMemo(
    () =>
      resolveGatewayDirectory({
        data: { gateways, useChainMeshDefault, meshJson },
        chainMeshJson,
      }),
    [gateways, useChainMeshDefault, meshJson, chainMeshJson]
  )

  const { buzz, hermes } = useMemo(
    () => partitionGateways(directory),
    [directory]
  )

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {description ? (
        <MarkdownRenderer className="text-base" markdown={description} />
      ) : (
        <p className="secondary-text text-sm">
          {t('info.communityGatewaysIntro', {
            defaultValue:
              'Public and registered Buzz / Hermes gateways for this DAO. Open links externally; Hermes is not embedded in the DAO UI yet.',
          })}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="primary-text text-base font-medium">
            {t('title.buzzGateways', { defaultValue: 'Buzz (coordination)' })}
          </h2>
          <p className="secondary-text text-xs mt-1">
            {t('info.buzzGatewaysHint', {
              defaultValue:
                'Community messaging & rooms. Identity is Nostr inside the client — separate from wallet / passkey.',
            })}
          </p>
        </div>
        {buzz.length === 0 ? (
          <p className="secondary-text text-sm rounded-md border border-border-primary border-dashed p-3">
            {t('info.noBuzzGateways', {
              defaultValue:
                'No Buzz gateways registered yet. Curators can add public or mesh.v1 embeds.buzz / relays.',
            })}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {buzz.map((g) => (
              <GatewayCard key={g.id} entry={g} />
            ))}
          </div>
        )}
        {showBuzzSteps ? (
          <div className="rounded-md bg-background-secondary p-3 flex flex-col gap-2">
            <p className="primary-text text-sm font-medium">
              {t('title.connectBuzz', {
                defaultValue: 'How to connect (Buzz)',
              })}
            </p>
            <StepsList steps={BUZZ_CONNECT_STEPS} />
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="primary-text text-base font-medium">
            {t('title.hermesGateways', {
              defaultValue: 'Hermes (ops / agents)',
            })}
          </h2>
          <p className="secondary-text text-xs mt-1">
            {t('info.hermesGatewaysHint', {
              defaultValue:
                'Operator and agent gateways. Links only for now — live dashboard iframe support is deferred.',
            })}
          </p>
        </div>
        {hermes.length === 0 ? (
          <p className="secondary-text text-sm rounded-md border border-border-primary border-dashed p-3">
            {t('info.noHermesGateways', {
              defaultValue:
                'No Hermes gateways registered yet. Operators can publish a public status URL or mesh.v1 embeds.hermes.',
            })}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {hermes.map((g) => (
              <GatewayCard key={g.id} entry={g} />
            ))}
          </div>
        )}
        {showHermesSteps ? (
          <div className="rounded-md bg-background-secondary p-3 flex flex-col gap-2">
            <p className="primary-text text-sm font-medium">
              {t('title.connectHermes', {
                defaultValue: 'How to connect (Hermes)',
              })}
            </p>
            <StepsList steps={HERMES_CONNECT_STEPS} />
          </div>
        ) : null}
      </section>

      <p className="text-[11px] text-text-tertiary leading-snug">
        {t('info.communityGatewaysFooter', {
          defaultValue:
            'Event Hub may still open ephemeral Buzz collab embeds per event. This tab is the durable directory for any public or registered gateway the DAO lists.',
        })}
      </p>
    </div>
  )
}
