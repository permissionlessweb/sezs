/**
 * Participant connect UX shell (P2 graduation / t_cdd14603).
 *
 * After pairing or ADR-36, show honest path to Event Hub chips + collab attach
 * without blank iframes or multi-user Hermes login claims.
 * Identity planes stay unmerged: wallet/ADR-36 ≠ Buzz Nostr ≠ Hermes evt-* ≠ Headscale.
 */

import { useTranslation } from 'react-i18next'

import { Button, ButtonLink } from '@dao-dao/stateless'

export type ParticipantConnectPanelProps = {
  isWalletConnected: boolean
  isMember?: boolean
  hermesDeepLinkUrl?: string
  /** Optional public-safe router / session-map doc URL (never secrets). */
  sessionMapHintUrl?: string
  onOpenCollab?: () => void
  onOpenOps?: () => void
  showOps?: boolean
}

export const ParticipantConnectPanel = ({
  isWalletConnected,
  isMember = false,
  hermesDeepLinkUrl = '',
  sessionMapHintUrl,
  onOpenCollab,
  onOpenOps,
  showOps = false,
}: ParticipantConnectPanelProps) => {
  const { t } = useTranslation()
  const deepLink = hermesDeepLinkUrl?.trim() || ''

  return (
    <section
      aria-label="Participant connect path"
      className="flex flex-col gap-3 rounded-md border border-border-primary bg-background-tertiary p-4"
    >
      <div className="flex flex-col gap-1">
        <p className="primary-text text-sm">
          {t('title.eventHubParticipantConnect', {
            defaultValue: 'Participant connect path',
          })}
        </p>
        <p className="secondary-text text-xs">
          {t('info.eventHubParticipantConnectIntro', {
            defaultValue:
              'After Hermes pairing or ADR-36 wallet identity, operators mint an isolated evt-* profile + frozen router. Event Hub shows status chips (stage 4) and collab attach — not a shared Hermes multi-user login.',
          })}
        </p>
      </div>

      <ol className="secondary-text list-inside list-decimal space-y-1 text-xs">
        <li>
          <span className="font-medium">
            {t('info.eventHubConnectStepWallet', {
              defaultValue: 'Wallet / membership',
            })}
          </span>
          {' — '}
          {isWalletConnected
            ? t('info.eventHubConnectWalletOk', {
                defaultValue: 'connected',
              })
            : t('info.eventHubConnectWalletNeed', {
                defaultValue: 'connect wallet (ADR-36 / membership plane)',
              })}
          {isMember
            ? t('info.eventHubConnectMemberOk', {
                defaultValue: ' · DAO member',
              })
            : ''}
        </li>
        <li>
          <span className="font-medium">
            {t('info.eventHubConnectStepHermes', {
              defaultValue: 'Hermes evt-*',
            })}
          </span>
          {' — '}
          {t('info.eventHubConnectHermesDetail', {
            defaultValue:
              'pairing code or ADR-36 grant → isolated profile (not :9119 multi-login)',
          })}
        </li>
        <li>
          <span className="font-medium">
            {t('info.eventHubConnectStepRouter', {
              defaultValue: 'Router circuit',
            })}
          </span>
          {' — '}
          {t('info.eventHubConnectRouterDetail', {
            defaultValue:
              'frozen ROUTER OBJECT (public-safe links only; never nsec/JWT)',
          })}
        </li>
        <li>
          <span className="font-medium">
            {t('info.eventHubConnectStepChips', {
              defaultValue: 'Event Hub chips + attach',
            })}
          </span>
          {' — '}
          {t('info.eventHubConnectChipsDetail', {
            defaultValue:
              'status chips only at review (stage 4); Buzz uses embed shell or RELAY_NOT_EMBED honesty — never raw relay iframe as product',
          })}
        </li>
      </ol>

      <p className="caption-text text-xs opacity-80">
        {t('info.eventHubIdentityLock', {
          defaultValue:
            'Identity lock: ADR-36 / membership ≠ Buzz Nostr ≠ Hermes profile ≠ Headscale',
        })}
      </p>

      <div className="flex flex-wrap gap-2">
        {onOpenCollab ? (
          <Button onClick={onOpenCollab} size="sm" variant="primary">
            {t('button.openEventCollab', {
              defaultValue: 'Open collab surface',
            })}
          </Button>
        ) : null}
        {showOps && onOpenOps ? (
          <Button onClick={onOpenOps} size="sm" variant="secondary">
            {t('button.openEventOps', {
              defaultValue: 'Open ops (members)',
            })}
          </Button>
        ) : null}
        {deepLink ? (
          <ButtonLink href={deepLink} openInNewTab size="sm" variant="ghost">
            {t('button.openHermesDeepLink', {
              defaultValue: 'Hermes deep-link',
            })}
          </ButtonLink>
        ) : null}
        {sessionMapHintUrl ? (
          <ButtonLink
            href={sessionMapHintUrl}
            openInNewTab
            size="sm"
            variant="ghost"
          >
            {t('link.sessionMapSurfaces', {
              defaultValue: 'Session map surfaces',
            })}
          </ButtonLink>
        ) : (
          <span className="caption-text text-xs text-text-tertiary">
            {t('info.sessionMapDocPointer', {
              defaultValue:
                'Session map SoT: docs/grant/zcash/DASHBOARD-session-map-team-profiles-hermes-buzz-daodao.md (t_1093353f)',
            })}
          </span>
        )}
      </div>
    </section>
  )
}
