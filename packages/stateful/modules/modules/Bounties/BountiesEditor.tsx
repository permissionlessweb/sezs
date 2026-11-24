import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  InputErrorMessage,
  InputLabel,
  SegmentedControls,
  TextAreaInput,
  TextInput,
} from '@dao-dao/stateless'
import { ModuleEditorProps } from '@dao-dao/types'

import { DEFAULT_BOUNTIES_EMBED } from './constants'
import { BountiesModuleData } from './types'

export const BountiesEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<BountiesModuleData>) => {
  const { t } = useTranslation()
  const { register, watch, setValue } = useFormContext<BountiesModuleData>()

  const defaultView = watch(
    (fieldNamePrefix + 'defaultView') as 'defaultView'
  )

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.bountiesModuleEditor', {
          defaultValue:
            'Embed a DAO-scoped ZEC bounties board. Members prove membership with ADR-36 (wallet sign) and use HKDF-derived bounty public keys for applications — spend keys never leave this parent origin.',
        })}
      </p>

      <div className="space-y-2">
        <InputLabel name={t('form.description')} optional />
        <TextAreaInput
          disabled={!isCreating}
          error={errors?.description}
          fieldName={(fieldNamePrefix + 'description') as 'description'}
          register={register}
          rows={3}
        />
        <InputErrorMessage error={errors?.description} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.embedBaseUrl', {
            defaultValue: 'Embed base URL',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.embedBaseUrl}
          fieldName={(fieldNamePrefix + 'embedBaseUrl') as 'embedBaseUrl'}
          placeholder={DEFAULT_BOUNTIES_EMBED}
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.bountiesEmbedBaseHint', {
            defaultValue: `Leave empty to use chain default (${DEFAULT_BOUNTIES_EMBED}). Path /embed is appended automatically.`,
          })}
        </p>
        <InputErrorMessage error={errors?.embedBaseUrl} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.defaultView', { defaultValue: 'Default view' })}
        />
        <SegmentedControls
          disabled={!isCreating}
          onSelect={(value) =>
            setValue(
              (fieldNamePrefix + 'defaultView') as 'defaultView',
              value,
              { shouldValidate: true }
            )
          }
          selected={defaultView}
          tabs={[
            {
              label: t('form.bountiesViewMembers', {
                defaultValue: 'Members',
              }),
              value: 'members' as const,
            },
            {
              label: t('form.bountiesViewPublic', {
                defaultValue: 'Public',
              }),
              value: 'public' as const,
            },
          ]}
        />
        <p className="secondary-text text-xs">
          {t('info.bountiesDefaultViewHint', {
            defaultValue:
              'Members opens the ADR-36 gated board. Public shows the open catalog (private rows still require membership).',
          })}
        </p>
      </div>
    </div>
  )
}
