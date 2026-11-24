import { useTranslation } from 'react-i18next'

import { MarkdownRenderer } from '@dao-dao/stateless'

export type EventDetailPanelProps = {
  title?: string
  description?: string
  eventId?: string | null
  ceremonyContract?: string
  calendarContract?: string
  audience?: string
  codeOfConductUrl?: string
  /** OD-session-map result (ceremony session_id). */
  sessionId?: string
  isRegistered?: boolean | null
  registrationOpen?: boolean | null
  canRegister?: boolean
  registerBusy?: boolean
  registerError?: string | null
  onRegister?: () => void
}

/**
 * Zone B — selected event story + ceremony Register CTA (fail-closed).
 *
 * Register only enables when ceremony + session_id + wallet + registration_open
 * and not already registered. Never invents green chips.
 */
export const EventDetailPanel = ({
  title,
  description,
  eventId,
  ceremonyContract,
  calendarContract,
  audience,
  codeOfConductUrl,
  sessionId,
  isRegistered,
  registrationOpen,
  canRegister,
  registerBusy,
  registerError,
  onRegister,
}: EventDetailPanelProps) => {
  const { t } = useTranslation()

  const registerHint = (() => {
    if (!ceremonyContract) {
      return t('info.eventHubRegisterNoCeremony', {
        defaultValue:
          'On-chain registration not configured — status stays unknown.',
      })
    }
    if (!sessionId) {
      return t('info.eventHubRegisterNoSession', {
        defaultValue:
          'Session not linked — set default event slug or select a calendar event (OD-session-map).',
      })
    }
    if (isRegistered === true) {
      return t('info.eventHubAlreadyRegistered', {
        defaultValue: 'Already registered for this ceremony session.',
      })
    }
    if (registrationOpen === false) {
      return t('info.eventHubRegistrationClosed', {
        defaultValue: 'Ceremony registration is closed.',
      })
    }
    if (isRegistered == null || registrationOpen == null) {
      return t('info.eventHubRegisterQueryPending', {
        defaultValue:
          'Connect wallet and wait for ceremony query (or deploy ceremony + StartCeremony with this session_id).',
      })
    }
    return t('info.eventHubRegisterReady', {
      defaultValue: 'Register signs Wasm Register { session_id } — no nullifier.',
    })
  })()

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-primary p-4">
      <div className="flex flex-col gap-1">
        <p className="primary-text">
          {title ||
            t('title.eventHubEvent', {
              defaultValue: 'Event',
            })}
        </p>
        {eventId ? (
          <p className="secondary-text font-mono text-xs break-all">
            {t('info.eventId', { defaultValue: 'Event id' })}: {eventId}
          </p>
        ) : (
          <p className="secondary-text text-xs">
            {t('info.eventHubSelectEvent', {
              defaultValue:
                'Select an event from the calendar strip, or configure a default event slug in the module editor.',
            })}
          </p>
        )}
        {sessionId ? (
          <p className="secondary-text font-mono text-xs break-all">
            {t('info.ceremonySessionId', {
              defaultValue: 'Ceremony session',
            })}
            : {sessionId}
          </p>
        ) : null}
      </div>

      {description ? (
        <MarkdownRenderer className="text-sm" markdown={description} />
      ) : null}

      {audience ? (
        <p className="secondary-text text-sm">
          <span className="font-medium">
            {t('form.audience', { defaultValue: 'Audience' })}:{' '}
          </span>
          {audience}
        </p>
      ) : null}

      {codeOfConductUrl ? (
        <a
          className="link-text text-sm"
          href={codeOfConductUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t('info.codeOfConduct', { defaultValue: 'Code of conduct' })}
        </a>
      ) : null}

      <div className="flex flex-wrap gap-3 text-xs">
        {calendarContract ? (
          <span className="secondary-text font-mono break-all">
            calendar: {calendarContract}
          </span>
        ) : (
          <span className="text-text-interactive-warning-body">
            {t('info.eventHubNoCalendar', {
              defaultValue: 'No calendar contract',
            })}
          </span>
        )}
        {ceremonyContract ? (
          <span className="secondary-text font-mono break-all">
            ceremony: {ceremonyContract}
          </span>
        ) : (
          <span className="secondary-text">
            {t('info.eventHubNoCeremony', {
              defaultValue: 'No ceremony contract (open registration)',
            })}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border-primary pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-md border border-border-primary bg-background-primary px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canRegister || registerBusy}
            onClick={() => onRegister?.()}
            type="button"
          >
            {registerBusy
              ? t('button.registering', { defaultValue: 'Registering…' })
              : t('button.registerForCeremony', {
                  defaultValue: 'Register for ceremony',
                })}
          </button>
          <p className="secondary-text text-xs">{registerHint}</p>
        </div>
        {registerError ? (
          <p className="text-xs text-text-interactive-error break-all">
            {registerError}
          </p>
        ) : null}
      </div>
    </div>
  )
}
