import clsx from 'clsx'
import { useTranslation } from 'react-i18next'

import { Checkbox, InputLabel } from '@dao-dao/stateless'
import {
  GIFT_PREAUTH_ACTIONS,
  GiftPreauthActionId,
  resolvePreauthMsgTypeUrls,
  togglePreauthAction,
} from '@dao-dao/utils'

export type GiftPreauthActionSelectorProps = {
  selected: GiftPreauthActionId[]
  onChange: (next: GiftPreauthActionId[]) => void
  disabled?: boolean
  className?: string
  /**
   * Compact mode for generation card (no long intro).
   */
  compact?: boolean
}

/**
 * Multi-select for feegrant preauth actions at gift-account generation.
 * Only checked actions are included in AllowedMsgAllowance.allowed_messages.
 */
export const GiftPreauthActionSelector = ({
  selected,
  onChange,
  disabled,
  className,
  compact,
}: GiftPreauthActionSelectorProps) => {
  const { t } = useTranslation()
  const msgUrls = resolvePreauthMsgTypeUrls(selected)

  return (
    <div className={clsx('flex flex-col gap-3', className)}>
      <div className="space-y-1">
        <InputLabel
          name={t('form.feegrantPreauthActions', {
            defaultValue: 'Feegrant preauth actions',
          })}
        />
        {!compact && (
          <p className="secondary-text text-xs">
            {t('info.feegrantPreauthActionsHelp', {
              defaultValue:
                'Select which message types the fresh wallet may use with granter-paid gas. Feegrant covers gas only for these types — not token funding, membership, or unrestricted spending.',
            })}
          </p>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {GIFT_PREAUTH_ACTIONS.map((action) => {
          const checked = selected.includes(action.id)
          return (
            <li key={action.id}>
              <button
                className={clsx(
                  'flex w-full flex-row items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                  checked
                    ? 'border-border-interactive-selected bg-background-interactive-selected'
                    : 'border-border-primary bg-background-tertiary',
                  disabled
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:bg-background-interactive-hover'
                )}
                disabled={disabled}
                onClick={() =>
                  !disabled &&
                  onChange(togglePreauthAction(selected, action.id))
                }
                type="button"
              >
                <Checkbox
                  checked={checked}
                  className="mt-0.5"
                  readOnly
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="primary-text block text-sm">
                    {action.label}
                  </span>
                  <span className="secondary-text block text-xs">
                    {action.description}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <p className="secondary-text font-mono text-xs">
        {msgUrls.length === 0
          ? t('info.noFeegrantMsgs', {
              defaultValue:
                'No actions selected — no feegrant MsgGrantAllowance will be built.',
            })
          : t('info.feegrantAllowedMsgs', {
              defaultValue: `Allowed msg types (${msgUrls.length}): ${msgUrls.join(', ')}`,
              count: msgUrls.length,
              list: msgUrls.join(', '),
            })}
      </p>
    </div>
  )
}
