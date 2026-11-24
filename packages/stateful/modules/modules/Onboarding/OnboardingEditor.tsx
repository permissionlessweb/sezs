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
  DEFAULT_GIFT_PREAUTH_ACTIONS,
  GiftPreauthActionId,
  validateRequired,
} from '@dao-dao/utils'

import { GiftPreauthActionSelector } from './GiftPreauthActionSelector'
import { OnboardingModuleData } from './types'

export const OnboardingEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<OnboardingModuleData>) => {
  const { t } = useTranslation()
  const { register, watch, setValue } = useFormContext<OnboardingModuleData>()

  const authPlane = watch(
    (fieldNamePrefix + 'defaultAuthPlane') as 'defaultAuthPlane'
  )
  const autoMigrate = watch(
    (fieldNamePrefix + 'autoMigrate') as 'autoMigrate'
  )
  const preauthActions =
    (watch(
      (fieldNamePrefix + 'defaultPreauthActions') as 'defaultPreauthActions'
    ) as GiftPreauthActionId[] | undefined) || DEFAULT_GIFT_PREAUTH_ACTIONS

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.onboardingModuleEditor', {
          defaultValue:
            'Gift / onboarding links: members mint one-time shareable links. Recipients bootstrap a fresh wallet, bind a passkey (or OIDC), then migrate to a durable account. Optional feegrant preauth pays gas only for selected message types — not wallet funding or membership.',
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
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.authPlane', { defaultValue: 'Default auth plane' })}
        />
        <SegmentedControls
          disabled={!isCreating}
          onSelect={(value) =>
            setValue(
              (fieldNamePrefix + 'defaultAuthPlane') as 'defaultAuthPlane',
              value,
              { shouldValidate: true }
            )
          }
          selected={authPlane}
          tabs={[
            { label: 'PFPK', value: 'pfpk' as const },
            { label: 'OIDC / Web3Auth', value: 'oidc' as const },
          ]}
        />
      </div>

      <SwitchCard
        containerClassName="self-start"
        enabled={!!autoMigrate}
        label={t('form.autoMigrate', {
          defaultValue: 'Auto-migrate ephemeral → durable account',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix + 'autoMigrate') as 'autoMigrate',
            !autoMigrate,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />

      <div className="space-y-2">
        <InputLabel
          name={t('form.inviteTtlDays', {
            defaultValue: 'Invite lifetime (days)',
          })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.inviteTtlDays}
          fieldName={(fieldNamePrefix + 'inviteTtlDays') as 'inviteTtlDays'}
          register={register}
          type="number"
          validation={[validateRequired]}
        />
        <InputErrorMessage error={errors?.inviteTtlDays} />
      </div>

      <GiftPreauthActionSelector
        disabled={!isCreating}
        onChange={(next) =>
          setValue(
            (fieldNamePrefix +
              'defaultPreauthActions') as 'defaultPreauthActions',
            next,
            { shouldValidate: true }
          )
        }
        selected={preauthActions}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <InputLabel
            name={t('form.feegrantSpendAmount', {
              defaultValue: 'Feegrant gas cap (base units, optional)',
            })}
            optional
          />
          <TextInput
            disabled={!isCreating}
            fieldName={
              (fieldNamePrefix +
                'defaultFeegrantSpendAmount') as 'defaultFeegrantSpendAmount'
            }
            placeholder="1000000"
            register={register}
          />
        </div>
        <div className="space-y-2">
          <InputLabel
            name={t('form.feegrantSpendDenom', {
              defaultValue: 'Feegrant denom',
            })}
            optional
          />
          <TextInput
            disabled={!isCreating}
            fieldName={
              (fieldNamePrefix +
                'defaultFeegrantSpendDenom') as 'defaultFeegrantSpendDenom'
            }
            placeholder="uterp"
            register={register}
          />
        </div>
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.feegrantTtlDays', {
            defaultValue: 'Feegrant lifetime (days, optional)',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          fieldName={(fieldNamePrefix + 'feegrantTtlDays') as 'feegrantTtlDays'}
          placeholder="30"
          register={register}
          type="number"
        />
      </div>
    </div>
  )
}
