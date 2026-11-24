import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  AddressInput,
  InputErrorMessage,
  InputLabel,
  SwitchCard,
  TextAreaInput,
  useActionOptions,
} from '@dao-dao/stateless'
import { ModuleEditorProps } from '@dao-dao/types'
import {
  MESH_STORAGE_KEY,
  makeValidateAddress,
  validateRequired,
} from '@dao-dao/utils'

import { CalendarModuleData } from './types'

export const CalendarEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<CalendarModuleData>) => {
  const { t } = useTranslation()
  const {
    chain: { bech32Prefix },
  } = useActionOptions()
  const { register, setValue, watch } = useFormContext<
    CalendarModuleData & Record<string, unknown>
  >()

  const useChainMeshDefault = watch(
    (fieldNamePrefix + 'useChainMeshDefault') as 'useChainMeshDefault'
  )

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.calendarModuleEditor', {
          defaultValue:
            'Point this DAO at a dao-calendar contract. Enabling/editing this module also writes DAO storage mesh.v1 (chain headstash defaults + calendar address) so frontends can resolveMesh without hardcoding.',
        })}
      </p>

      <div className="space-y-2">
        <InputLabel name={t('form.contract', { defaultValue: 'Calendar contract' })} />
        <AddressInput
          disabled={!isCreating}
          error={errors?.calendarContract}
          fieldName={
            (fieldNamePrefix + 'calendarContract') as 'calendarContract'
          }
          register={register}
          type="contract"
          validation={[validateRequired, makeValidateAddress(bech32Prefix)]}
        />
        <InputErrorMessage error={errors?.calendarContract} />
      </div>

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

      <SwitchCard
        containerClassName="self-start"
        enabled={useChainMeshDefault !== false}
        label={t('form.useChainMeshDefault', {
          defaultValue: 'Use chain headstash mesh defaults',
        })}
        onClick={() =>
          setValue(
            (fieldNamePrefix + 'useChainMeshDefault') as 'useChainMeshDefault',
            useChainMeshDefault === false,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
        tooltip={t('info.useChainMeshDefaultTooltip', {
          defaultValue: `When on, frontends resolve query/relays from services.headstashServer if DAO storage “${MESH_STORAGE_KEY}” is empty. Turn off only if you supply meshJson or require an on-chain mesh.v1 item.`,
        })}
      />

      <div className="space-y-2">
        <InputLabel
          name={t('form.meshJson', {
            defaultValue: 'mesh.v1 JSON (optional advanced)',
          })}
          optional
        />
        <TextAreaInput
          disabled={!isCreating}
          error={errors?.meshJson}
          fieldName={(fieldNamePrefix + 'meshJson') as 'meshJson'}
          placeholder={`{"v":1,"relays":["wss://…"],"query":"https://…","calendar":"terp1…"}`}
          register={register}
          rows={4}
        />
        <p className="secondary-text text-xs">
          {t('info.meshJsonHint', {
            defaultValue: `If set and valid, this JSON is written to DAO storage “${MESH_STORAGE_KEY}” on enable (with calendar filled if missing). Otherwise chain headstash defaults + the calendar contract above are published.`,
          })}
        </p>
        <InputErrorMessage error={errors?.meshJson} />
      </div>
    </div>
  )
}
