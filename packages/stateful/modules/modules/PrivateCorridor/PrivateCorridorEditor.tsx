import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  AddressInput,
  InputErrorMessage,
  InputLabel,
  SegmentedControls,
  TextAreaInput,
  TextInput,
  useActionOptions,
} from '@dao-dao/stateless'
import { ModuleEditorProps } from '@dao-dao/types'
import { makeValidateAddress } from '@dao-dao/utils'

import {
  BtcNetwork,
  CorridorAssetBackend,
  PrivateCorridorModuleData,
} from './types'

/**
 * Production Private Bridge module config for DAO deployments.
 */
export const PrivateCorridorEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<PrivateCorridorModuleData>) => {
  const { t } = useTranslation()
  const {
    chain: { bech32Prefix },
  } = useActionOptions()
  const { register, setValue, watch } = useFormContext<
    PrivateCorridorModuleData & Record<string, unknown>
  >()

  const assetBackend = watch(
    (fieldNamePrefix + 'assetBackend') as 'assetBackend'
  ) as CorridorAssetBackend

  const btcNetwork = watch(
    (fieldNamePrefix + 'btcNetwork') as 'btcNetwork'
  ) as BtcNetwork

  const optionalContract = makeValidateAddress(bech32Prefix, false)

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.privateCorridorModuleEditor', {
          defaultValue:
            'Production Private Bridge: browser deposit wallet, BTC QR, client proof, mint-router / notes / oracle. Fail-closed reverify except lab_simulated. ict_local_funded = local test-net fidelity (not mainnet). Not Headstash airdrop claim.',
        })}
      </p>

      <div className="space-y-2">
        <InputLabel
          name={t('form.corridorId', { defaultValue: 'Corridor id' })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.corridorId}
          fieldName={(fieldNamePrefix + 'corridorId') as 'corridorId'}
          placeholder="cashapp-btc-zec-v0"
          register={register}
        />
        <InputErrorMessage error={errors?.corridorId} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.deploymentMode', {
            defaultValue: 'Deployment mode',
          })}
        />
        <SegmentedControls
          disabled={!isCreating}
          onSelect={(value) =>
            setValue(
              (fieldNamePrefix + 'assetBackend') as 'assetBackend',
              value,
              { shouldValidate: true }
            )
          }
          selected={assetBackend || 'production'}
          tabs={[
            { label: 'Production', value: 'production' as const },
            { label: 'LC live', value: 'lc_live' as const },
            {
              label: 'ICT local funded',
              value: 'ict_local_funded' as const,
            },
            { label: 'Lab only', value: 'lab_simulated' as const },
          ]}
        />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.btcNetwork', { defaultValue: 'Bitcoin network' })}
        />
        <SegmentedControls
          disabled={!isCreating}
          onSelect={(value) =>
            setValue((fieldNamePrefix + 'btcNetwork') as 'btcNetwork', value, {
              shouldValidate: true,
            })
          }
          selected={btcNetwork || 'mainnet'}
          tabs={[
            { label: 'Mainnet', value: 'mainnet' as const },
            { label: 'Testnet', value: 'testnet' as const },
          ]}
        />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.headstashContract', {
            defaultValue: 'Mint router (cw-headstash)',
          })}
        />
        <AddressInput
          disabled={!isCreating}
          error={errors?.headstashContract}
          fieldName={
            (fieldNamePrefix + 'headstashContract') as 'headstashContract'
          }
          register={register}
          validation={[optionalContract]}
        />
        <InputErrorMessage error={errors?.headstashContract} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.notesBase', {
            defaultValue: 'Notes base (hash-market)',
          })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.notesBase}
          fieldName={(fieldNamePrefix + 'notesBase') as 'notesBase'}
          placeholder="https://notes.example"
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.notesBasePir', {
            defaultValue:
              'Private notes HTTP base for list/PIR recover (never public /content). Bearer via session or NEXT_PUBLIC_NOTES_BEARER (lab only) — never commit secrets.',
          })}
        </p>
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.notesHsId', {
            defaultValue: 'Notes hs_id (season / contract)',
          })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.notesHsId}
          fieldName={(fieldNamePrefix + 'notesHsId') as 'notesHsId'}
          placeholder="season-1 or cw-headstash addr"
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.notesHsIdHint', {
            defaultValue:
              'Path segment for GET/PUT /notes/{hs_id}/… and POST /notes/{hs_id}/pir. Defaults to mint-router when empty.',
          })}
        </p>
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.oracleBase', {
            defaultValue: 'Oracle bounds base',
          })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.oracleBase}
          fieldName={(fieldNamePrefix + 'oracleBase') as 'oracleBase'}
          placeholder="https://oracle.example"
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.oracleBoundOnly', {
            defaultValue:
              'Oracle is bound_only (mid/floor for swap policy) — never mints. Mint = cw-headstash BridgeMintNote.',
          })}
        </p>
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.esploraBase', {
            defaultValue: 'Esplora base (D4 re-verify, optional)',
          })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.esploraBase}
          fieldName={(fieldNamePrefix + 'esploraBase') as 'esploraBase'}
          placeholder="http://127.0.0.1:3002 (regtest) or leave empty for public"
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.esploraBaseHint', {
            defaultValue:
              'For ict_local_funded / regtest set local Esplora. Env override: NEXT_PUBLIC_BTC_ESPLORA. Empty → public multi-fallback for mainnet/testnet.',
          })}
        </p>
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.description', { defaultValue: 'Description' })}
        />
        <TextAreaInput
          disabled={!isCreating}
          error={errors?.description}
          fieldName={(fieldNamePrefix + 'description') as 'description'}
          register={register}
          rows={3}
        />
      </div>
    </div>
  )
}
