import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  InputErrorMessage,
  InputLabel,
  SegmentedControls,
  SwitchCard,
  TextAreaInput,
  TextInput,
} from '@dao-dao/stateless'
import { ModuleEditorProps } from '@dao-dao/types'
import {
  LAB_BUZZ_DUAL_HTTP,
  LAB_BUZZ_RELAY_HTTP,
  resolveLabBuzzEmbedShell,
} from '@dao-dao/utils'

import { DEFAULT_BUZZ_EMBED } from './constants'
import { BuzzModuleData } from './types'

export const BuzzEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<BuzzModuleData>) => {
  const { t } = useTranslation()
  const { register, watch, setValue } = useFormContext<BuzzModuleData>()
  const labEmbedPlaceholder = resolveLabBuzzEmbedShell()

  const defaultView = watch(
    (fieldNamePrefix + 'defaultView') as 'defaultView'
  )
  const enableDaoAttest = watch(
    (fieldNamePrefix + 'enableDaoAttest') as 'enableDaoAttest'
  )

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.buzzModuleEditor', {
          defaultValue:
            'Embed the Terp Buzz community surface. Primary identity is Nostr inside the child; optional ADR-36 daoAttest is membership eligibility only (never bounty JWT or nsec).',
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
          placeholder={labEmbedPlaceholder || DEFAULT_BUZZ_EMBED}
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.buzzEmbedBaseHint', {
            defaultValue: `Lab: embed shell on SDA host (${LAB_BUZZ_DUAL_HTTP}); relay SoT on deploy-host (${LAB_BUZZ_RELAY_HTTP}) is not an iframe base. Empty → chain services.buzzEmbed / ${DEFAULT_BUZZ_EMBED}. Path /embed is appended when embedding.`,
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
              label: t('form.buzzViewPublic', { defaultValue: 'Public' }),
              value: 'public' as const,
            },
            {
              label: t('form.buzzViewEvent', { defaultValue: 'Event' }),
              value: 'event' as const,
            },
            {
              label: t('form.buzzViewAdmin', { defaultValue: 'Admin' }),
              value: 'admin' as const,
            },
          ]}
        />
      </div>

      <SwitchCard
        containerClassName="self-start"
        enabled={!!enableDaoAttest}
        label={t('form.enableDaoAttest', {
          defaultValue: 'Enable DAO membership attest (room gates)',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix + 'enableDaoAttest') as 'enableDaoAttest',
            !enableDaoAttest,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />
      <p className="secondary-text text-xs">
        {t('info.buzzDaoAttestHint', {
          defaultValue:
            'When enabled, the child may request an ADR-36 membership proof for gated rooms. Parent never mints Nostr keys or shares bounties JWT.',
        })}
      </p>
    </div>
  )
}
