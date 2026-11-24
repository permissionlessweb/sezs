import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode.react'

import { Button, ButtonLink } from '@dao-dao/stateless'

/**
 * Mobile / pairing collab path for Buzz (P1.3).
 * Shows a scannable QR for the open URL, mobile-first copy, and ≥44px primary CTAs.
 * Does not invent hosts — parent must pass a real openUrl.
 */
export type MobileBuzzPairingProps = {
  /** Full URL phones should open (http/https). Empty → render nothing. */
  openUrl: string
  /** Optional WSS for client config copy. */
  wssUrl?: string
  className?: string
}

const TOUCH_CTA =
  'min-h-[44px] min-w-[44px] touch-manipulation inline-flex items-center justify-center'

export const MobileBuzzPairing = ({
  openUrl,
  wssUrl,
  className,
}: MobileBuzzPairingProps) => {
  const { t } = useTranslation()
  const [showQr, setShowQr] = useState(true)

  if (!openUrl) {
    return null
  }

  return (
    <div
      className={
        className ??
        'rounded-md border border-border-primary bg-background-base p-4 flex flex-col gap-3'
      }
      data-testid="mobile-buzz-pairing"
    >
      <div className="flex flex-col gap-1">
        <p className="primary-text text-sm font-medium">
          {t('title.buzzMobilePairing', {
            defaultValue: 'Mobile / pairing',
          })}
        </p>
        <p className="secondary-text text-sm">
          {t('info.buzzMobilePairing', {
            defaultValue:
              'On a phone: scan the QR or tap Open Buzz. Collab opens in your browser or NOSA client — this app does not host chat inline. Nostr identity stays in the client (not wallet login).',
          })}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
        {showQr ? (
          <div
            className="rounded-md bg-white p-3 shrink-0"
            aria-label={t('info.scanQrCode', {
              defaultValue: 'Scan QR Code',
            })}
          >
            <QRCode size={168} value={openUrl} />
          </div>
        ) : null}

        <div className="flex flex-col gap-3 w-full min-w-0">
          <div className="flex flex-col xs:flex-row flex-wrap gap-2">
            <ButtonLink
              className={TOUCH_CTA}
              href={openUrl}
              openInNewTab
              size="lg"
              variant="primary"
            >
              {t('button.openBuzzExternal', {
                defaultValue: 'Open Buzz (new tab)',
              })}
            </ButtonLink>
            <Button
              className={TOUCH_CTA}
              onClick={() => setShowQr((v) => !v)}
              size="lg"
              variant="secondary"
            >
              {showQr
                ? t('button.hideQrCode', { defaultValue: 'Hide QR code' })
                : t('button.showQrCode', { defaultValue: 'Show QR code' })}
            </Button>
          </div>

          <p className="font-mono text-[11px] text-text-tertiary break-all">
            {openUrl}
          </p>
          {wssUrl ? (
            <p className="secondary-text text-xs break-all">
              <span className="font-medium">
                {t('info.buzzMobileWssHint', {
                  defaultValue: 'Desktop client WSS',
                })}
                {': '}
              </span>
              <span className="font-mono opacity-80">{wssUrl}</span>
            </p>
          ) : null}
          <p className="secondary-text text-xs">
            {t('info.buzzMobileDeployHost', {
              defaultValue:
                'Lab: prefer deploy-host Buzz relay when healthy; local :3001 is a fallback. Operators publish embeds.buzz / relays on mesh.v1 — we never invent hosts.',
            })}
          </p>
        </div>
      </div>
    </div>
  )
}
