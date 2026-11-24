import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  InputErrorMessage,
  InputLabel,
  SwitchCard,
  TextAreaInput,
} from '@dao-dao/stateless'
import { ModuleEditorProps } from '@dao-dao/types'

import { IbcModuleData } from './types'

export const IbcEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<IbcModuleData>) => {
  const { t } = useTranslation()
  const { register, watch, setValue } = useFormContext<IbcModuleData>()

  const showRelayerFund = watch(
    (fieldNamePrefix + 'showRelayerFund') as 'showRelayerFund'
  )
  const showSwapTab = watch(
    (fieldNamePrefix + 'showSwapTab') as 'showSwapTab'
  )

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.ibcModuleEditor', {
          defaultValue:
            'Expose Terp IBC inventory on this DAO: live channels from curated state, foundation relayer gas deposits, and a swap entry that reuses Spend/Skip patterns. Value-moving txs stay action-encoded for proposals.',
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

      <SwitchCard
        containerClassName="self-start"
        enabled={!!showRelayerFund}
        label={t('form.showRelayerFund', {
          defaultValue: 'Show foundation relayer fund bar',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix + 'showRelayerFund') as 'showRelayerFund',
            !showRelayerFund,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />

      <SwitchCard
        containerClassName="self-start"
        enabled={!!showSwapTab}
        label={t('form.showSwapTab', {
          defaultValue: 'Show IBC swap tab',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix + 'showSwapTab') as 'showSwapTab',
            !showSwapTab,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />
    </div>
  )
}
